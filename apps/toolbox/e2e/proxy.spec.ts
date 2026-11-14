// Proxy & capture, against a stand-in of the bmitmproxy backend (its HTTP API and /updates
// WebSocket, answering with flows captured from a real run): connecting by the printed link or a
// pasted token, the live list, filter, detail and cURL, clear with undo, the system proxy, the
// certificate and scripts.
import type { Page, Request, WebSocketRoute } from '@playwright/test';
import { MITMWEB_FLOWS } from '../src/lib/proxy/mitmweb.fixture';
import type { MFlow } from '../src/lib/proxy/mitmproxy';
import { clipboard, expect, HOME, IN_DESKTOP, open, pasteOnBlank, STAND_IN_PROXY, test, toast } from './helpers';

const TOKEN = 'Tk0_example-token-for-tests-only-0123456789';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const LINK = `#proxy?api=${encodeURIComponent(STAND_IN_PROXY)}&token=${TOKEN}`;
const [GET, POST] = MITMWEB_FLOWS;

interface Fake {
  calls: { method: string; path: string; body: unknown }[];
  ws: WebSocketRoute[];
  sys: Record<string, unknown>;
  ca: Record<string, unknown>;
  scripts: Record<string, unknown>[];
  /** What PUT …/content answers for the script (its status after the reload). */
  afterSave: Record<string, unknown>;
  /** Not running: nothing answers. */
  down: boolean;
  /** An older bmitmproxy: mitmweb answers its own endpoints only (403 from its DNS-rebinding guard for the rest). */
  old: boolean;
}

async function backend(page: Page, flows: MFlow[] = [GET, POST], o: Partial<Fake> = {}): Promise<Fake> {
  const fake: Fake = {
    calls: [], ws: [],
    sys: { supported: true, platform: 'macOS', enabled: false, taken_over: false, overridden: false, upstream: 'http://127.0.0.1:7890', bypass: ['localhost', '127.*'], services: [], proxy: '127.0.0.1:18888' },
    ca: { subject: 'mitmproxy', organization: 'mitmproxy', sha256: 'AA:21', sha1: 'x', not_before: 1784764800, not_after: 2100297600, shared_insecure: false, trust_supported: true, platform: 'macOS', trusted: false },
    scripts: [],
    afterSave: {},
    down: false,
    old: false,
    ...o,
  };
  const json = (v: unknown, status = 200) => ({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(v) });
  await page.route(STAND_IN_PROXY + '/**', async (route) => {
    const req: Request = route.request();
    if (fake.down) return route.abort('connectionrefused');
    if (fake.old && new URL(req.url()).pathname.startsWith('/bmitmproxy-api/') && req.method() !== 'OPTIONS') {
      return route.fulfill({ status: 403, headers: CORS, body: '<html><title>403: To protect against DNS rebinding, mitmweb can only be accessed by IP at the moment.</title></html>' });
    }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.headers().authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: CORS, body: '缺少或错误的 token，用 bmitmctl token 查看' });
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    fake.calls.push({ method: req.method(), path, body });
    const m = req.method();
    if (path === '/bmitmproxy-api/status') return route.fulfill(json({ backend: 'mitmproxy-addons', version: '0.1.1', mitmproxy: '10.3.1', mode: 'serve', pid: 1, proxy_port: 18888, lan: ['192.168.6.44:18888'], onboarding: 'http://mitm.it' }));
    if (path === '/flows') return route.fulfill(json(flows));
    if (/\/request\/content\/auto\.json$/.test(path)) return route.fulfill(json({ lines: [[['text', '{']], [['text', '    '], ['Token_Name_Tag', '"a"'], ['text', ': '], ['Token_Literal_Number', '1']], [['text', '}']]], description: 'JSON' }));
    if (/\/response\/content\/auto\.json$/.test(path)) return route.fulfill(json({ lines: [[['text', '{"slideshow": {}}']]], description: 'JSON' }));
    if (path === '/commands/export') return route.fulfill(json({ value: `curl -X POST 'http://httpbin.org/post?x=1' -d '{"a":1}'` }));
    if (path === '/commands/view.flows.remove') return route.fulfill(json({ value: null }));
    if (path === '/bmitmproxy-api/system-proxy') {
      if (m === 'PUT') fake.sys = { ...fake.sys, enabled: (body as { enabled: boolean }).enabled, taken_over: (body as { enabled: boolean }).enabled };
      return route.fulfill(json(fake.sys));
    }
    if (path === '/bmitmproxy-api/ca') return route.fulfill(json(fake.ca));
    if (path === '/bmitmproxy-api/ca/trust') { fake.ca = { ...fake.ca, trusted: m === 'POST' }; return route.fulfill(json(fake.ca)); }
    if (path === '/bmitmproxy-api/ca/cert.pem') return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/x-pem-file' }, body: '-----BEGIN CERTIFICATE-----\n' });
    if (path === '/bmitmproxy-api/scripts' && m === 'GET') return route.fulfill(json(fake.scripts));
    if (path === '/bmitmproxy-api/scripts' && m === 'POST') {
      // As the backend: answered before mitmproxy loads it; the load shows on the next read.
      const s = { id: fake.scripts.length + 1, path: (body as { path: string }).path, enabled: true, status: 'loaded', error: '', load_count: 1 };
      fake.scripts.push(s);
      return route.fulfill(json({ ...s, status: 'pending', load_count: 0 }));
    }
    const sm = /^\/bmitmproxy-api\/scripts\/(\d+)(\/content)?$/.exec(path);
    if (sm) {
      const s = fake.scripts.find((x) => x.id === Number(sm[1]))!;
      if (sm[2] && m === 'GET') return route.fulfill(json({ id: s.id, path: s.path, content: 'from mitmproxy import http\n' }));
      if (sm[2] && m === 'PUT') {
        // As the backend: answered before the reload; the reload shows on the next read.
        const before = { ...s };
        Object.assign(s, { load_count: (s.load_count as number) + 1, ...fake.afterSave });
        return route.fulfill(json(before));
      }
      if (m === 'PUT') { Object.assign(s, { enabled: (body as { enabled: boolean }).enabled, status: (body as { enabled: boolean }).enabled ? 'loaded' : 'disabled' }); return route.fulfill(json(s)); }
      if (m === 'DELETE') { fake.scripts = fake.scripts.filter((x) => x !== s); return route.fulfill(json({})); }
      return route.fulfill(json(s));
    }
    if (path === '/bmitmproxy-api/shutdown') return route.fulfill(json({}));
    return route.fulfill({ status: 404, headers: CORS, body: 'not here' });
  });
  await page.routeWebSocket(/\/updates\?token=/, (ws) => {
    expect(new URL(ws.url()).searchParams.get('token')).toBe(TOKEN);
    fake.ws.push(ws);
  });
  return fake;
}

