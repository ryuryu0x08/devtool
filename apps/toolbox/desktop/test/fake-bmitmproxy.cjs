// A stand-in for bmitmproxy, for the desktop app's tests (its unit tests and the toolbox's
// end-to-end tests in the app). install(dir) lays it out as pipx does:
//
//   dir/bin/bmitmproxy        the entry: a shell script that hands over to the venv's Python
//   dir/venvs/mitmproxy-addons/bin/python
//                             that "Python": answers the probe the driver sends it (-I -c …), and
//                             runs the backend when given the entry and `serve`
//   dir/venvs/mitmproxy-addons/pyvenv.cfg  as any venv has
//   dir/venvs/mitmproxy-addons/pipx_metadata.json, when an install source is given (pipx made it;
//                             dir is then its PIPX_HOME, dir/bin its PIPX_BIN_DIR)
//   dir/config.json           what it answers with; set() changes it, for the next start
//   dir/serving.json          while it runs: its pid and ports (serving() reads it)
//   dir/trusted               its root certificate trusted (kept between runs, as the keychain does)
//   dir/system-proxy.json     while the system proxy is taken over: the settings before, as the real
//                             backend records them (only recorded: the system's settings aren't touched)
//
// config.distutils false: as a fresh install on Python 3.12 without setuptools (the real one then
// fails to start: admin_server imports distutils).
// The backend answers what the toolbox uses of bmitmproxy's API (status, flows and their content,
// the /updates WebSocket, system proxy, certificate, scripts, shutdown) from memory, with the flows
// of config.json. Its own endpoints, under /__fake/, let a test look and change things:
// GET calls (what was asked), POST set (merge into its state), POST send (a WebSocket message).
// It checks its ports as `bmitmproxy serve` does, and holds the proxy port while it runs.
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const TOKEN = 'Tk0_example-token-for-tests-only-0123456789';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Lays out the stand-in in `dir`; returns its paths and a setter for its config. */
function install(dir, cfg = {}) {
  const venv = path.join(dir, 'venvs', 'mitmproxy-addons');
  fs.mkdirSync(path.join(venv, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  // Its scripts run as CommonJS wherever the folder is (the toolbox's own package is a module).
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}\n');
  const python = path.join(venv, 'bin', 'python');
  fs.writeFileSync(path.join(venv, 'pyvenv.cfg'), 'home = /usr/bin\ninclude-system-site-packages = false\n');
  fs.writeFileSync(python, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(__filename).href)}).then((m) => m.default.main(${JSON.stringify(dir)}));\n`, { mode: 0o755 });
  const entry = path.join(dir, 'bin', 'bmitmproxy');
  // As pipx writes one when the venv's path has spaces.
  fs.writeFileSync(entry, `#!/bin/sh\n'''exec' "${python}" "$0" "$@"\n' '''\n# A stand-in for bmitmproxy, made by the tests.\n`, { mode: 0o755 });
  const file = path.join(dir, 'config.json');
  let config = { serve: true, pkg: true, distutils: true, version: '0.1.1', token: TOKEN, flows: [], ...cfg };
  const write = () => fs.writeFileSync(file, JSON.stringify(config, null, 2));
  write();
  if (cfg.source) {
    // As pipx records it: where from, with which backend
    fs.writeFileSync(path.join(venv, 'pipx_metadata.json'), JSON.stringify({ backend: cfg.backend ?? 'pip', main_package: { package: 'mitmproxy-addons', package_or_url: cfg.source } }));
  }
  return {
    dir, entry, python, venv, token: config.token, tokenPath: path.join(dir, 'script-api.token'),
    set(change) { config = { ...config, ...change }; write(); },
    config: () => config,
    /** While it runs: { pid, api, proxyPort }; null otherwise. */
    serving() {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, 'serving.json'), 'utf8'));
        process.kill(s.pid, 0);
        return s;
      } catch {
        return null;
      }
    },
  };
}

const PROBE_FLAGS = ['-I', '-c'];

/** The stand-in's Python: argv is [node, python, …what the Python was given]. */
function main(dir) {
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  const argv = process.argv.slice(2);
  if (argv[0] === PROBE_FLAGS[0] && argv[1] === PROBE_FLAGS[1]) {
    if (config.probeFails) {
      process.stderr.write('Traceback (most recent call last):\nImportError: a broken install\n');
      process.exit(1);
    }
    process.stdout.write(JSON.stringify({ pkg: config.pkg, serve: config.serve, distutils: config.distutils, version: config.version, token_path: config.serve ? path.join(dir, 'script-api.token') : null }) + '\n');
    return;
  }
  if (argv[0] === '-m' && argv[1] === 'pip') {
    // `python -m pip install setuptools`: noted, and distutils is there from now on
    fs.writeFileSync(path.join(dir, 'pip-calls.json'), JSON.stringify(argv.slice(2)));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ...config, distutils: true }));
    process.stdout.write('Successfully installed setuptools-80.9.0\n');
    return;
  }
  if (argv[1] === 'serve') return serve(dir, config, argv.slice(2));
  // An older bmitmproxy ignores its arguments and opens its window: the tests must never get here.
  process.stderr.write('the stand-in was run without `serve`: ' + argv.join(' ') + '\n');
  process.exit(9);
}

