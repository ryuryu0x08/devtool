// Proxy & Capture's backend, run by the desktop app: the page picks a backend (a driver in
// backends/) and its entry, the program to run; this checks the entry, starts it or finds it
// already running, and stops it. It says each change as it happens rather than being asked:
//
// - a backend it started: its exit, from the process itself (code or signal, and what it printed);
// - one it found running: its WebSocket closing, then whether the process is still there;
// - the system's proxy settings changed (by the backend, Clash, the user): from macOS's own change
//   notices (scutil), for the page to look again.
//
// A backend that takes over the system proxy records the settings before (the driver's
// takeover()); this keeps the last record it saw. Once the backend has put things back (turned
// off, stopped, or its guard after it ended), whatever still points at its port is put back from
// that record: the backend leaves one half of a service (HTTP or HTTPS) when another program has
// changed the other, and nothing at all when it ends with no guard. Told as { type: 'repaired' }.
//
// Nothing is written down: what runs is found by looking at the processes (`ps`), so a backend
// left running (this app quit hard) is found and used again. Waiting for a backend to come up is
// the one place it asks again and again, for a few seconds at most.
//
// Errors are CaptureError(code, params), turned into the user's words by the page.

const { spawn } = require('node:child_process');
const dgram = require('node:dgram');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

class CaptureError extends Error {
  constructor(code, params = {}) {
    super(code + (Object.keys(params).length ? ' ' + JSON.stringify(params) : ''));
    this.code = code;
    this.params = params;
  }
}

const READY_TIMEOUT_MS = 30_000;
const READY_EVERY_MS = 200;
const STOP_TIMEOUT_MS = 15_000;
const SIGNAL_WAIT_MS = 5000;
const SOCKET_RETRY_MAX_MS = 5000;
const SYSTEM_PROXY_SETTLE_MS = 300;
const TAIL_LINES = 20;
const SHELL_TIMEOUT_MS = 5000;
/** After the backend ends: how long its guard may take to put the system proxy back first. */
const RECORD_WAIT_MS = 10_000;
/** One read or change of a system proxy setting: one that takes longer is given up on. */
const SYSTEM_CALL_MS = 20_000;
/** Quitting waits this long at most for the system proxy to be put back. */
const QUIT_WAIT_MS = 30_000;
const ENTRY_MAX = 4096;

/** What runs: off, starting, on, stopping; and how the last one ended. */
const OFF = Object.freeze({ state: 'off', backend: null, entry: null, pid: null, owned: false, api: null, token: null, proxyPort: null, version: null, exit: null });

/** A program run to its end: its exit code and what it printed (each line told to onLine). */
function run(file, args, { env, cwd, timeout = 15_000, onLine } = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(file, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: e.message });
      return;
    }
    const out = { stdout: '', stderr: '' };
    const partial = { stdout: '', stderr: '' };
    for (const k of ['stdout', 'stderr']) {
      p[k].setEncoding('utf8');
      p[k].on('data', (s) => {
        out[k] += s;
        if (!onLine) return;
        const lines = (partial[k] + s).split('\n');
        partial[k] = lines.pop();
        for (const l of lines) onLine(l);
      });
    }
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    let ended = false;
    const end = (code, extra = '') => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (onLine) for (const k of ['stdout', 'stderr']) if (partial[k]) onLine(partial[k]);
      resolve({ code, stdout: out.stdout, stderr: out.stderr + extra });
    };
    p.on('error', (e) => end(-1, e.message));
    p.on('close', (code) => end(code ?? -1));
  });
}

/** The last lines a program printed, kept as it runs. */
function tailOf() {
  let lines = [];
  let partial = '';
  return {
    push(s) {
      const parts = (partial + s).split('\n');
      partial = parts.pop();
      lines = [...lines, ...parts].slice(-TAIL_LINES);
    },
    text: () => [...lines, partial].filter(Boolean).join('\n').slice(-2000),
  };
}

function which(name, PATH) {
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).isFile()) {
        fs.accessSync(file, fs.constants.X_OK);
        return file;
      }
    } catch {
      /* not here */
    }
  }
  return null;
}

/**
 * Where programs are looked for: the login shell's PATH (an app opened from Finder gets only the
 * system's), then this process's. Asked once.
 */