/** Opened by the link `bmitmproxy serve` prints. */
async function openByLink(page: Page) {
  await open(page);
  await page.goto(HOME + LINK);
  await expect(page.locator('.px-backend')).toContainText('mitmproxy-addons 0.1.1');
}

/** Connected by entering the address and the token (the same in the browser and the desktop app). */
async function connect(page: Page) {
  await open(page, '代理抓包');
  await page.getByLabel('接口地址').fill(STAND_IN_PROXY);
  await page.getByLabel('Token').fill(TOKEN);
  await page.getByRole('button', { name: '连接' }).click();
  await expect(page.locator('.px-backend')).toContainText('mitmproxy-addons 0.1.1');
}

const rows = (page: Page) => page.locator('.px-tbody .px-tr');

test('the printed link connects: the token leaves the address, flows show and new ones arrive live', async ({ page }) => {
  test.skip(IN_DESKTOP, 'the desktop app is not opened by a link');
  const fake = await backend(page);
  await openByLink(page);
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tb.proxy')!))).toEqual({ api: STAND_IN_PROXY, token: TOKEN });
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('GET200httpbin.org/jsonjson429 B');
  await expect(page.locator('.px-dot.on')).toBeVisible();

  // A request arriving over the WebSocket, then its update
  const ws = fake.ws.at(-1)!;
  const late: MFlow = { ...GET, id: '00000000-0000-4000-8000-000000000001', request: { ...(GET.request as object), path: '/late' } as MFlow['request'], response: undefined };
  ws.send(JSON.stringify({ resource: 'flows', cmd: 'add', data: late }));
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(2)).toContainText('…');
  ws.send(JSON.stringify({ resource: 'flows', cmd: 'update', data: { ...late, response: GET.response } }));
  await expect(rows(page).nth(2)).toContainText('/late');
  await expect(rows(page).nth(2)).toContainText('200');
  ws.send(JSON.stringify({ resource: 'events', cmd: 'add', data: { message: 'log' } }));
  ws.send(JSON.stringify({ resource: 'flows', cmd: 'remove', data: late.id }));
  await expect(rows(page)).toHaveCount(2);
});

