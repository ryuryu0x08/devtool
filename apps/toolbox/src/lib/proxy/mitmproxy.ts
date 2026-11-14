// ProxyBackend for mitmproxy-addons (`bmitmproxy serve`, or the bmitmproxy app): mitmweb's REST
// API and its /updates WebSocket, plus the /bmitmproxy-api/ endpoints it adds (status, system
// proxy, certificate, scripts). Every request carries the token as a Bearer header; the WebSocket,
// which can't send headers, carries it in the address.
import {
  BackendError, type BackendInfo, type Body, type CaInfo, type CertFormat, type Flow, type FlowEvent,
  type Message, type Part, type ProxyBackend, type Script, type ScriptStatus, type SystemProxy,
} from './backend';

export const DEFAULT_API = 'http://127.0.0.1:8081';

const TIMEOUT_MS = 15_000;
/** The system asks for the user's password first; the backend gives up after 300 s. */
const TRUST_TIMEOUT_MS = 310_000;
/** Body lines asked for at most; the raw download has the rest. */
export const BODY_LINES = 2000;
/** Script loads are picked up by mitmproxy's file watcher (about once a second). */
const LOAD_WAIT_MS = 5000;
const LOAD_POLL_MS = 150;
const RECONNECT_MAX_MS = 5000;
const REMOVE_BATCH = 500;

type Json = Record<string, unknown>;
type Pair = [string, string];

interface MMessage {
  http_version: string; headers: Pair[]; contentLength: number | null; contentHash: string | null;
  timestamp_start: number | null; timestamp_end: number | null;
}
interface MRequest extends MMessage { method: string; scheme: string; host: string; port: number; path: string; pretty_host: string }
interface MResponse extends MMessage { status_code: number; reason: string }
interface MConn { peername?: [string, number] | null; address?: [string, number] | null; tls_established?: boolean; tls_version?: string | null }
export interface MFlow {
  id: string; type: string; timestamp_created: number; is_replay: string | null;
  client_conn?: MConn; server_conn?: MConn; error?: { msg: string };
  request?: MRequest | { questions?: { name: string; type: string }[] };
  response?: MResponse | Json;
  websocket?: Json;
}

const ms = (s: number | null | undefined) => (typeof s === 'number' ? Math.round(s * 1000) : null);
const addr = (a: [string, number] | null | undefined) => (a ? `${a[0].includes(':') ? `[${a[0]}]` : a[0]}:${a[1]}` : null);
const DEFAULT_PORT: Record<string, number> = { http: 80, https: 443, ws: 80, wss: 443 };

function message(m: MMessage): Message {
  return {
    httpVersion: m.http_version, headers: m.headers.map(([k, v]) => [k, v]), size: m.contentLength,
    bodyHash: m.contentLength ? m.contentHash : null, start: ms(m.timestamp_start), end: ms(m.timestamp_end),
  };
}

/** mitmweb's flow JSON as the tool's Flow. */
export function toFlow(f: MFlow): Flow {
  const kind: Flow['kind'] = (['http', 'tcp', 'udp', 'dns'] as const).find((k) => k === f.type) ?? 'other';
  const server = f.server_conn?.address ?? f.server_conn?.peername ?? null;
  const base = {
    id: f.id, kind, created: ms(f.timestamp_created) ?? 0, request: null, response: null,
    error: f.error?.msg ?? null, client: addr(f.client_conn?.peername) ?? '', server: addr(server),
    tls: f.server_conn?.tls_established ? (f.server_conn.tls_version ?? 'TLS') : null,
    websocket: Boolean(f.websocket), replay: Boolean(f.is_replay),
  };
  if (kind === 'http' && f.request && 'method' in f.request) {
    const q = f.request;
    const host = q.pretty_host || q.host;
    const hostPart = host.includes(':') ? `[${host}]` : host;
    const port = q.port === DEFAULT_PORT[q.scheme] ? '' : `:${q.port}`;
    const r = f.response && 'status_code' in f.response ? (f.response as MResponse) : null;
    return {
      ...base, method: q.method, scheme: q.scheme, host, port: q.port, path: q.path,
      url: `${q.scheme}://${hostPart}${port}${q.path}`, request: message(q),
      response: r ? { ...message(r), status: r.status_code, reason: r.reason } : null,
    };
  }
  const [h, p] = server ?? ['', 0];
  const question = f.request && 'questions' in f.request ? f.request.questions?.[0] : undefined;
  return {
    ...base, method: question?.type ?? kind.toUpperCase(), scheme: kind, host: question?.name ?? h, port: p,
    path: '', url: question?.name ?? addr(server) ?? '',
  };
}

