// Updates of the desktop app come from the git clone it was built from: build.sh writes
// build-info.json (the clone's folder, the commit) into the app. An update fetches a branch (the
// channel's: toolbox-stable, which CI moves only after the app was built and passed its tests on
// macOS, Windows and Linux; or main, as pushed, not waiting for CI); moves the clone forward to
// it; builds the app with build.sh (a build that fails changes nothing); and puts the new app in
// place of the running one once that has quit (it is in use until then).
// macOS only: there build.sh makes a devtool.app that can simply replace the old one (an app from
// before the rename, Toolbox.app, is replaced by it under the new name).

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Where updates come from: the branch CI moves once every test passed, or main as pushed. */
const CHANNELS = { stable: 'toolbox-stable', main: 'main' };
const BRANCH = CHANNELS.stable;
const remoteRef = (branch) => `refs/remotes/origin/${branch}`;
/** What the app is made of: an update counts only the commits that change these. */
const PATHS = ['apps/toolbox', 'packages/ui', 'package.json', 'package-lock.json'];

/** build-info.json beside main.cjs: { sourceDir, commit, built }; null when the app wasn't built by build.sh. */
function readInfo(dir) {
  try {
    const i = JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8'));
    return typeof i.sourceDir === 'string' && /^[0-9a-f]{40}$/.test(i.commit) ? i : null;
  } catch {
    return null;
  }
}

/**
 * The user's shell's environment (its PATH with node and npm, its ssh agent, its proxy): an app
 * opened from the Dock has a short one, and git over ssh then has no key. Read once.
 */
let shellEnvCache = null;
function shellEnv() {
  if (shellEnvCache) return shellEnvCache;
  const env = { ...process.env, PATH: [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':') };
  shellEnvCache = new Promise((done) => {
    const shell = process.env.SHELL || '/bin/zsh';
    const mark = '__TOOLBOX_ENV__';
    execFile(shell, ['-l', '-i', '-c', `printf '\\n${mark}\\n'; /usr/bin/env; printf '\\n${mark}\\n'`], { timeout: 10_000, env }, (err, out) => {
      const parts = String(out || '').split(`\n${mark}\n`);
      if (err || parts.length < 3) return done(env);
      const got = { ...env };
      for (const line of parts[1].split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) got[line.slice(0, i)] = line.slice(i + 1);
      }
      done(got);
    });
  });
  return shellEnvCache;
}