test('filter, detail, body and copy as cURL', async ({ page }) => {
  await backend(page);
  await connect(page);
  await page.locator('.px-filter').fill('httpbin -get');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator('.px-count')).toHaveText('1 / 2 条');
  await rows(page).first().click();
  await expect(page.locator('.px-d-url')).toHaveText('POST http://httpbin.org/post?x=1');
  await expect(page.locator('.px-d .kv', { hasText: '客户端' })).toContainText('127.0.0.1:');
  await page.locator('.px-d .seg button', { hasText: '请求' }).click();
  await expect(page.locator('.px-head-line')).toHaveText('POST /post?x=1 HTTP/1.1');
  await expect(page.locator('.px-body pre')).toHaveText('{\n    "a": 1\n}');
  await expect(page.locator('.px-body-head')).toContainText('按 JSON 显示');
  // A header's value is copied by clicking it
  await page.locator('.px-d .kv', { hasText: 'Content-Type' }).click();
  expect(await clipboard(page)).toBe('application/json');
  await page.getByRole('button', { name: '复制为 cURL' }).click();
  await expect(toast(page)).toHaveText('已复制 cURL 命令');
  expect(await clipboard(page)).toBe(`curl -X POST 'http://httpbin.org/post?x=1' -d '{"a":1}'`);
  await page.locator('.px-filter').fill('');
  await expect(rows(page)).toHaveCount(2);
});

test('clear can be undone; the backend drops the flows only after the undo has passed', async ({ page }) => {
  const fake = await backend(page);
  await connect(page);
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button', { name: '清空' }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(toast(page)).toContainText('已清空 2 条');
  await page.locator('.toast-undo').click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button', { name: '清空' }).click();
  await expect(rows(page)).toHaveCount(0);
  expect(fake.calls.filter((c) => c.path === '/commands/view.flows.remove')).toEqual([]);
  await expect.poll(() => fake.calls.filter((c) => c.path === '/commands/view.flows.remove').length, { timeout: 10_000 }).toBe(1);
  expect(fake.calls.find((c) => c.path === '/commands/view.flows.remove')!.body).toEqual({ arguments: ['@' + [GET.id, POST.id].join(',')] });
});

