import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend';
import { MitmproxyBackend, toEvent, toFlow, viewText } from './mitmproxy';
import { MITMWEB_FLOWS } from './mitmweb.fixture';

const [httpsGet, httpPost, refused] = MITMWEB_FLOWS;

describe('toFlow', () => {
  it('maps an HTTPS flow', () => {
    const f = toFlow(httpsGet);
    expect(f).toMatchObject({
      id: httpsGet.id, kind: 'http', method: 'GET', scheme: 'https', host: 'httpbin.org', port: 443,
      path: '/json', url: 'https://httpbin.org/json', client: '127.0.0.1:57683', server: 'httpbin.org:443',
      tls: 'TLSv1.3', error: null, websocket: false, replay: false,
    });
    expect(f.created).toBe(Math.round(httpsGet.timestamp_created * 1000));
    expect(f.request).toMatchObject({ httpVersion: 'HTTP/2.0', size: 0, bodyHash: null });
    expect(f.response).toMatchObject({ status: 200, size: 429, headers: expect.arrayContaining([['content-type', 'application/json']]) });
    expect(f.response?.bodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps a non-default port and the query in the address', () => {
    expect(toFlow(httpPost).url).toBe('http://httpbin.org/post?x=1');
    expect(toFlow(refused)).toMatchObject({ url: 'http://127.0.0.1:1/nothing', response: null, tls: null });
  });

  it('carries the connection error', () => {
    expect(toFlow(refused).error).toContain('Connect call failed');
  });

  it('brackets an IPv6 host', () => {
    const v6 = { ...httpPost, request: { ...httpPost.request!, pretty_host: '::1', host: '::1', port: 8080, path: '/' } };
    expect(toFlow(v6 as typeof httpPost).url).toBe('http://[::1]:8080/');
  });

  it('names non-HTTP flows by their server', () => {
    const tcp = { id: 't', type: 'tcp', timestamp_created: 1, is_replay: null, server_conn: { address: ['10.0.0.1', 5432] as [string, number] } };
    expect(toFlow(tcp)).toMatchObject({ kind: 'tcp', method: 'TCP', host: '10.0.0.1', port: 5432, url: '10.0.0.1:5432', request: null });
  });
});

describe('toEvent', () => {
  it('maps flow updates and ignores other resources', () => {
    expect(toEvent({ resource: 'flows', cmd: 'add', data: httpsGet })).toMatchObject({ type: 'upsert', flow: { id: httpsGet.id } });
    expect(toEvent({ resource: 'flows', cmd: 'update', data: httpsGet })).toMatchObject({ type: 'upsert' });
    expect(toEvent({ resource: 'flows', cmd: 'remove', data: 'x' })).toEqual({ type: 'remove', id: 'x' });
    expect(toEvent({ resource: 'flows', cmd: 'reset' })).toBe('reset');
    expect(toEvent({ resource: 'events', cmd: 'add', data: {} })).toBeNull();
  });
});

it('viewText joins the styled runs', () => {
  // As GET /flows/<id>/request/content/auto.json returned it for {"a":1}
  const lines: [string, string][][] = [[['text', '{'], ['text', '']], [['text', '    '], ['Token_Name_Tag', '"a"'], ['text', ': '], ['Token_Literal_Number', '1'], ['text', '']], [['text', ''], ['text', '}']]];
  expect(viewText(lines)).toBe('{\n    "a": 1\n}');
});

describe('MitmproxyBackend', () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (status: number, body: unknown) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

  it('sends the token and maps the status', async () => {
    const fetch = vi.fn(async () => reply(200, { backend: 'mitmproxy-addons', version: '1.2', mitmproxy: '10.3.1', mode: 'serve', pid: 1, proxy_port: 8888, lan: ['192.168.1.5:8888'], onboarding: 'http://mitm.it' }));
    vi.stubGlobal('fetch', fetch);
    const info = await new MitmproxyBackend('http://127.0.0.1:8081/', 't0k').info();
    expect(info).toEqual({ backend: 'mitmproxy-addons', version: '1.2', engine: 'mitmproxy 10.3.1', mode: 'serve', proxyPort: 8888, lan: ['192.168.1.5:8888'], onboarding: 'http://mitm.it' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8081/bmitmproxy-api/status');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
  });

  it('tells the failures apart', async () => {
    const b = new MitmproxyBackend('http://127.0.0.1:8081', 'x');
    const kind = async (f: () => Promise<Response>) => {
      vi.stubGlobal('fetch', vi.fn(f));
      return b.ca().then(() => null, (e: BackendError) => [e.kind, e.message]);
    };
    expect(await kind(async () => { throw new TypeError('Failed to fetch'); })).toEqual(['unreachable', 'http://127.0.0.1:8081: Failed to fetch']);
    expect((await kind(async () => reply(401, '缺少或错误的 token')))?.[0]).toBe('unauthorized');
    expect(await kind(async () => reply(501, '只支持 macOS'))).toEqual(['unsupported', '只支持 macOS']);
    // An older bmitmproxy (or plain mitmweb) at the address: info() says it can't be used
    const old = '<html><title>403: To protect against DNS rebinding, mitmweb can only be accessed by IP at the moment.</title></html>';
    vi.stubGlobal('fetch', vi.fn(async () => reply(403, old)));
    await expect(b.info()).rejects.toMatchObject({ kind: 'incompatible', status: 403 });
    vi.stubGlobal('fetch', vi.fn(async () => reply(404, 'Not Found')));
    await expect(b.info()).rejects.toMatchObject({ kind: 'incompatible', status: 404 });
    // The backend's reason (e.g. the system prompt was cancelled) is the message
    expect(await kind(async () => reply(409, '用户取消了授权'))).toEqual(['failed', '用户取消了授权']);
  });

  it('copies as cURL through the export command', async () => {
    const fetch = vi.fn(async () => reply(200, { value: "curl 'http://httpbin.org/post?x=1'" }));
    vi.stubGlobal('fetch', fetch);
    expect(await new MitmproxyBackend('http://h', 't').curl('abc')).toBe("curl 'http://httpbin.org/post?x=1'");
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ arguments: ['curl', '@abc'] });
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { error: 'no flows' })));
    await expect(new MitmproxyBackend('http://h', 't').curl('abc')).rejects.toMatchObject({ kind: 'failed', message: 'no flows' });
  });

  it('cuts a long body and says so', async () => {
    const lines = Array.from({ length: 2001 }, (_, i) => [['text', String(i)]]);
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { lines, description: 'Raw' })));
    const body = await new MitmproxyBackend('http://h', 't').body('id', 'response');
    expect(body.truncated).toBe(true);
    expect(body.text.split('\n')).toHaveLength(2000);
    expect(body.view).toBe('Raw');
  });

  it('waits for a saved script to load again', async () => {
    const row = { id: 3, path: '/s/a.py', enabled: true, error: '' };
    const answers = [
      { ...row, status: 'loaded', load_count: 1 }, // PUT content: the previous load
      { ...row, status: 'loaded', load_count: 1 }, // not reloaded yet
      { ...row, status: 'failed', load_count: 2, error: 'Traceback…' },
    ];
    const fetch = vi.fn(async () => reply(200, answers.shift()));
    vi.stubGlobal('fetch', fetch);
    const s = await new MitmproxyBackend('http://h', 't').writeScript(3, 'x = (');
    expect(s).toMatchObject({ status: 'failed', error: 'Traceback…' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not wait for a disabled script', async () => {
    const fetch = vi.fn(async () => reply(200, { id: 3, path: '/s/a.py', enabled: false, status: 'disabled', error: '', load_count: 1 }));
    vi.stubGlobal('fetch', fetch);
    expect(await new MitmproxyBackend('http://h', 't').setScriptEnabled(3, false)).toMatchObject({ status: 'disabled' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('MitmproxyBackend.remove', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('removes the given flows in batches', async () => {
    const fetch = vi.fn(async () => new Response('{"value": null}'));
    vi.stubGlobal('fetch', fetch);
    const ids = Array.from({ length: 501 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    await new MitmproxyBackend('http://h', 't').remove(ids);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u]) => u)).toEqual(['http://h/commands/view.flows.remove', 'http://h/commands/view.flows.remove']);
    const args = calls.map(([, init]) => JSON.parse(init.body as string).arguments[0] as string);
    expect(args[0].split(',')).toHaveLength(500);
    expect(args[1]).toBe('@' + ids[500]);
  });
});