let searchPathOnce = null;
function searchPath() {
  searchPathOnce ??= (async () => {
    const shell = process.env.SHELL || os.userInfo().shell || '/bin/sh';
    const r = await run(shell, ['-lc', 'printf %s "$PATH"'], { timeout: SHELL_TIMEOUT_MS, env: process.env });
    const dirs = [...(r.code === 0 ? r.stdout.trim() : '').split(path.delimiter), ...(process.env.PATH ?? '').split(path.delimiter)];
    return [...new Set(dirs.filter(Boolean))].join(path.delimiter);
  })();
  return searchPathOnce;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** True when `p` settles within `ms`. */
const within = (p, ms) => Promise.race([p.then(() => true, () => true), sleep(ms).then(() => false)]);
/** `p`, or a failure once `ms` have passed. */
function bounded(p, ms) {
  let timer;
  return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out after ' + ms + ' ms')), ms); })]).finally(() => clearTimeout(timer));
}

function tcpFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}
function udpFree(port) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.once('error', () => { s.close(); resolve(false); });
    s.bind(port, '0.0.0.0', () => s.close(() => resolve(true)));
  });
}
function anyTcpPort(host) {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, host, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}
/** A proxy port: TCP for HTTP and UDP for WireGuard, free on all addresses (devices connect to it). */
const proxyPortFree = async (port) => (await tcpFree(port)) && (await udpFree(port));
async function anyProxyPort() {
  for (let i = 0; i < 20; i++) {
    const port = await anyTcpPort('0.0.0.0');
    if (await udpFree(port)) return port;
  }
  throw new CaptureError('no-port');
}

class Capture {
  /**
   * drivers: { [id]: driver } (backends/*.cjs). origin: the page's, allowed to call the backend.
   * emit(event): { type: 'state', state } | { type: 'system-proxy' } | { type: 'log', line } |
   * { type: 'progress', what } (a fix beginning) | { type: 'repaired', items, failed? }.
   * systemProxy: the system's settings (sysproxy-mac.cjs on macOS; null: none put back).
   */
  constructor(o) {
    this.drivers = o.drivers;
    this.origin = o.origin;
    this.emit = o.emit ?? (() => {});
    this.searchPath = o.searchPath ?? searchPath;
    this.home = o.home ?? os.homedir();
    this.readyTimeoutMs = o.readyTimeoutMs ?? READY_TIMEOUT_MS;
    this.stopTimeoutMs = o.stopTimeoutMs ?? STOP_TIMEOUT_MS;
    this.watchSystemProxy = o.watchSystemProxy ?? process.platform === 'darwin';
    this.systemProxy = o.systemProxy !== undefined ? o.systemProxy : process.platform === 'darwin' ? require('./sysproxy-mac.cjs') : null;
    this.recordWaitMs = o.recordWaitMs ?? RECORD_WAIT_MS;
    this.quitWaitMs = o.quitWaitMs ?? QUIT_WAIT_MS;
    /** What runs: its takeover record ({ file, read }) and the last one seen. */
    this.takeover = null;
    /** Putting back what the last one left: settles when done (a start waits for it). */
    this.repairing = Promise.resolve();
    this.repairPending = false;
    this.s = { ...OFF };
    this.busy = false;
    /** The backend this app started: its process, its exit, its last lines; and whether we are ending it. */
    this.child = null;
    this.ending = false;
    this.socket = null;
    this.scutil = null;
  }

  get state() {
    return { ...this.s };
  }

  backends() {
    return Object.values(this.drivers).map((d) => ({ id: d.id, name: d.name, download: !!d.download }));
  }

  driver(id) {
    const d = Object.hasOwn(this.drivers, id) ? this.drivers[id] : null;
    if (!d) throw new CaptureError('no-backend', { id });
    return d;
  }

  /** An entry as the page gives it: an absolute path, or one under ~/. */
  entryPath(entry) {
    const e = String(entry ?? '').trim();
    const full = e === '~' || e.startsWith('~/') ? path.join(this.home, e.slice(1)) : e;
    if (!full || full.length > ENTRY_MAX || !path.isAbsolute(full)) throw new CaptureError('bad-entry', { entry: e });
    return path.normalize(full);
  }