/** Runs a command in `dir`; its output, or an Error with the command's own message. */
async function run(cmd, args, dir, timeout = 30_000) {
  const env = await shellEnv();
  return new Promise((done, fail) => {
    execFile(cmd, args, { cwd: dir, env, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => {
      if (!err) return done(String(out));
      const why = String(errOut || out || '').trim().split('\n').slice(-3).join(' ') || err.message;
      // All it printed goes with the error (the update's log keeps it).
      fail(Object.assign(new Error(err.killed ? `${cmd} 超时` : `${cmd} ${args[0]}: ${why}`), { output: String(out || '') + String(errOut || '') }));
    });
  });
}

const git = (dir, args, timeout) => run('git', args, dir, timeout);

/** The https address of a GitHub ssh address (git@github.com:o/r.git, ssh://git@github.com/o/r); null otherwise. */
function httpsFor(remote) {
  let p = null;
  if (remote.startsWith('git@github.com:')) p = remote.slice('git@github.com:'.length);
  else if (remote.startsWith('ssh://') && remote.includes('github.com/')) p = remote.slice(remote.indexOf('github.com/') + 'github.com/'.length);
  p = p && p.replace(/^\/+/, '');
  return p ? 'https://github.com/' + p : null;
}

/** Fetches `branch` from origin; a GitHub ssh address that fails is tried over https (no key needed for a public repository). */
async function fetchStable(dir, branch = BRANCH) {
  const spec = `+refs/heads/${branch}:${remoteRef(branch)}`;
  try {
    await git(dir, ['fetch', '--quiet', '--no-tags', 'origin', spec], 90_000);
  } catch (first) {
    const origin = (await git(dir, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
    const https = httpsFor(origin);
    if (!https) throw first;
    try {
      await git(dir, ['-c', 'credential.interactive=never', 'fetch', '--quiet', '--no-tags', https, spec], 90_000);
    } catch (second) {
      throw new Error(`${first.message}; 改用 ${https} 也失败: ${second.message}`);
    }
  }
}

/** Fetches `branch`; how many of its commits since `commit` change the app, and the newest one's subject. */
async function newer(dir, commit, branch = BRANCH) {
  await fetchStable(dir, branch);
  const ref = remoteRef(branch);
  const count = Number((await git(dir, ['rev-list', '--count', `${commit}..${ref}`, '--', ...PATHS])).trim()) || 0;
  if (!count) return { count: 0, subject: null };
  const subject = (await git(dir, ['log', '-1', '--format=%s', ref, '--', ...PATHS])).trim();
  return { count, subject: subject || null };
}

/** Moves the clone forward to the fetched `branch` (only forward: local commits or changes in the way stop it, with git's reason). */
const fastForward = (dir, branch = BRANCH) => git(dir, ['merge', '--ff-only', '--quiet', remoteRef(branch)], 60_000);

/** Builds the app with build.sh (its output to `log`); the devtool.app it made. */
async function build(dir, log) {
  const desktop = path.join(dir, 'apps/toolbox/desktop');
  let out;
  try {
    out = await run('bash', ['build.sh'], desktop, 15 * 60_000);
  } catch (e) {
    // A failed build changes nothing; what it printed is kept to see why.
    if (log) fs.writeFileSync(log, e.output ?? e.message);
    throw e;
  }
  if (log) fs.writeFileSync(log, out);
  const release = path.join(desktop, 'release');
  const dirs = fs.readdirSync(release).filter((d) => d.startsWith('mac'));
  const made = ['devtool.app', 'Toolbox.app'].flatMap((n) => dirs.map((d) => path.join(release, d, n))).find((p) => fs.existsSync(p));
  if (!made) throw new Error('build.sh 没有编译出 devtool.app');
  return made;
}

/**
 * Puts `fresh` in place of `current` once process `pid` (the running app) has quit, under fresh's
 * name in current's folder (Toolbox.app, from before the rename, becomes devtool.app), and with
 * `reopen`, opens it. Runs on by itself (the app quits right after). The old one is removed only
 * once the copy is complete. The path the new app is at.
 */
function swapAfterQuit(pid, current, fresh, reopen, openCmd = 'open') {
  const target = path.join(path.dirname(current), path.basename(fresh));
  const script = [
    'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
    'rm -rf "$6.new" && cp -R "$3" "$6.new" || exit 1',
    'rm -rf "$2"',
    '[ "$2" = "$6" ] || rm -rf "$6"',
    'mv "$6.new" "$6" || exit 1',
    '[ "$4" = 1 ] && "$5" "$6"',
    'exit 0',
  ].join('\n');
  const child = spawn('/bin/bash', ['-c', script, 'swap', String(pid), current, fresh, reopen ? '1' : '0', openCmd, target], { detached: true, stdio: 'ignore' });
  child.unref();
  return target;
}

/** The app's bundle name (productName in package.json): what the Dock and Finder show. */
const BUNDLE = 'devtool.app';

/**
 * An app from before the rename (…/Toolbox.app): once process `pid` has quit, its bundle takes
 * the new name in the same folder (the Dock and Finder show a bundle's file name). Not while it
 * runs: it starts its helpers from inside its bundle. Nothing when there already is one by that
 * name. The path it will be at, or null.
 */
function renameAfterQuit(pid, current) {
  const target = path.join(path.dirname(current), BUNDLE);
  // Only the old name: any other bundle (Electron.app when run from the clone with `npm start`) is left alone.
  if (path.basename(current) !== 'Toolbox.app' || fs.existsSync(target)) return null;
  const script = [
    'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
    '[ -e "$3" ] || mv "$2" "$3"',
  ].join('\n');
  spawn('/bin/bash', ['-c', script, 'rename', String(pid), current, target], { detached: true, stdio: 'ignore' }).unref();
  return target;
}

/** The .app bundle the running executable is in (…/devtool.app/Contents/MacOS/devtool); null when it isn't in one. */
function bundleOf(exe) {
  const p = path.resolve(exe, '..', '..', '..');
  return p.endsWith('.app') ? p : null;
}

module.exports = { BRANCH, BUNDLE, CHANNELS, PATHS, renameAfterQuit, readInfo, shellEnv, httpsFor, fetchStable, newer, fastForward, build, swapAfterQuit, bundleOf, git };
