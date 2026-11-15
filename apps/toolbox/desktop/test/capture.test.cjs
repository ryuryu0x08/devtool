// The capture backends' launcher (capture.cjs) with the bmitmproxy driver, against a stand-in
// bmitmproxy (fake-bmitmproxy.cjs) laid out as pipx lays out the real one: the entry is checked
// without being run, started, found when it already runs, stopped, and each change (its exit
// included) is told as it happens.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, describe, it } = require('node:test');
const { Capture, CaptureError, proxyChanged } = require('../capture.cjs');
const sysproxyMac = require('../sysproxy-mac.cjs');
const bmitmproxy = require('../backends/bmitmproxy.cjs');
const fake = require('./fake-bmitmproxy.cjs');

const POSIX = process.platform !== 'win32';
const dirs = [];
const procs = [];
const launchers = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-'));
  dirs.push(d);
  return d;
}
after(async () => {
  for (const c of launchers) await c.quit();
  for (const p of procs) try { process.kill(p, 'SIGKILL'); } catch { /* gone */ }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * A launcher over the bmitmproxy driver, without the login shell, the system proxy's watch or the
 * user's home; its default proxy port one that is free (this computer's 8888 may be taken).
 */
function make(o = {}) {
  const events = [];
  const c = new Capture({
    drivers: { bmitmproxy: { ...bmitmproxy, defaultProxyPort: freePort(), ...o.driver } },
    origin: 'app://toolbox',
    searchPath: async () => o.path ?? process.env.PATH,
    home: o.home ?? tmp(),
    emit: (e) => events.push(e),
    watchSystemProxy: false,
    systemProxy: o.systemProxy ?? null,
    recordWaitMs: o.recordWaitMs,
    quitWaitMs: o.quitWaitMs,
    readyTimeoutMs: o.readyTimeoutMs ?? 10_000,
    stopTimeoutMs: o.stopTimeoutMs ?? 5_000,
  });
  launchers.push(c);
  const next = (pred) => new Promise((resolve) => {
    const found = events.find((e) => e.type === 'state' && pred(e.state));
    if (found) return resolve(found.state);
    const emit = c.emit;
    c.emit = (e) => { emit(e); if (e.type === 'state' && pred(e.state)) { c.emit = emit; resolve(e.state); } };
  });
  return { c, events, next };
}

/** A port free on all addresses now (TCP and UDP), different each time. */
let nextPort = 20000 + (process.pid % 20000);
function freePort() {
  const { execFileSync } = require('node:child_process');
  for (;;) {
    const port = nextPort++;
    const free = execFileSync(process.execPath, ['-e', `
      const net = require('node:net'), dgram = require('node:dgram');
      const t = net.createServer().once('error', () => process.stdout.write('0')).listen(${port}, '0.0.0.0', () => {
        const u = dgram.createSocket('udp4');
        u.once('error', () => { t.close(); process.stdout.write('0'); });
        u.bind(${port}, '0.0.0.0', () => { u.close(); t.close(); process.stdout.write('1'); });
      });`]).toString();
    if (free === '1') return port;
  }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const holdPort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '0.0.0.0', () => resolve(s)); });
const rejects = async (p, code) => {
  await assert.rejects(p, (e) => { assert.ok(e instanceof CaptureError, String(e)); assert.equal(e.code, code); return true; });
};