  /**
   * What the drivers get: the environment (PATH as the user's shell has it), ways to run and find
   * programs, and `log` for lines the page should see as they come (an update's output).
   */
  async ctx(log = () => {}) {
    const PATH = await this.searchPath();
    const env = { ...process.env, PATH };
    return {
      env,
      home: this.home,
      log,
      run: (file, args, o = {}) => run(file, args, { env, cwd: this.home, ...o }),
      which: (name) => which(name, PATH),
    };
  }

  async exclusive(fn) {
    if (this.busy) throw new CaptureError('busy');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  set(change) {
    this.s = { ...this.s, ...change };
    this.emit({ type: 'state', state: this.state });
  }

  /** Nothing runs now; `exit` says how the last one ended. Returns its takeover, to put back what it left. */
  off(exit) {
    this.stopWatching();
    const { pid, backend, entry } = this.s;
    const t = this.takeover;
    this.takeover = null;
    this.s = { ...OFF, exit: { pid, backend, entry, at: Date.now(), ...exit } };
    this.emit({ type: 'state', state: this.state });
    return t;
  }

  /** It ended by itself: what it left is put back as soon as its guard has had its turn. */
  ended(exit) {
    const t = this.off(exit);
    this.repairPending = true;
    this.repairing = this.settle(t).catch(() => { /* told as a failed repair */ }).finally(() => { this.repairPending = false; });
  }

  /** Something to finish before the app quits: a backend it started, or putting back what one left. */
  get quitWork() {
    return (this.s.owned && this.s.state !== 'off') || !!this.repairPending;
  }

  /** On: the backend's takeover record, as it is now (one found running may have taken over already). */
  track(d, info) {
    this.takeover = d.takeover ? { ...d.takeover(info), record: null } : null;
    if (this.takeover) this.takeover.record = this.takeover.read();
  }

  /**
   * After the backend: its record (still there if it ended without putting things back, else the
   * last one seen), once the backend or its guard is done with it; then what still points at it.
   */
  async settle(t) {
    if (!t || !this.systemProxy) return { repaired: [] };
    const rec = t.read() ?? t.record;
    if (!rec) return { repaired: [] };
    await untilRemoved(t.file, this.recordWaitMs);
    return this.repair(rec);
  }

  /** Each half (HTTP, HTTPS) of each recorded service still pointing at the backend's port, set back as recorded. */
  async repair(rec) {
    const sp = this.systemProxy;
    const pointsAt = (v) => !!v && v.enabled && ['127.0.0.1', 'localhost', '::1'].includes(v.host) && v.port === rec.port;
    const repaired = [];
    const failed = [];
    for (const s of rec.services) {
      let now;
      try {
        now = await bounded(sp.read(s.name), SYSTEM_CALL_MS);
      } catch {
        continue; // the service is gone, or can't be read now
      }
      for (const kind of ['web', 'secure']) {
        if (!pointsAt(now[kind])) continue;
        try {
          await bounded(sp.set(s.name, kind, s[kind]), SYSTEM_CALL_MS);
          repaired.push({ service: s.name, kind });
        } catch (e) {
          failed.push({ service: s.name, kind, error: String(e?.message ?? e) });
        }
      }
    }
    const r = failed.length ? { repaired, failed } : { repaired };
    if (repaired.length || failed.length) this.emit({ type: 'repaired', items: repaired, ...(failed.length ? { failed } : {}) });
    return r;
  }

  /**
   * While on, as the system proxy changes: the takeover record seen again; gone (turned off from
   * the page or by the backend) means the backend has put things back, and what it left is.
   */
  async checkProxy() {
    const t = this.takeover;
    if (!t || !this.systemProxy) return { repaired: [] };
    const now = t.read();
    if (now) {
      t.record = now;
      return { repaired: [] };
    }
    const rec = t.record;
    t.record = null;
    return rec ? this.repair(rec) : { repaired: [] };
  }

  /** The first existing of: the program on the login shell's PATH, then where its installer puts it. */
  async defaultEntry(id) {
    const d = this.driver(id);
    const c = await this.ctx();
    const found = c.which(d.command);
    if (found) return found;
    for (const file of d.candidates(this.home)) if (fs.existsSync(file)) return file;
    return null;
  }

  async inspect(id, entry) {
    return this.driver(id).inspect(this.entryPath(entry), await this.ctx());
  }

  /** Fixes what the check found (driver's fix), each line of its output told as it comes. */
  async fix(id, entry) {
    const d = this.driver(id);
    const e = this.entryPath(entry);
    return this.exclusive(async () => {
      if (this.s.state !== 'off' && this.s.entry === e) throw new CaptureError('running', { pid: this.s.pid });
      const c = await this.ctx((line) => this.emit({ type: 'log', line }));
      return d.fix(e, { ...c, progress: (what) => this.emit({ type: 'progress', what }) });
    });
  }

  /** A running `<entry> serve` that this app didn't start (from a terminal, or before this app quit). */
  async scan(d, entry) {
    const c = await this.ctx();
    const r = await c.run('ps', ['axww', '-o', 'pid=,command=']);
    for (const line of r.stdout.split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!m || Number(m[1]) === process.pid) continue;
      const ports = d.match(m[2], entry);
      if (ports) return { pid: Number(m[1]), ...ports };
    }
    return null;
  }