/** One /updates message as a FlowEvent; null for other resources. `reset` carries no flows (refetch). */
export function toEvent(m: { resource?: string; cmd?: string; data?: unknown }): FlowEvent | 'reset' | null {
  if (m.resource !== 'flows') return null;
  if (m.cmd === 'add' || m.cmd === 'update') return { type: 'upsert', flow: toFlow(m.data as MFlow) };
  if (m.cmd === 'remove') return { type: 'remove', id: m.data as string };
  if (m.cmd === 'reset') return 'reset';
  return null;
}

/** mitmweb's content view (lines of [style, text] runs) as plain text. */
export function viewText(lines: [string, string][][]): string {
  return lines.map((l) => l.map(([, t]) => t).join('')).join('\n');
}

const SCRIPT_STATUSES: ScriptStatus[] = ['loaded', 'failed', 'pending', 'missing', 'disabled'];
interface MScript { id: number; path: string; enabled: boolean; status: string; error: string; load_count: number }
const toScript = (s: MScript): Script => ({
  id: s.id, path: s.path, enabled: s.enabled, error: s.error,
  status: SCRIPT_STATUSES.find((x) => x === s.status) ?? 'pending',
});

export class MitmproxyBackend implements ProxyBackend {
  readonly api: string;

  constructor(api: string, private readonly token: string) {
    this.api = api.replace(/\/+$/, '');
  }