describe('the entry, checked without running it', { skip: !POSIX }, () => {
  it('a current bmitmproxy: its version', async () => {
    const f = fake.install(tmp());
    const { c } = make();
    assert.deepEqual(await c.inspect('bmitmproxy', f.entry), { status: 'ok', version: '0.1.1', tokenPath: f.tokenPath });
  });

  it('not there, not a program, not Python, a broken install', async () => {
    const { c } = make();
    const d = tmp();
    assert.equal((await c.inspect('bmitmproxy', path.join(d, 'nope'))).status, 'missing');
    assert.equal((await c.inspect('bmitmproxy', d)).status, 'not-executable');
    fs.writeFileSync(path.join(d, 'plain'), 'x');
    assert.equal((await c.inspect('bmitmproxy', path.join(d, 'plain'))).status, 'not-executable');
    fs.writeFileSync(path.join(d, 'sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
    assert.deepEqual(await c.inspect('bmitmproxy', path.join(d, 'sh')), { status: 'unknown', reason: 'not-python' });
    const broken = fake.install(tmp(), { probeFails: true });
    const r = await c.inspect('bmitmproxy', broken.entry);
    assert.equal(r.status, 'unknown');
    assert.equal(r.reason, 'probe-failed');
    assert.match(r.tail, /ImportError: a broken install/);
  });

  it('one that needs fixing first: older (no serve) and installed from a folder that has it; a fresh install without distutils', async () => {
    const { c } = make();
    const src = tmp();
    fs.mkdirSync(path.join(src, 'admin_server'));
    fs.writeFileSync(path.join(src, 'admin_server', 'serve.py'), '');
    const old = fake.install(tmp(), { serve: false, source: src });
    assert.deepEqual(await c.inspect('bmitmproxy', old.entry), { status: 'needs-fix', version: '0.1.1', fixes: ['reinstall'], source: src });
    const fresh = fake.install(tmp(), { distutils: false });
    assert.deepEqual(await c.inspect('bmitmproxy', fresh.entry), { status: 'needs-fix', version: '0.1.1', fixes: ['setuptools'], source: null });
    // Not a venv (a system Python): nothing is installed into it
    fs.rmSync(path.join(fresh.venv, 'pyvenv.cfg'));
    assert.deepEqual(await c.inspect('bmitmproxy', fresh.entry), { status: 'unknown', reason: 'no-distutils' });
  });

  it('an older one that can\'t be fixed from here: said so, with where it was installed from', async () => {
    const { c } = make();
    assert.deepEqual(await c.inspect('bmitmproxy', fake.install(tmp(), { serve: false }).entry), { status: 'outdated', version: '0.1.1', source: null });
    const src = tmp(); // old code there too
    assert.deepEqual(await c.inspect('bmitmproxy', fake.install(tmp(), { serve: false, source: src }).entry), { status: 'outdated', version: '0.1.1', source: src });
  });

  it('a ~ path is the home folder; a relative path is refused', async () => {
    const home = tmp();
    const f = fake.install(path.join(home, 'x'));
    const { c } = make({ home });
    assert.equal((await c.inspect('bmitmproxy', '~/x/bin/bmitmproxy')).status, 'ok');
    await rejects(c.inspect('bmitmproxy', 'bin/bmitmproxy'), 'bad-entry');
    await rejects(c.inspect('nope', f.entry), 'no-backend');
  });

  it('the default entry: on the login shell\'s PATH, else where pipx puts it, else none', async () => {
    const f = fake.install(tmp());
    assert.equal(await make({ path: path.dirname(f.entry) + ':/usr/bin' }).c.defaultEntry('bmitmproxy'), f.entry);
    const home = tmp();
    assert.equal(await make({ home, path: '/usr/bin' }).c.defaultEntry('bmitmproxy'), null);
    fake.install(path.join(home, '.local'));
    assert.equal(await make({ home, path: '/usr/bin' }).c.defaultEntry('bmitmproxy'), path.join(home, '.local', 'bin', 'bmitmproxy'));
  });
});

describe('starting and stopping', { skip: !POSIX }, () => {
  it('starts it, says when it is up, and stops it: the backend shut down, not killed', async () => {
    const f = fake.install(tmp());
    const { c, events } = make();
    const r = await c.start('bmitmproxy', f.entry);
    assert.equal(r.outcome, 'started');
    assert.deepEqual(r.warnings, []);
    const s = c.state;
    assert.equal(s.state, 'on');
    assert.equal(s.owned, true);
    assert.equal(s.token, f.token);
    assert.equal(s.entry, f.entry);
    assert.match(s.api, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(alive(s.pid));
    assert.deepEqual(events.filter((e) => e.type === 'state').map((e) => e.state.state), ['starting', 'on']);
    // Run as `<entry> serve`, its API on this computer only, open to the toolbox's page
    const argv = await fake.ask(s.api, '/__fake/argv');
    assert.equal(argv[1], f.entry);
    assert.deepEqual(argv.slice(2), ['serve', '--proxy-port', String(s.proxyPort), '--web-port', new URL(s.api).port, '--origin', 'app://toolbox']);
    // Again: already so
    assert.equal((await c.start('bmitmproxy', f.entry)).outcome, 'already');

    const calls = await fake.ask(s.api, '/__fake/calls');
    const stop = await c.stop();
    assert.deepEqual(stop, { outcome: 'stopped', pid: s.pid, repaired: [] });
    assert.equal(c.state.state, 'off');
    assert.equal(c.state.exit.reason, 'stopped');
    assert.ok(!alive(s.pid));
    assert.ok(calls.length >= 1);
    assert.deepEqual(await c.stop(), { outcome: 'not-running' });
  });

  it('an exit is told when it happens, with how it ended', async () => {
    const f = fake.install(tmp());
    const { c, next } = make();
    await c.start('bmitmproxy', f.entry);
    const pid = c.state.pid;
    const gone = next((s) => s.state === 'off');
    process.kill(pid, 'SIGKILL');
    const s = await gone;
    assert.equal(s.exit.reason, 'exited');
    assert.equal(s.exit.signal, 'SIGKILL');
    assert.equal(s.exit.pid, pid);
  });

  it('a backend that exits while starting: why, from what it printed', async () => {
    const f = fake.install(tmp(), { exitOnStart: { code: 1, stderr: '✗ 代理端口 8888 已被 Python (pid 1) 占用\n' } });
    const { c } = make();
    await assert.rejects(c.start('bmitmproxy', f.entry), (e) => {
      assert.equal(e.code, 'exited');
      assert.equal(e.params.exitCode, 1);
      assert.match(e.params.tail, /代理端口 8888 已被 Python/);
      return true;
    });
    assert.equal(c.state.state, 'off');
  });

  it('a backend that never comes up: stopped, and said so', async () => {
    const f = fake.install(tmp(), { startDelayMs: 60_000 });
    const { c } = make({ readyTimeoutMs: 800 });
    await rejects(c.start('bmitmproxy', f.entry), 'timeout');
    assert.equal(c.state.state, 'off');
    const pid = c.state.exit?.pid;
    assert.ok(pid && !alive(pid));
  });

  it('an older or missing entry is not started', async () => {
    const { c } = make();
    await rejects(c.start('bmitmproxy', fake.install(tmp(), { serve: false }).entry), 'unusable');
    await rejects(c.start('bmitmproxy', path.join(tmp(), 'nope')), 'unusable');
  });

  it('the proxy port taken: another one, and a warning naming it', async () => {
    const held = await holdPort();
    const port = held.address().port;
    try {
      const f = fake.install(tmp());
      const { c } = make({ driver: { defaultProxyPort: port } });
      const r = await c.start('bmitmproxy', f.entry);
      assert.notEqual(c.state.proxyPort, port);
      assert.equal(r.warnings.length, 1);
      assert.equal(r.warnings[0].code, 'proxy-port-busy');
      assert.equal(r.warnings[0].port, port);
      assert.equal(r.warnings[0].used, c.state.proxyPort);
      if (process.platform === 'darwin') assert.match(r.warnings[0].by ?? '', /\(pid \d+\)/);
      await c.stop();
    } finally {
      held.close();
    }
  });

  it('a backend that ignores the shutdown is ended by signal', async () => {
    const f = fake.install(tmp(), { ignoreShutdown: true });
    const { c } = make({ stopTimeoutMs: 400 });
    await c.start('bmitmproxy', f.entry);
    const pid = c.state.pid;
    assert.equal((await c.stop()).outcome, 'stopped');
    assert.ok(!alive(pid));
  });

  it('one thing at a time', async () => {
    const f = fake.install(tmp(), { startDelayMs: 300 });
    const { c } = make();
    const starting = c.start('bmitmproxy', f.entry);
    await rejects(c.stop(), 'busy');
    await starting;
    await c.stop();
  });

  it('quitting stops a backend this app started', async () => {
    const f = fake.install(tmp());
    const { c } = make();
    await c.start('bmitmproxy', f.entry);
    const pid = c.state.pid;
    await c.quit();
    assert.ok(!alive(pid));
  });
});

describe('one already running', { skip: !POSIX }, () => {
  /** Started as from a terminal: `bmitmproxy serve …`, not by the launcher. */
  async function outside(f) {
    const web = await holdPort();
    const webPort = web.address().port;
    web.close();
    const proxy = await holdPort();
    const proxyPort = proxy.address().port;
    proxy.close();
    const p = spawn(f.entry, ['serve', '--proxy-port', String(proxyPort), '--web-port', String(webPort), '--origin', 'app://toolbox'], { stdio: 'ignore' });
    procs.push(p.pid);
    const api = `http://127.0.0.1:${webPort}`;
    for (let i = 0; i < 100; i++) {
      try { await fake.ask(api, '/__fake/argv'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    return { pid: p.pid, api, proxyPort };
  }

  it('is found and used, not started again; its exit is told too; stopping it shuts it down', async () => {
    const f = fake.install(tmp());
    const o = await outside(f);
    const { c, next } = make();
    // Another entry's instance is not this one
    assert.equal((await c.find('bmitmproxy', fake.install(tmp()).entry)).state, 'off');
    const s = await c.find('bmitmproxy', f.entry);
    assert.equal(s.state, 'on');
    assert.equal(s.owned, false);
    assert.equal(s.pid, o.pid);
    assert.equal(s.api, o.api);
    assert.equal(s.proxyPort, o.proxyPort);
    assert.equal((await c.start('bmitmproxy', f.entry)).outcome, 'already');

    // Ended from outside: told by its WebSocket closing, not by looking again and again
    const gone = next((x) => x.state === 'off');
    process.kill(o.pid, 'SIGKILL');
    assert.equal((await gone).exit.reason, 'gone');

    const again = await outside(f);
    assert.equal((await c.start('bmitmproxy', f.entry)).outcome, 'attached');
    assert.equal((await c.stop()).outcome, 'stopped');
    assert.ok(!alive(again.pid));
  });

  it('quitting leaves one that this app did not start', async () => {
    const f = fake.install(tmp());
    const o = await outside(f);
    const { c } = make();
    await c.find('bmitmproxy', f.entry);
    await c.quit();
    assert.ok(alive(o.pid));
    process.kill(o.pid, 'SIGKILL');
  });
});

describe('fixing an entry', { skip: !POSIX }, () => {
  /** A stand-in pipx: notes each call; `runpip … install` makes the entry current but without distutils, `inject` adds it. */
  function pipx(f) {
    const bin = tmp();
    const calls = path.join(bin, 'calls.json');
    fs.writeFileSync(calls, '[]');
    fs.writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}');
    fs.writeFileSync(path.join(bin, 'pipx'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify([...JSON.parse(fs.readFileSync(${JSON.stringify(calls)}, 'utf8')), [...args, 'PIPX_HOME=' + process.env.PIPX_HOME, 'PIPX_BIN_DIR=' + process.env.PIPX_BIN_DIR]]));
const file = ${JSON.stringify(path.join(f.dir, 'config.json'))};
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
if (args[0] === 'runpip' && args[2] === 'install') {
  if (process.env.FAKE_PIPX_FAIL) { console.error('fatal: early EOF'); process.exit(1); }
  fs.writeFileSync(file, JSON.stringify({ ...cfg, serve: true, distutils: false, version: '0.1.2' })); console.log('Successfully installed mitmproxy-addons-0.1.2');
}
if (args[0] === 'inject') { fs.writeFileSync(file, JSON.stringify({ ...cfg, distutils: true })); console.log('injected package setuptools into venv mitmproxy-addons'); }
`, { mode: 0o755 });
    return { path: bin + ':/usr/bin:/bin', calls: () => JSON.parse(fs.readFileSync(calls, 'utf8')) };
  }

  it('an older one: upgraded in its own venv from the folder it was installed from (its pipx folders), then given setuptools; each line told', async () => {
    const src = tmp();
    fs.mkdirSync(path.join(src, 'admin_server'));
    fs.writeFileSync(path.join(src, 'admin_server', 'serve.py'), '');
    const f = fake.install(tmp(), { serve: false, source: src, backend: 'pip' });
    const px = pipx(f);
    const { c, events } = make({ path: px.path });
    const r = await c.fix('bmitmproxy', f.entry);
    assert.deepEqual(r, { status: 'ok', version: '0.1.2', tokenPath: f.tokenPath });
    // In place (its venv, its Python, its pipx backend kept): `pipx install --force` removes the
    // venv when the install fails, leaving nothing that runs. pipx pointed at the folders this
    // install is in, not its default ones (another install of the same name may be there).
    const where = ['PIPX_HOME=' + f.dir, 'PIPX_BIN_DIR=' + path.join(f.dir, 'bin')];
    assert.deepEqual(px.calls(), [
      ['runpip', 'mitmproxy-addons', 'install', '--upgrade', src, ...where],
      ['inject', 'mitmproxy-addons', 'setuptools', ...where],
    ]);
    const lines = events.filter((e) => e.type === 'log').map((e) => e.line);
    assert.ok(lines.includes('Successfully installed mitmproxy-addons-0.1.2'));
    assert.ok(lines.includes('injected package setuptools into venv mitmproxy-addons'));
  });

  it('an upgrade that fails (the network, say): said why, the install left as it was', async () => {
    const src = tmp();
    fs.mkdirSync(path.join(src, 'admin_server'));
    fs.writeFileSync(path.join(src, 'admin_server', 'serve.py'), '');
    const f = fake.install(tmp(), { serve: false, source: src });
    const px = pipx(f);
    const { c } = make({ path: px.path });
    process.env.FAKE_PIPX_FAIL = '1';
    try {
      await assert.rejects(c.fix('bmitmproxy', f.entry), (e) => e.code === 'fix-failed' && e.params.fix === 'reinstall' && e.params.exitCode === 1 && /early EOF/.test(e.params.tail));
    } finally {
      delete process.env.FAKE_PIPX_FAIL;
    }
    assert.deepEqual(await c.inspect('bmitmproxy', f.entry), { status: 'needs-fix', version: '0.1.1', fixes: ['reinstall'], source: src });
  });

  it('a venv pipx didn\'t make: setuptools by its own pip', async () => {
    const f = fake.install(tmp(), { distutils: false });
    const { c } = make();
    assert.equal((await c.fix('bmitmproxy', f.entry)).status, 'ok');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'pip-calls.json'), 'utf8')), ['install', 'setuptools']);
  });

  it('nothing to do for one that is fine; refused for one that can\'t be fixed', async () => {
    const { c } = make({ path: '/usr/bin:/bin' });
    const ok = fake.install(tmp());
    assert.equal((await c.fix('bmitmproxy', ok.entry)).status, 'ok');
    await rejects(c.fix('bmitmproxy', fake.install(tmp(), { serve: false }).entry), 'cannot-fix');
    await rejects(c.fix('bmitmproxy', path.join(tmp(), 'nope')), 'cannot-fix');
  });

  it('a fix that doesn\'t take: said so, not tried forever', async () => {
    const f = fake.install(tmp(), { distutils: false, source: tmp() });
    // pipx that answers but changes nothing
    const bin = tmp();
    fs.writeFileSync(path.join(bin, 'pipx'), '#!/bin/sh\necho done\n', { mode: 0o755 });
    const { c } = make({ path: bin + ':/usr/bin:/bin' });
    await rejects(c.fix('bmitmproxy', f.entry), 'fix-failed');
  });

  it('not started until fixed', async () => {
    const { c } = make();
    await rejects(c.start('bmitmproxy', fake.install(tmp(), { distutils: false }).entry), 'unusable');
  });

  it('the driver offers no download (an internal project)', () => {
    assert.deepEqual(make().c.backends(), [{ id: 'bmitmproxy', name: 'bmitmproxy', download: false }]);
  });
});

describe('the system proxy after the backend: what it left pointing at itself is put back', { skip: !POSIX }, () => {
  /** The system's proxy settings, in memory, as networksetup would read and write them. */
  function system(services) {
    const s = structuredClone(services);
    return {
      settings: s,
      services: async () => Object.keys(s),
      read: async (name) => structuredClone(s[name]),
      set: async (name, kind, v) => { s[name][kind] = { ...v }; },
    };
  }
  const clash = { enabled: true, host: '127.0.0.1', port: 7890 };
  const at = (port) => ({ enabled: true, host: '127.0.0.1', port });
  const takeOver = async (c) => fake.ask(c.state.api, '/bmitmproxy-api/system-proxy', { method: 'PUT', body: JSON.stringify({ enabled: true }) });

  it('ended from outside, its record left: each setting still pointing at it gets back what it was, nothing else is touched', async () => {
    const f = fake.install(tmp(), { recordServices: [
      { name: 'Wi-Fi', web: clash, secure: clash },
      { name: 'USB', web: { enabled: false, host: '', port: 0 }, secure: { enabled: false, host: '', port: 0 } },
    ] });
    const sys = system({ 'Wi-Fi': { web: clash, secure: clash }, USB: { web: { enabled: false, host: '', port: 0 }, secure: { enabled: false, host: '', port: 0 } } });
    const { c, events, next } = make({ systemProxy: sys, recordWaitMs: 300 });
    await c.start('bmitmproxy', f.entry);
    const port = c.state.proxyPort;
    await takeOver(c);
    await c.checkProxy();
    // As the backend takes over, then another program changes one of them back (Clash's guard)
    Object.assign(sys.settings['Wi-Fi'], { web: clash, secure: at(port) });
    Object.assign(sys.settings.USB, { web: at(port), secure: at(port) });
    const repaired = new Promise((resolve) => { const emit = c.emit; c.emit = (e) => { emit(e); if (e.type === 'repaired') resolve(e.items); }; });
    process.kill(c.state.pid, 'SIGKILL');
    await next((s) => s.state === 'off');
    assert.deepEqual(await repaired, [{ service: 'Wi-Fi', kind: 'secure' }, { service: 'USB', kind: 'web' }, { service: 'USB', kind: 'secure' }]);
    assert.deepEqual(sys.settings, { 'Wi-Fi': { web: clash, secure: clash }, USB: { web: { enabled: false, host: '', port: 0 }, secure: { enabled: false, host: '', port: 0 } } });
    assert.ok(events.some((e) => e.type === 'repaired'));
  });

  it('stopped: the backend put things back but skipped a service half changed by another program; that half is put back too', async () => {
    const f = fake.install(tmp());
    const sys = system({ 'Wi-Fi': { web: clash, secure: clash } });
    const { c } = make({ systemProxy: sys, recordWaitMs: 300 });
    await c.start('bmitmproxy', f.entry);
    await takeOver(c);
    await c.checkProxy();
    sys.settings['Wi-Fi'] = { web: clash, secure: at(c.state.proxyPort) };
    const r = await c.stop();
    assert.deepEqual(r.repaired, [{ service: 'Wi-Fi', kind: 'secure' }]);
    assert.deepEqual(sys.settings['Wi-Fi'], { web: clash, secure: clash });
  });

  it('quitting waits for putting things back, but not forever (a system tool that hangs)', async () => {
    const f = fake.install(tmp());
    const hung = { services: async () => ['Wi-Fi'], read: () => new Promise(() => {}), set: async () => {} };
    const { c, next } = make({ systemProxy: hung, recordWaitMs: 50, quitWaitMs: 500 });
    await c.start('bmitmproxy', f.entry);
    await takeOver(c);
    await c.checkProxy();
    process.kill(c.state.pid, 'SIGKILL');
    await next((s) => s.state === 'off');
    assert.equal(c.quitWork, true);
    const t0 = Date.now();
    await c.quit();
    assert.ok(Date.now() - t0 < 2000, 'quit took ' + (Date.now() - t0) + ' ms');
  });

  it('turned off while it runs (its record gone): checked at once; never taken over: nothing to do', async () => {
    const f = fake.install(tmp());
    const sys = system({ 'Wi-Fi': { web: clash, secure: clash } });
    const { c } = make({ systemProxy: sys });
    await c.start('bmitmproxy', f.entry);
    assert.deepEqual(await c.checkProxy(), { repaired: [] });
    await takeOver(c);
    await c.checkProxy();
    sys.settings['Wi-Fi'] = { web: at(c.state.proxyPort), secure: clash };
    await fake.ask(c.state.api, '/bmitmproxy-api/system-proxy', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    assert.deepEqual(await c.checkProxy(), { repaired: [{ service: 'Wi-Fi', kind: 'web' }] });
    assert.deepEqual(sys.settings['Wi-Fi'], { web: clash, secure: clash });
    assert.deepEqual(await c.checkProxy(), { repaired: [] });
    await c.stop();
  });
});

describe('the bmitmproxy driver', () => {
  it('knows its own processes by their entry and `serve`, and reads their ports', () => {
    const e = '/Users/x/.local/bin/bmitmproxy';
    const py = '/Users/x/Library/Application Support/pipx/venvs/mitmproxy-addons/bin/python';
    assert.deepEqual(bmitmproxy.match(`${py} ${e} serve --proxy-port 8899 --web-port 18081 --origin app://toolbox`, e), { webPort: 18081, proxyPort: 8899 });
    assert.deepEqual(bmitmproxy.match(`${py} ${e} serve`, e), { webPort: 8081, proxyPort: 8888 });
    assert.deepEqual(bmitmproxy.match(`${py} ${e} serve --web-port=9000`, e), { webPort: 9000, proxyPort: 8888 });
    assert.equal(bmitmproxy.match(`${py} ${e}`, e), null); // its window (App mode)
    assert.equal(bmitmproxy.match(`${py} /other${e} serve`, e), null);
    assert.equal(bmitmproxy.match(`${py} ${e} served`, e), null);
    assert.equal(bmitmproxy.match(`vim ${e}.serve`, e), null);
  });

  it('finds the Python of an entry written as pipx writes it, plain or through env', () => {
    const { interpreter } = bmitmproxy;
    assert.equal(interpreter('#!/Users/x/.local/pipx/venvs/m/bin/python\n# -*- coding: utf-8 -*-\n'), '/Users/x/.local/pipx/venvs/m/bin/python');
    assert.equal(interpreter(`#!/bin/sh\n'''exec' "/Users/x/Library/Application Support/pipx/venvs/m/bin/python" "$0" "$@"\n' '''\n`), '/Users/x/Library/Application Support/pipx/venvs/m/bin/python');
    assert.equal(interpreter('#!/usr/bin/env python3.12\n', (n) => '/opt/homebrew/bin/' + n), '/opt/homebrew/bin/python3.12');
    assert.equal(interpreter('#!/bin/sh\necho hi\n'), null);
    assert.equal(interpreter('#!/usr/bin/env node\n', (n) => '/usr/bin/' + n), null);
    assert.equal(interpreter('MZ\x90\x00'), null);
  });
});

describe('the system proxy watch', () => {
  it('knows a change from what scutil prints (captured from a real run on macOS)', () => {
    const real = 'notification callback (store address = 0x100939850).\n   6:29:51.385 changedKey [0] = Setup:/Network/Service/18F21D24-B1FD-4351-9073-FDBE380E7420/Proxies\n';
    assert.equal(proxyChanged(real), true);
    assert.equal(proxyChanged('   6:29:52.929 (+1.544) changedKey [0] = State:/Network/Global/Proxies\n'), true);
    // What it prints when set up, before anything changes
    assert.equal(proxyChanged('  notifier key [0] = State:/Network/Global/Proxies\n'), false);
    assert.equal(proxyChanged('notification callback (store address = 0x1).\n'), false);
  });
});

describe('the system proxy on macOS', () => {
  it('reads a setting as networksetup prints it (captured from a real run)', () => {
    assert.deepEqual(sysproxyMac.parse('Enabled: Yes\nServer: 127.0.0.1\nPort: 7890\nAuthenticated Proxy Enabled: 0\n'), { enabled: true, host: '127.0.0.1', port: 7890 });
    assert.deepEqual(sysproxyMac.parse('Enabled: No\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0\n'), { enabled: false, host: '', port: 0 });
  });
});