  /** Uses a running one: its API answers with the entry's token. */
  async attach(id, d, entry, info, found) {
    const token = readToken(info.tokenPath);
    const conn = { api: `http://127.0.0.1:${found.webPort}`, token };
    let st;
    try {
      st = await d.ready(conn);
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      throw new CaptureError('found-unreachable', { pid: found.pid, api: conn.api });
    }
    this.track(d, info);
    this.set({ state: 'on', backend: id, entry, pid: found.pid, owned: false, api: conn.api, token, proxyPort: st.proxyPort ?? found.proxyPort, version: st.version ?? info.version, exit: null });
    this.watch(d);
  }

  /** Looks for one already running and uses it. The state either way. */
  async find(id, entry) {
    const d = this.driver(id);
    const e = this.entryPath(entry);
    return this.exclusive(async () => {
      await this.repairing;
      if (this.s.state !== 'off') return this.state;
      const info = await d.inspect(e, await this.ctx());
      if (info.status !== 'ok') return this.state;
      const found = await this.scan(d, e);
      if (found) await this.attach(id, d, e, info, found);
      return this.state;
    });
  }

  /**
   * Running when this returns: started (and up), found already running, or already so.
   * outcome: started | attached | already; warnings: [{ code, … }].
   */
  async start(id, entry) {
    const d = this.driver(id);
    const e = this.entryPath(entry);
    return this.exclusive(async () => {
      if (this.s.state === 'on') {
        if (this.s.backend === id && this.s.entry === e) return { outcome: 'already', state: this.state, warnings: [] };
        throw new CaptureError('other-running', { backend: this.s.backend, entry: this.s.entry, pid: this.s.pid });
      }
      // What the last one left is put back first: a new one may use the same port.
      await this.repairing;
      const c = await this.ctx();
      const info = await d.inspect(e, c);
      if (info.status !== 'ok') throw new CaptureError('unusable', info);
      const found = await this.scan(d, e);
      if (found) {
        await this.attach(id, d, e, info, found);
        return { outcome: 'attached', state: this.state, warnings: [] };
      }

      const warnings = [];
      let proxyPort = d.defaultProxyPort;
      if (!(await proxyPortFree(proxyPort))) {
        const used = await anyProxyPort();
        warnings.push({ code: 'proxy-port-busy', port: proxyPort, by: await portHolder(c, proxyPort), used });
        proxyPort = used;
      }
      const webPort = await anyTcpPort('127.0.0.1');
      await this.spawn(id, d, e, info, c, proxyPort, webPort);
      return { outcome: 'started', state: this.state, warnings };
    });
  }