function option(args, name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}

async function serve(dir, config, args) {
  const proxyPort = Number(option(args, '--proxy-port', 8888));
  const webPort = Number(option(args, '--web-port', 8081));
  if (!config.distutils) {
    process.stderr.write("Traceback (most recent call last):\n  File \"admin_server/eeapi/__init__.py\", line 1, in <module>\n    import distutils.spawn\nModuleNotFoundError: No module named 'distutils'\n");
    process.exit(1);
  }
  if (config.exitOnStart) {
    process.stderr.write(config.exitOnStart.stderr ?? '');
    process.exit(config.exitOnStart.code ?? 1);
  }
  for (const [name, port, free] of [['代理', proxyPort, tcpFree], ['WireGuard', proxyPort, udpFree], ['接口', webPort, tcpFree]]) {
    if (!(await free(port))) {
      process.stderr.write(`✗ ${name}端口 ${port} 已被 其他进程 占用。先退出它（如 bmitmproxy 窗口），或换端口：--proxy-port / --web-port\n`);
      process.exit(1);
    }
  }
  // The proxy port is held while it runs, as mitmproxy holds it (TCP for HTTP, UDP for WireGuard).
  const proxy = net.createServer((s) => s.destroy()).listen(proxyPort, '0.0.0.0');
  const wg = dgram.createSocket('udp4');
  wg.bind(proxyPort, '0.0.0.0');
  fs.writeFileSync(path.join(dir, 'script-api.token'), config.token + '\n', { mode: 0o600 });
  process.stdout.write(`bmitmproxy 已启动（无窗口）\n  代理    127.0.0.1:${proxyPort}\n  接口    http://127.0.0.1:${webPort}\n`);
  if (config.startDelayMs) await new Promise((r) => setTimeout(r, config.startDelayMs));

  const state = {
    argv: process.argv.slice(1),
    calls: [],
    flows: config.flows,
    sys: { supported: true, platform: 'macOS', enabled: false, taken_over: false, overridden: false, upstream: 'http://127.0.0.1:7890', bypass: ['localhost', '127.*'], services: ['Wi-Fi'], proxy: `127.0.0.1:${proxyPort}` },
    ca: { subject: 'mitmproxy', organization: 'mitmproxy', sha256: 'AA:21', sha1: 'x', not_before: 1784764800, not_after: 2100297600, shared_insecure: false, trust_supported: true, platform: 'macOS', trusted: fs.existsSync(path.join(dir, 'trusted')) },
    scripts: [],
    afterSave: {},
    ignoreShutdown: !!config.ignoreShutdown,
  };
  const clients = new Set();
  const send = (msg) => { for (const c of clients) c.write(frame(msg)); };

  const web = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;
    const raw = await body(req);
    const data = raw ? JSON.parse(raw) : undefined;
    const reply = (v, status = 200, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' });
      res.end(type === 'application/json' ? JSON.stringify(v) : v);
    };
    if (p.startsWith('/__fake/')) {
      if (p === '/__fake/calls') return reply(state.calls);
      if (p === '/__fake/argv') return reply(state.argv);
      if (p === '/__fake/set') { Object.assign(state, data); return reply({}); }
      if (p === '/__fake/send') { send(JSON.stringify(data)); return reply({}); }
      return reply('no such', 404, 'text/plain');
    }
    if (m === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end(); }
    if (req.headers.authorization !== `Bearer ${config.token}`) return reply('缺少或错误的 token，用 bmitmctl token 查看', 401, 'text/plain');
    state.calls.push({ method: m, path: p, body: data });
    if (p === '/bmitmproxy-api/status') return reply({ backend: 'mitmproxy-addons', version: config.version, mitmproxy: '10.3.1', mode: 'serve', pid: process.pid, proxy_port: proxyPort, lan: [`192.168.6.44:${proxyPort}`], onboarding: 'http://mitm.it' });
    if (p === '/flows') return reply(state.flows);
    if (/\/request\/content\/auto\.json$/.test(p)) return reply({ lines: [[['text', '{']], [['text', '    '], ['Token_Name_Tag', '"a"'], ['text', ': '], ['Token_Literal_Number', '1']], [['text', '}']]], description: 'JSON' });
    if (/\/response\/content\/auto\.json$/.test(p)) return reply({ lines: [[['text', '{"slideshow": {}}']]], description: 'JSON' });
    if (/\/content\.data$/.test(p)) return reply('{"slideshow": {}}', 200, 'application/octet-stream');
    if (p === '/commands/export') return reply({ value: `curl -X POST 'http://httpbin.org/post?x=1' -d '{"a":1}'` });
    if (p === '/commands/view.flows.remove') {
      const ids = String(data.arguments[0]).replace(/^@/, '').split(',');
      state.flows = state.flows.filter((f) => !ids.includes(f.id));
      return reply({ value: null });
    }
    if (p === '/bmitmproxy-api/system-proxy') {
      if (m === 'PUT') {
        state.sys = { ...state.sys, enabled: data.enabled, taken_over: data.enabled, overridden: false };
        if (data.enabled) record(); else unrecord();
      }
      return reply(state.sys);
    }
    if (p === '/bmitmproxy-api/ca') return reply(state.ca);
    if (p === '/bmitmproxy-api/ca/trust') {
      state.ca = { ...state.ca, trusted: m === 'POST' };
      if (m === 'POST') fs.writeFileSync(path.join(dir, 'trusted'), '');
      else fs.rmSync(path.join(dir, 'trusted'), { force: true });
      return reply(state.ca);
    }
    if (p === '/bmitmproxy-api/ca/cert.pem') return reply('-----BEGIN CERTIFICATE-----\n', 200, 'application/x-pem-file');
    if (p === '/bmitmproxy-api/scripts' && m === 'GET') return reply(state.scripts);
    if (p === '/bmitmproxy-api/scripts' && m === 'POST') {
      // As the backend: answered before mitmproxy loads it; the load shows on the next read.
      const s = { id: state.scripts.length + 1, path: data.path, enabled: true, status: 'loaded', error: '', load_count: 1 };
      state.scripts.push(s);
      return reply({ ...s, status: 'pending', load_count: 0 });
    }
    const sm = /^\/bmitmproxy-api\/scripts\/(\d+)(\/content)?$/.exec(p);
    if (sm) {
      const s = state.scripts.find((x) => x.id === Number(sm[1]));
      if (!s) return reply('no such script', 404, 'text/plain');
      if (sm[2] && m === 'GET') return reply({ id: s.id, path: s.path, content: 'from mitmproxy import http\n' });
      if (sm[2] && m === 'PUT') {
        // As the backend: answered before the reload; the reload shows on the next read.
        const before = { ...s };
        Object.assign(s, { load_count: s.load_count + 1, ...state.afterSave });
        return reply(before);
      }
      if (m === 'PUT') { Object.assign(s, { enabled: data.enabled, status: data.enabled ? 'loaded' : 'disabled' }); return reply(s); }
      if (m === 'DELETE') { state.scripts = state.scripts.filter((x) => x !== s); return reply({}); }
      return reply(s);
    }
    if (p === '/bmitmproxy-api/shutdown' && m === 'POST') {
      reply({});
      if (!state.ignoreShutdown) setTimeout(stop, 30);
      return;
    }
    return reply('not here', 404, 'text/plain');
  });

  // /updates: a WebSocket, as mitmweb's (only what is needed: text frames out, a close in).
  web.on('upgrade', (req, sock) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/updates' || url.searchParams.get('token') !== config.token) {
      sock.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    clients.add(sock);
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => {});
    sock.on('data', (b) => { if ((b[0] & 0x0f) === 0x8) { sock.end(Buffer.from([0x88, 0])); } });
  });

  web.listen(webPort, '127.0.0.1', () => {
    fs.writeFileSync(path.join(dir, 'serving.json'), JSON.stringify({ pid: process.pid, api: `http://127.0.0.1:${webPort}`, proxyPort }));
  });

  // The settings before a takeover, as the real backend records them (it removes the record once
  // it has put them back: when turned off, or on a clean exit).
  const recordFile = path.join(dir, 'system-proxy.json');
  function record() {
    const services = config.recordServices ?? [{ name: 'Wi-Fi', web: { enabled: true, host: '127.0.0.1', port: 7890 }, secure: { enabled: true, host: '127.0.0.1', port: 7890 } }];
    fs.writeFileSync(recordFile, JSON.stringify({ version: 1, port: proxyPort, pid: process.pid, upstream: 'http://127.0.0.1:7890', services }));
  }
  const unrecord = () => fs.rmSync(recordFile, { force: true });

  function stop() {
    unrecord();
    fs.rmSync(path.join(dir, 'serving.json'), { force: true });
    for (const c of clients) c.destroy();
    web.close();
    proxy.close();
    wg.close();
    process.exit(0);
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

function body(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  });
}

function frame(text) {
  const p = Buffer.from(text);
  const n = p.length;
  let head;
  if (n < 126) head = Buffer.from([0x81, n]);
  else if (n < 65536) head = Buffer.from([0x81, 126, n >> 8, n & 255]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, p]);
}

function tcpFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false)).listen(port, '0.0.0.0', () => s.close(() => resolve(true)));
  });
}

function udpFree(port) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.once('error', () => { s.close(); resolve(false); });
    s.bind(port, '0.0.0.0', () => s.close(() => resolve(true)));
  });
}

/** What a test asks of a running stand-in (its /__fake/ endpoints, and its API with the token). */
async function ask(api, pathname, init = {}) {
  const r = await fetch(api + pathname, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init.headers } });
  return r.json();
}

module.exports = { install, main, ask, TOKEN };