test('not running, wrong token, a pasted token; the system proxy; stopping the backend', async ({ page }) => {
  // Routes are set before the page loads (a WebSocket route only applies to pages loaded after it)
  const fake = await backend(page, [GET, POST], { down: true });
  await open(page, '代理抓包');
  await expect(page.locator('.px-cmd')).toHaveText(new RegExp(`^bmitmproxy serve --origin "${await page.evaluate(() => location.origin)}"$`));
  await expect(page.getByLabel('接口地址')).toHaveAttribute('placeholder', 'http://127.0.0.1:8081');
  // Not running yet: said why, and tried again until it is
  await page.getByLabel('接口地址').fill(STAND_IN_PROXY);
  await expect(page.locator('.px-cmd')).toContainText('--web-port 18765');
  await page.getByLabel('Token').fill('x'.repeat(43));
  await page.getByRole('button', { name: '连接' }).click();
  await expect(page.locator('.px-err')).toContainText(`连不上 ${STAND_IN_PROXY}`);
  await expect(page.locator('.px-err')).toContainText('--origin');
  // An older version answers: said so, and still tried again
  fake.down = false;
  fake.old = true;
  await expect(page.locator('.px-err')).toContainText('可能是旧版的 bmitmproxy', { timeout: 10_000 });
  fake.old = false;
  await expect(page.locator('.px-err')).toHaveText('token 不对：在终端运行 bmitmctl token 查看。');
  // The token pasted on the page connects
  await pasteOnBlank(page, { text: TOKEN });
  await expect(page.locator('.px-backend')).toContainText('mitmproxy-addons');

  await expect(page.locator('.px-sys')).toContainText('再转给 http://127.0.0.1:7890');
  await page.getByRole('button', { name: '接管系统代理' }).click();
  await expect(page.getByRole('button', { name: '接管系统代理' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.px-sys')).toContainText('本机的 HTTP / HTTPS 流量正经过这里，再转给原来的代理 http://127.0.0.1:7890');
  expect(fake.calls.filter((c) => c.method === 'PUT' && c.path === '/bmitmproxy-api/system-proxy').map((c) => c.body)).toEqual([{ enabled: true }]);
  // Another program changes it back: said within a poll
  fake.sys = { ...fake.sys, enabled: false, overridden: true };
  await expect(page.locator('.px-sys .px-warn')).toContainText('被别的程序改掉了', { timeout: 10_000 });

  await page.getByRole('button', { name: '停止后端' }).click();
  await expect(toast(page)).toHaveText('后端已停止');
  await expect(page.locator('.px-connect')).toBeVisible();
  expect(fake.calls.some((c) => c.path === '/bmitmproxy-api/shutdown')).toBe(true);
});

test('certificate: trust on this computer, files, other devices; the shared test certificate is not offered', async ({ page }) => {
  const fake = await backend(page);
  await connect(page);
  await page.locator('.proxy > .seg button', { hasText: '证书' }).click();
  await expect(page.locator('.px-trust')).toContainText('还没有信任');
  await page.getByRole('button', { name: '安装并信任' }).click();
  await expect(page.locator('.px-trust')).toContainText('本机已信任');
  await expect(toast(page)).toHaveText('已在本机信任根证书');
  expect(fake.calls.some((c) => c.method === 'POST' && c.path === '/bmitmproxy-api/ca/trust')).toBe(true);
  await expect(page.locator('.px-steps .kv', { hasText: '192.168.6.44:18888' })).toBeVisible();
  await expect(page.locator('.px-qr svg path')).toHaveCount(1);
  await expect(page.locator('.px-qr')).toHaveAttribute('aria-label', 'http://mitm.it 的二维码');

  fake.ca = { ...fake.ca, shared_insecure: true, trusted: false };
  await page.locator('.proxy > .seg button', { hasText: '抓包' }).click();
  await page.locator('.proxy > .seg button', { hasText: '证书' }).click();
  await expect(page.locator('.px-cert .px-warn')).toContainText('公开测试证书');
  await expect(page.getByRole('button', { name: '安装并信任' })).toHaveCount(0);
});

test('scripts: a new one opens its template; saving shows why it failed to load; off and remove', async ({ page }) => {
  const fake = await backend(page, [], { afterSave: { status: 'failed', error: 'Traceback (most recent call last):\nSyntaxError: expected \':\'' } });
  await connect(page);
  await page.locator('.proxy > .seg button', { hasText: '脚本' }).click();
  await expect(page.locator('.px-scripts .px-note')).toContainText('还没有脚本');
  await page.getByLabel('脚本路径（.py），如 ~/mitm/rewrite.py').fill('~/mitm/demo.py');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  expect(fake.calls.find((c) => c.method === 'POST' && c.path === '/bmitmproxy-api/scripts')!.body).toEqual({ path: '~/mitm/demo.py', create: true });
  const ed = page.locator('.px-editor textarea');
  await expect(ed).toHaveValue('from mitmproxy import http\n');
  await ed.fill('def response(flow)\n');
  await expect(page.locator('.px-editor .px-warn')).toHaveText('有未保存的改动');
  await ed.press('ControlOrMeta+s');
  await expect(page.locator('.px-badge')).toHaveText('加载失败');
  await expect(page.locator('.px-trace')).toContainText('SyntaxError');
  expect(fake.calls.find((c) => c.method === 'PUT' && c.path === '/bmitmproxy-api/scripts/1/content')!.body).toEqual({ content: 'def response(flow)\n' });
  await expect(page.locator('.px-editor .px-warn')).toHaveCount(0);

  await page.locator('.px-script').getByRole('button', { name: '启用' }).click();
  await expect(page.locator('.px-badge')).toHaveText('已停用');
  await page.getByRole('button', { name: '移除' }).click();
  await expect(page.locator('.px-script')).toHaveCount(0);
  await expect(toast(page)).toContainText('已从列表移除 demo.py');
  await expect.poll(() => fake.scripts.length, { timeout: 10_000 }).toBe(0);
});