  async spawn(id, d, entry, info, c, proxyPort, webPort) {
    const { file, args } = d.launch(entry, { proxyPort, webPort, origin: this.origin });
    this.set({ state: 'starting', backend: id, entry, pid: null, owned: true, api: null, token: null, proxyPort, version: info.version, exit: null });
    const tail = tailOf();
    const child = spawn(file, args, { env: c.env, cwd: this.home, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', (err) => resolve({ code: -1, signal: null, error: err.message }));
    });
    child.stdout.setEncoding('utf8').on('data', tail.push);
    child.stderr.setEncoding('utf8').on('data', tail.push);
    this.child = { proc: child, exited, tail };
    // Its end, whenever it comes: told at once (unless this app is the one ending it).
    exited.then(({ code, signal, error }) => {
      if (this.child?.proc !== child) return;
      this.child = null;
      if (!this.ending) this.ended({ reason: 'exited', code, signal, error, tail: tail.text() });
    });

    const api = `http://127.0.0.1:${webPort}`;
    let gone = false;
    exited.then(() => (gone = true));
    const deadline = Date.now() + this.readyTimeoutMs;
    while (!gone) {
      const token = readToken(info.tokenPath);
      if (token) {
        try {
          const st = await d.ready({ api, token });
          this.track(d, info);
          this.set({ state: 'on', pid: child.pid, api, token, proxyPort: st.proxyPort ?? proxyPort, version: st.version ?? info.version });
          this.watch(d);
          return;
        } catch (e) {
          if (e instanceof CaptureError) {
            await this.end(child.pid, { reason: 'failed', error: e.code });
            throw e;
          }
          /* not up yet */
        }
      }
      if (Date.now() > deadline) {
        await this.end(child.pid, { reason: 'timeout', tail: tail.text() });
        throw new CaptureError('timeout', { seconds: Math.round(this.readyTimeoutMs / 1000), tail: tail.text() });
      }
      await within(exited, READY_EVERY_MS);
    }
    const { code, signal, error } = await exited;
    throw new CaptureError('exited', { exitCode: code, signal, error, tail: tail.text() });
  }

  /** Ends the backend this app started, by signal, and says why. */
  async end(pid, exit) {
    const ch = this.child;
    this.ending = true;
    try {
      if (ch) await this.signal(ch.proc.pid, ch.exited);
    } finally {
      this.ending = false;
      this.child = null;
    }
    this.off({ ...exit, pid });
  }

  /** SIGTERM, then SIGKILL; `gone` settles when it has exited. */
  async signal(pid, gone) {
    for (const sig of ['SIGTERM', 'SIGKILL']) {
      try {
        process.kill(pid, sig);
      } catch {
        return;
      }
      if (await within(gone, SIGNAL_WAIT_MS)) return;
    }
  }

  /**
   * Stops what runs: asked to shut down (it puts the system proxy back), then ended by signal if it
   * doesn't; then what it left pointing at itself is put back (repaired: [{ service, kind }]).
   */
  async stop() {
    return this.exclusive(async () => {
      if (this.s.state !== 'on') return { outcome: 'not-running' };
      const d = this.driver(this.s.backend);
      const { pid, owned, api, token } = this.s;
      // Its record as it is now: the backend removes it as it puts things back.
      const t = this.takeover;
      if (t) t.record = t.read() ?? t.record;
      this.set({ state: 'stopping' });
      this.stopWatching();
      const ch = owned ? this.child : null;
      this.ending = true;
      try {
        const gone = ch ? ch.exited : untilGone(pid, this.stopTimeoutMs + 2 * SIGNAL_WAIT_MS);
        await d.shutdown({ api, token }).catch(() => { /* already going, or not answering: the signal ends it */ });
        if (!(await within(gone, this.stopTimeoutMs))) await this.signal(pid, gone);
      } finally {
        this.ending = false;
        if (ch) this.child = null;
      }
      this.off({ reason: 'stopped', pid });
      return { outcome: 'stopped', pid, ...(await this.settle(t)) };
    });
  }

  /** The app quits: a backend it started is stopped; one it found running is left as it was. */
  async quit() {
    if (this.s.state === 'on' && this.s.owned) await this.stop().catch(() => {});
    await within(this.repairing, this.quitWaitMs);
    this.stopWatching();
  }

  /** While on: the system proxy's changes; for one found running, its WebSocket (its end). */
  watch(d) {
    this.watchSystem();
    if (!this.s.owned) this.watchSocket(d, this.s.pid, 0);
  }

