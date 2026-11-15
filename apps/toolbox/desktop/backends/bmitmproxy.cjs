// The bmitmproxy backend (mitmproxy-addons) for capture.cjs: how to check its entry without running
// it, start it, recognise one already running, reach its API and stop it.
//
// The entry is the `bmitmproxy` program pipx installs: a script that runs the venv's Python. It is
// checked by asking that Python (isolated, -I) what is installed, never by running the entry: an
// older bmitmproxy ignores its arguments, opens its window and ends whatever holds its ports. What
// this needs is `bmitmproxy serve` (no window, API on this computer only, behind a token). It is an
// internal project: there is nothing to download.
//
// mitmproxy-addons isn't ours to change, so what it gets wrong is checked and fixed from here:
// - it imports distutils, gone from Python 3.12 unless setuptools is installed: a fresh install on
//   3.12 fails to start. Fixed by adding setuptools to its venv (pipx inject, or the venv's pip).
// - an older one installed by pipx from a source folder that has `serve` is upgraded from there,
//   in its own venv (`pipx install --force` would remove the venv if the install failed).
// - turning the system proxy back, it skips a network service another program has changed one half
//   of (HTTP or HTTPS), leaving the other half pointing at a port nothing listens on: the settings
//   it recorded before taking over (takeover() reads them) let the app put that half back.
const fs = require('node:fs');
const path = require('node:path');
const { CaptureError } = require('../capture.cjs');

const API = '/bmitmproxy-api';
const DEFAULT_WEB_PORT = 8081;
const DEFAULT_PROXY_PORT = 8888;
const PROBE_TIMEOUT_MS = 15_000;
const FIX_TIMEOUT_MS = 10 * 60_000;
/** Each fix is tried once: one that doesn't take is said, not tried again. */
const FIXES_MAX = 4;
const TAKEOVER_FILE = 'system-proxy.json';
const REQUEST_TIMEOUT_MS = 3000;

/** Run by the entry's Python: what of mitmproxy-addons is installed (nothing of it is started). */
const PROBE = `
import json, importlib.util as u, importlib.metadata as m
def has(n):
    try: return u.find_spec(n) is not None
    except Exception: return False
o = {"pkg": has("admin_server"), "serve": has("admin_server.serve")}
try:
    import distutils.spawn
    o["distutils"] = True
except Exception: o["distutils"] = False
try: o["version"] = m.version("mitmproxy-addons")
except Exception: o["version"] = None
try:
    from client.script_api import script_api_token_path
    o["token_path"] = script_api_token_path()
except Exception: o["token_path"] = None
print(json.dumps(o))
`;

/**
 * The Python an entry runs: `#!<python>`, `#!/usr/bin/env python3` (found by `which`), or pipx's
 * form for a venv whose path has spaces (`#!/bin/sh` then `'''exec' "<python>" "$0" "$@"`).
 * Null when it isn't a Python program.
 */