  private async request(path: string, init: { method?: string; body?: unknown; timeout?: number } = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.api + path, {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${this.token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeout ?? TIMEOUT_MS),
      });
    } catch (e) {
      if ((e as Error).name === 'TimeoutError') throw new BackendError('timeout', `${path}: no answer`);
      throw new BackendError('unreachable', `${this.api}: ${(e as Error).message}`);
    }
    if (res.ok) return res;
    const text = (await res.text().catch(() => '')).trim() || `${res.status} ${res.statusText}`;
    const kind = res.status === 401 ? 'unauthorized' : res.status === 501 ? 'unsupported' : 'failed';
    throw new BackendError(kind, text, res.status);
  }

  private async json<T>(path: string, init?: { method?: string; body?: unknown; timeout?: number }): Promise<T> {
    const res = await this.request(path, init);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async info(): Promise<BackendInfo> {
    const s = await this.json<{ backend: string; version: string; mitmproxy: string; mode: string; proxy_port: number; lan: string[]; onboarding: string }>('/bmitmproxy-api/status').catch((e: unknown) => {
      // A mitmweb without these endpoints (bmitmproxy before them, or plain mitmweb) answers 404,
      // or 403 from its DNS-rebinding guard for paths it doesn't know.
      if (e instanceof BackendError && e.kind === 'failed' && (e.status === 403 || e.status === 404)) throw new BackendError('incompatible', e.message, e.status);
      throw e;
    });
    return {
      backend: s.backend, version: s.version, engine: `mitmproxy ${s.mitmproxy}`, mode: s.mode === 'serve' ? 'serve' : 'app',
      proxyPort: s.proxy_port, lan: s.lan ?? [], onboarding: s.onboarding,
    };
  }

  async stop() {
    await this.request('/bmitmproxy-api/shutdown', { method: 'POST' });
  }

  watch(onEvent: (e: FlowEvent) => void, onLive: (live: boolean) => void): () => void {
    let stopped = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const url = `${this.api.replace(/^http/, 'ws')}/updates?token=${encodeURIComponent(this.token)}`;

    const connect = () => {
      const sock = new WebSocket(url);
      ws = sock;
      // Changes that arrive while the list is being fetched wait for it, then apply on top.
      let pending: FlowEvent[] | null = [];
      let generation = 0;
      const resync = async () => {
        const mine = ++generation;
        pending ??= [];
        try {
          const flows = (await this.json<MFlow[]>('/flows')).map(toFlow);
          if (stopped || sock !== ws || mine !== generation) return;
          onEvent({ type: 'reset', flows });
          for (const e of pending ?? []) onEvent(e);
          pending = null;
          attempt = 0;
          onLive(true);
        } catch {
          if (sock === ws) sock.close();
        }
      };
      sock.onopen = () => void resync();
      sock.onmessage = (m) => {
        let e: ReturnType<typeof toEvent>;
        try { e = toEvent(JSON.parse(m.data as string)); } catch { return; }
        if (e === 'reset') void resync();
        else if (e) (pending ? pending.push(e) : onEvent(e));
      };
      sock.onclose = () => {
        if (sock !== ws) return;
        onLive(false);
        if (!stopped) timer = setTimeout(connect, Math.min(RECONNECT_MAX_MS, 500 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      const sock = ws;
      ws = null;
      sock?.close();
    };
  }

  async body(id: string, part: Part): Promise<Body> {
    const v = await this.json<{ lines: [string, string][][]; description: string }>(
      `/flows/${id}/${part}/content/auto.json?lines=${BODY_LINES + 1}`,
    );
    const truncated = v.lines.length > BODY_LINES;
    return { text: viewText(truncated ? v.lines.slice(0, BODY_LINES) : v.lines), view: v.description, truncated };
  }

  async raw(id: string, part: Part): Promise<Blob> {
    return (await this.request(`/flows/${id}/${part}/content.data`)).blob();
  }

  async curl(id: string): Promise<string> {
    const r = await this.json<{ value?: string; error?: string }>('/commands/export', { method: 'POST', body: { arguments: ['curl', `@${id}`] } });
    if (r.error !== undefined || typeof r.value !== 'string') throw new BackendError('failed', r.error ?? 'export: no value');
    return r.value;
  }

  async remove(ids: string[]) {
    // view.flows.remove takes "@id,id,…"; a few hundred per call keeps each request small.
    for (let i = 0; i < ids.length; i += REMOVE_BATCH) {
      const r = await this.json<{ error?: string }>('/commands/view.flows.remove', { method: 'POST', body: { arguments: ['@' + ids.slice(i, i + REMOVE_BATCH).join(',')] } });
      if (r.error !== undefined) throw new BackendError('failed', r.error);
    }
  }

  private static systemProxy(s: Json): SystemProxy {
    return {
      supported: Boolean(s.supported), platform: String(s.platform ?? ''), enabled: Boolean(s.enabled),
      overridden: Boolean(s.overridden), upstream: (s.upstream as string | null) ?? null,
      bypass: (s.bypass as string[] | undefined) ?? [], proxy: String(s.proxy ?? ''),
    };
  }

  async systemProxy() {
    return MitmproxyBackend.systemProxy(await this.json<Json>('/bmitmproxy-api/system-proxy'));
  }

  async setSystemProxy(on: boolean) {
    return MitmproxyBackend.systemProxy(await this.json<Json>('/bmitmproxy-api/system-proxy', { method: 'PUT', body: { enabled: on }, timeout: 60_000 }));
  }

  private static ca(c: Json): CaInfo {
    return {
      subject: String(c.subject ?? ''), organization: String(c.organization ?? ''), sha256: String(c.sha256 ?? ''),
      notBefore: ms(c.not_before as number) ?? 0, notAfter: ms(c.not_after as number) ?? 0,
      sharedInsecure: Boolean(c.shared_insecure), trustSupported: Boolean(c.trust_supported),
      trusted: typeof c.trusted === 'boolean' ? c.trusted : null, platform: String(c.platform ?? ''),
    };
  }

  async ca() {
    return MitmproxyBackend.ca(await this.json<Json>('/bmitmproxy-api/ca'));
  }

  async trustCa() {
    return MitmproxyBackend.ca(await this.json<Json>('/bmitmproxy-api/ca/trust', { method: 'POST', timeout: TRUST_TIMEOUT_MS }));
  }

  async untrustCa() {
    return MitmproxyBackend.ca(await this.json<Json>('/bmitmproxy-api/ca/trust', { method: 'DELETE', timeout: TRUST_TIMEOUT_MS }));
  }

  async caFile(format: CertFormat): Promise<Blob> {
    return (await this.request(`/bmitmproxy-api/ca/cert.${format}`)).blob();
  }

  async scripts() {
    return (await this.json<MScript[]>('/bmitmproxy-api/scripts')).map(toScript);
  }

  /** After a change that (re)loads the script: wait until mitmproxy has loaded it (or failed to). */
  private async loaded(s: MScript): Promise<Script> {
    const deadline = Date.now() + LOAD_WAIT_MS;
    let cur = s;
    while (cur.enabled && cur.status !== 'missing' && cur.load_count <= s.load_count && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, LOAD_POLL_MS));
      cur = await this.json<MScript>(`/bmitmproxy-api/scripts/${s.id}`);
    }
    // Still not loaded when the wait ran out: say so rather than report the previous load.
    return cur.load_count > s.load_count || !cur.enabled || cur.status === 'missing' ? toScript(cur) : { ...toScript(cur), status: 'pending', error: '' };
  }

  async addScript(path: string, create: boolean) {
    return this.loaded(await this.json<MScript>('/bmitmproxy-api/scripts', { method: 'POST', body: { path, create } }));
  }

  async setScriptEnabled(id: number, on: boolean) {
    return this.loaded(await this.json<MScript>(`/bmitmproxy-api/scripts/${id}`, { method: 'PUT', body: { enabled: on } }));
  }

  async removeScript(id: number) {
    await this.request(`/bmitmproxy-api/scripts/${id}`, { method: 'DELETE' });
  }

  async readScript(id: number) {
    return (await this.json<{ content: string }>(`/bmitmproxy-api/scripts/${id}/content`)).content;
  }

  async writeScript(id: number, content: string) {
    return this.loaded(await this.json<MScript>(`/bmitmproxy-api/scripts/${id}/content`, { method: 'PUT', body: { content } }));
  }
}