  watchSocket(d, pid, attempt) {
    if (this.s.state !== 'on' || this.s.pid !== pid || typeof WebSocket !== 'function') return;
    const ws = new WebSocket(d.events({ api: this.s.api, token: this.s.token }));
    this.socket = ws;
    let opened = false;
    ws.addEventListener('open', () => { opened = true; });
    ws.addEventListener('close', () => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.s.state !== 'on' || this.s.pid !== pid) return;
      if (!alive(pid)) {
        this.ended({ reason: 'gone' });
        return;
      }
      // Still there (restarting its web server, or busy): connect again, waiting longer each time.
      const next = opened ? 0 : attempt + 1;
      setTimeout(() => this.watchSocket(d, pid, next), Math.min(SOCKET_RETRY_MAX_MS, 250 * 2 ** next));
    });
    ws.addEventListener('error', () => { /* followed by close */ });
  }

  watchSystem() {
    if (!this.watchSystemProxy || this.scutil) return;
    let p;
    try {
      p = spawn('/usr/sbin/scutil', [], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      return;
    }
    p.on('error', () => { if (this.scutil === p) this.scutil = null; });
    p.on('exit', () => { if (this.scutil === p) this.scutil = null; });
    // The proxy settings macOS uses, and each network service's own (a key pattern: no quotes).
    p.stdin.write('n.add State:/Network/Global/Proxies\nn.add Setup:/Network/Service/[^/]+/Proxies pattern\nn.watch\n');
    let settle = null;
    p.stdout.setEncoding('utf8').on('data', (s) => {
      if (!proxyChanged(s)) return;
      clearTimeout(settle);
      settle = setTimeout(async () => {
        await this.checkProxy().catch(() => { /* told as a failed repair */ });
        this.emit({ type: 'system-proxy' });
      }, SYSTEM_PROXY_SETTLE_MS);
    });
    this.scutil = p;
  }

  stopWatching() {
    const ws = this.socket;
    this.socket = null;
    try { ws?.close(); } catch { /* closing */ }
    this.scutil?.kill();
    this.scutil = null;
  }
}

/** scutil's output says a watched key changed: "… changedKey [0] = State:/Network/Global/Proxies". */
const proxyChanged = (text) => /\bchangedKey \[\d+\] = \S*Proxies\b/.test(text);

function readToken(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Settles when the file is gone (told by the folder's change notices), or after `ms`. */
function untilRemoved(file, ms) {
  return new Promise((resolve) => {
    if (!fs.existsSync(file)) return resolve();
    let w = null;
    const done = () => { clearTimeout(timer); w?.close(); resolve(); };
    const timer = setTimeout(done, ms);
    try {
      w = fs.watch(path.dirname(file), () => { if (!fs.existsSync(file)) done(); });
      w.on('error', () => { /* the timer ends the wait */ });
    } catch {
      /* no notices here: the timer ends the wait */
    }
    if (!fs.existsSync(file)) done(); // removed while the watch was being set up
  });
}

/** Settles when the process is gone (one this app didn't start: no exit event to wait for). */
async function untilGone(pid, ms) {
  const deadline = Date.now() + ms;
  while (alive(pid) && Date.now() < deadline) await sleep(100);
}

/** Who holds a TCP port: "Name (pid N)", or null when it can't be told. */
async function portHolder(c, port) {
  const r = await c.run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
  const pid = /^p(\d+)$/m.exec(r.stdout)?.[1];
  const name = /^c(.+)$/m.exec(r.stdout)?.[1];
  return pid ? `${name ?? '?'} (pid ${pid})` : null;
}

/** The page's asks, over IPC: { ok, value } or { ok: false, error: { code, … } }. Only from the app's own page. */
function register(capture, ipcMain, fromOwnPage) {
  const str = (v) => typeof v === 'string' && v.length <= ENTRY_MAX;
  const call = (action, id, entry) => {
    switch (action) {
      case 'backends':
        return capture.backends();
      case 'get':
        return capture.state;
      case 'stop':
        return capture.stop();
      case 'check-proxy':
        return capture.checkProxy();
      case 'default-entry':
        if (!str(id)) break;
        return capture.defaultEntry(id);
      case 'inspect':
      case 'fix':
      case 'find':
      case 'start':
        if (!str(id) || !str(entry)) break;
        return capture[action](id, entry);
    }
    throw new CaptureError('bad-request', { action: String(action) });
  };
  ipcMain.handle('capture', async (e, action, id, entry) => {
    if (!fromOwnPage(e)) return null;
    try {
      return { ok: true, value: await call(action, id, entry) };
    } catch (err) {
      return { ok: false, error: err instanceof CaptureError ? { code: err.code, ...err.params } : { code: 'internal', message: String(err?.message ?? err) } };
    }
  });
}

module.exports = { Capture, CaptureError, register, proxyChanged };