function interpreter(head, which = () => null) {
  const first = head.split('\n', 1)[0];
  let file = null;
  if (/^#!\s*\/bin\/sh\s*$/.test(first)) {
    file = /^'''exec' "([^"]+)" "\$0" "\$@"$/m.exec(head)?.[1] ?? null;
  } else {
    const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(first);
    if (m) file = path.basename(m[1]) === 'env' && m[2] ? which(m[2]) : m[1];
  }
  return file && /^python[\d.]*$/.test(path.basename(file)) ? file : null;
}

/** What pipx recorded of the entry's venv: where it was installed from, and with which backend. */
function pipxRecord(python) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(python)), 'pipx_metadata.json'), 'utf8'));
    const source = m.main_package?.package_or_url;
    if (typeof source !== 'string') return null;
    // pipx names the venv after the package (and its --suffix)
    const venv = (m.main_package?.package ?? path.basename(venvOf(python))) + (m.main_package?.suffix ?? '');
    return { source, backend: typeof m.backend === 'string' ? m.backend : null, venv };
  } catch {
    return null;
  }
}

const venvOf = (python) => path.dirname(path.dirname(python));
/** A venv (its own site-packages, safe to install into), not a system Python. */
const isVenv = (python) => fs.existsSync(path.join(venvOf(python), 'pyvenv.cfg'));
/** The source folder pipx installed from has `serve`: reinstalling from it brings it. */
const hasServe = (source) => !!source && fs.existsSync(path.join(source, 'admin_server', 'serve.py'));

const lastLines = (text, n = 20) => text.trimEnd().split('\n').slice(-n).join('\n').slice(-2000);

function executable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The Python an entry runs, read from its first lines. */
function interpreterOf(entry, ctx) {
  const fd = fs.openSync(entry, 'r');
  const buf = Buffer.alloc(4096);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return interpreter(buf.subarray(0, n).toString('utf8'), ctx.which);
}

async function inspect(entry, ctx) {
  const st = fs.statSync(entry, { throwIfNoEntry: false });
  if (!st) return { status: 'missing' };
  if (!st.isFile() || !executable(entry)) return { status: 'not-executable' };
  const python = interpreterOf(entry, ctx);
  if (!python) return { status: 'unknown', reason: 'not-python' };
  const pipx = pipxRecord(python);
  const source = pipx?.source ?? null;
  const r = await ctx.run(python, ['-I', '-c', PROBE], { timeout: PROBE_TIMEOUT_MS });
  let p = null;
  try {
    if (r.code === 0) p = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    /* not what the probe prints */
  }
  if (!p) return { status: 'unknown', reason: 'probe-failed', tail: lastLines(r.stderr || r.stdout) };
  if (!p.pkg) return { status: 'unknown', reason: 'not-bmitmproxy' };
  if (!p.serve || !p.token_path) {
    return hasServe(source) ? { status: 'needs-fix', version: p.version, fixes: ['reinstall'], source } : { status: 'outdated', version: p.version, source };
  }
  if (p.distutils === false) {
    if (!pipx && !isVenv(python)) return { status: 'unknown', reason: 'no-distutils' };
    return { status: 'needs-fix', version: p.version, fixes: ['setuptools'], source };
  }
  return { status: 'ok', version: p.version, tokenPath: p.token_path };
}

/**
 * pipx pointed at the install the entry is in (PIPX_HOME holds venvs/<name>; the entry is in its
 * PIPX_BIN_DIR), not at its default folders: another install of the same name may be there.
 */
function pipxEnv(entry, python, ctx) {
  const venvs = path.dirname(venvOf(python));
  if (path.basename(venvs) !== 'venvs') return ctx.env;
  return { ...ctx.env, PIPX_HOME: path.dirname(venvs), PIPX_BIN_DIR: path.dirname(entry) };
}

/** What each fix runs: [program, args], given the entry's venv Python and what pipx recorded of it. */
const FIX = {
  /**
   * Upgraded from the source folder it was installed from, in its own venv: its Python and pipx's
   * backend (pip or uv, which resolve and build differently) stay as they are, and an upgrade that
   * fails (a dependency that can't be fetched, say) leaves the install as it was. `pipx install
   * --force` would instead remove the venv when the install fails.
   */
  reinstall: (python, rec, ctx) => [needPipx(ctx), ['runpip', rec.venv, 'install', '--upgrade', rec.source]],
  /** setuptools brings distutils back (Python 3.12 removed it): into pipx's venv by pipx, else by the venv's pip. */
  setuptools: (python, rec, ctx) => (rec ? [needPipx(ctx), ['inject', rec.venv, 'setuptools']] : [python, ['-m', 'pip', 'install', 'setuptools']]),
};

function needPipx(ctx) {
  const pipx = ctx.which('pipx');
  if (!pipx) throw new CaptureError('no-pipx');
  return pipx;
}

/**
 * Fixes the entry until it can be used: each fix the check asks for, in turn (a reinstall may then
 * need setuptools). Its output is told line by line (ctx.log), each fix as it begins (ctx.progress).
 * Nothing to fix: the check as it is. Can't be fixed from here: cannot-fix.
 */
async function fix(entry, ctx) {
  let info = await inspect(entry, ctx);
  const tried = new Set();
  while (info.status === 'needs-fix' && tried.size < FIXES_MAX) {
    const what = info.fixes[0];
    if (tried.has(what)) throw new CaptureError('fix-failed', { fix: what });
    tried.add(what);
    ctx.progress?.(what);
    const python = interpreterOf(entry, ctx);
    const rec = pipxRecord(python);
    const [file, args] = FIX[what](python, rec, ctx);
    const r = await ctx.run(file, args, { timeout: FIX_TIMEOUT_MS, onLine: ctx.log, env: rec ? pipxEnv(entry, python, ctx) : ctx.env });
    if (r.code !== 0) throw new CaptureError('fix-failed', { fix: what, exitCode: r.code, tail: lastLines(r.stderr || r.stdout) });
    info = await inspect(entry, ctx);
  }
  if (info.status !== 'ok') throw new CaptureError('cannot-fix', info);
  return info;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const setting = (v) => v && typeof v.enabled === 'boolean' && typeof v.host === 'string' && Number.isInteger(v.port);

/**
 * The settings it recorded before taking over the system proxy (beside its token): the port it
 * pointed them at, and each network service's HTTP (web) and HTTPS (secure) proxy as they were.
 * The record is there while taken over; it is removed once put back. Null: none, or unreadable.
 */
function takeover(info) {
  const file = path.join(path.dirname(info.tokenPath), TAKEOVER_FILE);
  return {
    file,
    read() {
      try {
        const r = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Number.isInteger(r.port) || !Array.isArray(r.services)) return null;
        const services = r.services.filter((s) => typeof s?.name === 'string' && setting(s.web) && setting(s.secure)).map(({ name, web, secure }) => ({ name, web, secure }));
        return { port: r.port, services };
      } catch {
        return null;
      }
    },
  };
}

/** A setting pointing at this computer's `port`, as the backend points them. */
const pointsAt = (v, port) => !!v && v.enabled && LOOPBACK.has(v.host) && v.port === port;

/** `<entry> serve`, its API on a port of this computer, open to the app's page. */
function launch(entry, { proxyPort, webPort, origin }) {
  return { file: entry, args: ['serve', '--proxy-port', String(proxyPort), '--web-port', String(webPort), '--origin', origin] };
}

/** A process (its command line, as `ps` shows it) that is `<entry> serve`: its ports. */
function match(command, entry) {
  const word = entry + ' serve';
  for (let at = command.indexOf(word); at >= 0; at = command.indexOf(word, at + 1)) {
    const end = at + word.length;
    if ((at > 0 && command[at - 1] !== ' ') || (end < command.length && command[end] !== ' ')) continue;
    const rest = command.slice(end);
    const port = (name, def) => Number(new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)(\\d+)`).exec(rest)?.[1] ?? def);
    return { webPort: port('web-port', DEFAULT_WEB_PORT), proxyPort: port('proxy-port', DEFAULT_PROXY_PORT) };
  }
  return null;
}

async function request(conn, pathname, init = {}) {
  return fetch(conn.api + pathname, { ...init, headers: { authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/** Up and answering as `serve`: what it says of itself. Not up yet: a network error. */
async function ready(conn) {
  const r = await request(conn, API + '/status');
  if (r.status === 401) throw new CaptureError('token-mismatch');
  // mitmweb without these endpoints: 404, or 403 from its DNS-rebinding guard
  if (r.status === 403 || r.status === 404) throw new CaptureError('incompatible', { status: r.status });
  if (!r.ok) throw new CaptureError('failed', { status: r.status });
  const s = await r.json();
  return { version: s.version, proxyPort: s.proxy_port, mode: s.mode };
}

async function shutdown(conn) {
  await request(conn, API + '/shutdown', { method: 'POST' });
}

/** Its WebSocket: open while it runs. */
const events = (conn) => `${conn.api.replace(/^http/, 'ws')}/updates?token=${encodeURIComponent(conn.token)}`;

module.exports = {
  id: 'bmitmproxy',
  name: 'bmitmproxy',
  /** The program's name, looked for on the login shell's PATH. */
  command: 'bmitmproxy',
  /** Where pipx puts it, when the PATH doesn't have it. */
  candidates: (home) => [path.join(home, '.local', 'bin', 'bmitmproxy')],
  /** Nothing to download: an internal project. */
  download: null,
  defaultProxyPort: DEFAULT_PROXY_PORT,
  inspect,
  fix,
  launch,
  match,
  ready,
  shutdown,
  events,
  takeover,
  pointsAt,
  interpreter,
};
