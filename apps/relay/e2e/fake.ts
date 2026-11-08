// A stand-in for the app's commands (src-tauri/src/lib.rs) inside the page, for testing the
// window in a browser: the same commands, view shape and messages, kept in memory. What the
// window asked for is recorded in window.__calls.

export interface FakeStart {
  server?: { state: 'running'; address: string } | { state: 'failed'; port: number; error: string };
  recent?: unknown[];
  /** This machine's addresses on the local network (default: 192.168.1.5). */
  lanAddresses?: string[];
}

/** Runs in the page (addInitScript): defines window.__TAURI_INTERNALS__.invoke. */
export function installFake(start: FakeStart) {
  type Up = { id: string; name: string; baseUrl: string; key: string; auth: string; enabled: boolean; systemProxy: boolean };
  type Tok = { id: string; name: string; text: string; enabled: boolean; created: number };
  type Route = { id: string; name: string; protocol: string; upstreams: Up[]; tokens: Tok[] };
  const s = { port: 8790, lan: false, server: start.server ?? { state: 'running', address: 'http://127.0.0.1:8790' }, routes: [] as Route[], recent: start.recent ?? [] };
  let n = 0;
  const id = () => 'id' + ++n;
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  (window as unknown as { __calls: typeof calls; __keys: () => string[] }).__calls = calls;
  (window as unknown as { __keys: () => string[] }).__keys = () => s.routes.flatMap((r) => r.upstreams.map((u) => u.key));

  const hint = (k: string) => (k.length <= 12 ? '…' + k.slice(-2) : k.slice(0, 4) + '…' + k.slice(-4));
  const view = () => ({
    port: s.port,
    lan: s.lan,
    lanAddresses: s.lan ? (start.lanAddresses ?? ['192.168.1.5']).map((ip) => `http://${ip}:${s.port}`) : [],
    server: s.server,
    configError: null,
    recent: s.recent,
    routes: s.routes.map((r) => ({
      id: r.id,
      name: r.name,
      protocol: r.protocol,
      upstreams: r.upstreams.map(({ key, ...u }) => ({ ...u, keyHint: hint(key) })),
      tokens: r.tokens.map((t) => ({ id: t.id, name: t.name, hint: t.text.slice(0, 5) + '…' + t.text.slice(-4), enabled: t.enabled, created: t.created, use: { requests: 0, lastUsed: 0 } })),
    })),
  });
  const name = (x: unknown) => {
    const v = String(x ?? '').trim();
    if (!v) throw '名字不能为空';
    return v;
  };
  const url = (x: unknown) => {
    const v = String(x ?? '').trim().replace(/\/+$/, '');
    const rest = v.replace(/^https?:\/\//, '');
    if (rest === v || !rest || rest.startsWith('/') || /\s/.test(rest)) throw '地址需以 http:// 或 https:// 开头';
    return v;
  };
  const route = (rid: unknown) => {
    const r = s.routes.find((r) => r.id === rid);
    if (!r) throw '没有这个入口';
    return r;
  };
  const upstream = (r: Route, uid: unknown) => {
    const u = r.upstreams.find((u) => u.id === uid);
    if (!u) throw '没有这个上游';
    return u;
  };

  const commands: Record<string, (a: Record<string, any>) => unknown> = {
    state: () => view(),
    add_route: (a) => (s.routes.push({ id: id(), name: name(a.name), protocol: a.protocol, upstreams: [], tokens: [] }), view()),
    rename_route: (a) => ((route(a.id).name = name(a.name)), view()),
    delete_route: (a) => ((s.routes = s.routes.filter((r) => r.id !== a.id)), view()),
    add_upstream: (a) => {
      const u = a.upstream;
      const key = String(u.key ?? '').trim();
      const fields = { name: name(u.name), baseUrl: url(u.baseUrl) };
      if (!key) throw 'key 不能为空';
      route(a.route).upstreams.push({ id: id(), ...fields, key, auth: u.auth, enabled: u.enabled, systemProxy: u.systemProxy });
      return view();
    },
    update_upstream: (a) => {
      const u = a.upstream;
      const fields = { name: name(u.name), baseUrl: url(u.baseUrl) };
      if (u.key !== undefined && !String(u.key).trim()) throw 'key 不能为空';
      const t = upstream(route(a.route), a.id);
      Object.assign(t, fields, { auth: u.auth, enabled: u.enabled, systemProxy: u.systemProxy }, u.key !== undefined ? { key: String(u.key).trim() } : {});
      return view();
    },
    move_upstream: (a) => {
      const ups = route(a.route).upstreams;
      const i = ups.findIndex((u) => u.id === a.id);
      const j = Math.max(0, Math.min(ups.length - 1, i + a.by));
      ups.splice(j, 0, ...ups.splice(i, 1));
      return view();
    },
    delete_upstream: (a) => ((route(a.route).upstreams = route(a.route).upstreams.filter((u) => u.id !== a.id)), view()),
    add_token: (a) => {
      const text = 'rl-' + 'X'.repeat(36) + String(n).padStart(4, '0');
      route(a.route).tokens.push({ id: id(), name: name(a.name), text, enabled: true, created: 1 });
      return { view: view(), token: text };
    },
    set_token_enabled: (a) => {
      const t = route(a.route).tokens.find((t) => t.id === a.id);
      if (!t) throw '没有这个 token';
      t.enabled = a.enabled;
      return view();
    },
    delete_token: (a) => ((route(a.route).tokens = route(a.route).tokens.filter((t) => t.id !== a.id)), view()),
    set_port: (a) => {
      if (a.port < 1024) throw '端口需在 1024 到 65535 之间';
      s.port = a.port;
      s.server = { state: 'running', address: 'http://127.0.0.1:' + a.port };
      return view();
    },
    set_lan: (a) => ((s.lan = a.on), view()),
  };

  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: Record<string, unknown>) => {
      if (cmd !== 'state') calls.push({ cmd, args });
      const f = commands[cmd];
      if (!f) throw 'unknown command ' + cmd;
      return structuredClone(f(args ?? {}));
    },
    transformCallback: () => 0,
  };
}
