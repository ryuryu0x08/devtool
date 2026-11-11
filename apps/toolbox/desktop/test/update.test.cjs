// The updater without Electron: where updates are fetched from, which commits count, moving the
// clone forward, and putting the new app in place once the old one has quit.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const u = require('../update.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-update-'));
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, encoding: 'utf8' }).trim();
function commit(dir, file, text, message) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

test('a GitHub ssh address has an https one; others none', () => {
  assert.equal(u.httpsFor('git@github.com:ryuryu0x08/devtool.git'), 'https://github.com/ryuryu0x08/devtool.git');
  assert.equal(u.httpsFor('ssh://git@github.com/o/r'), 'https://github.com/o/r');
  assert.equal(u.httpsFor('https://github.com/o/r'), null);
  assert.equal(u.httpsFor('git@gitlab.com:o/r.git'), null);
});

test('build-info.json: read when whole, else none (an app not built by build.sh)', () => {
  const d = tmp();
  assert.equal(u.readInfo(d), null);
  fs.writeFileSync(path.join(d, 'build-info.json'), JSON.stringify({ sourceDir: '/src', commit: 'a'.repeat(40), built: 'x' }));
  assert.equal(u.readInfo(d).sourceDir, '/src');
  fs.writeFileSync(path.join(d, 'build-info.json'), JSON.stringify({ sourceDir: '/src', commit: 'nope' }));
  assert.equal(u.readInfo(d), null);
});

test('only the stable branch commits that change the app count; the clone moves forward to it', async () => {
  const origin = tmp();
  git(origin, 'init', '-q', '--bare');
  const dev = tmp();
  git(dev, 'init', '-q');
  git(dev, 'remote', 'add', 'origin', origin);
  const first = commit(dev, 'apps/toolbox/a.txt', '1', 'first');
  git(dev, 'push', '-q', 'origin', 'HEAD:refs/heads/main', 'HEAD:refs/heads/' + u.BRANCH);
  const mine = tmp();
  git(mine, 'clone', '-q', origin, '.');
  assert.deepEqual(await u.newer(mine, first), { count: 0, subject: null });
  // A change elsewhere doesn't count; one to the toolbox (or the shared UI) does.
  commit(dev, 'apps/quotabar/b.txt', '1', 'quotabar only');
  commit(dev, 'packages/ui/c.css', '1', 'shared ui');
  commit(dev, 'apps/toolbox/a.txt', '2', 'toolbox: newer');
  commit(dev, 'apps/relay/d.txt', '1', 'relay only');
  git(dev, 'push', '-q', 'origin', 'HEAD:refs/heads/main', 'HEAD:refs/heads/' + u.BRANCH);
  assert.deepEqual(await u.newer(mine, first), { count: 2, subject: 'toolbox: newer' });
  await u.fastForward(mine);
  assert.equal(git(mine, 'rev-parse', 'HEAD'), git(dev, 'rev-parse', 'HEAD'));
  assert.equal(fs.readFileSync(path.join(mine, 'apps/toolbox/a.txt'), 'utf8'), '2');
});

test('a change of its own in the clone stops moving it forward, with git’s reason', async () => {
  const origin = tmp();
  git(origin, 'init', '-q', '--bare');
  const dev = tmp();
  git(dev, 'init', '-q');
  git(dev, 'remote', 'add', 'origin', origin);
  const first = commit(dev, 'apps/toolbox/a.txt', '1', 'first');
  git(dev, 'push', '-q', 'origin', 'HEAD:refs/heads/main', 'HEAD:refs/heads/' + u.BRANCH);
  const mine = tmp();
  git(mine, 'clone', '-q', origin, '.');
  commit(dev, 'apps/toolbox/a.txt', '2', 'newer');
  git(dev, 'push', '-q', 'origin', 'HEAD:refs/heads/' + u.BRANCH);
  commit(mine, 'apps/toolbox/a.txt', 'mine', 'local');
  await u.newer(mine, first);
  await assert.rejects(u.fastForward(mine), /git merge/);
});

test('the new app takes the old one’s place once the old one has quit, then opens', async () => {
  const d = tmp();
  const current = path.join(d, 'Toolbox.app');
  const fresh = path.join(d, 'new', 'Toolbox.app');
  fs.mkdirSync(current, { recursive: true });
  fs.mkdirSync(fresh, { recursive: true });
  fs.writeFileSync(path.join(current, 'v'), 'old');
  fs.writeFileSync(path.join(fresh, 'v'), 'new');
  const running = spawn('sleep', ['1']);
  const opened = path.join(d, 'opened');
  const openCmd = path.join(d, 'open.sh');
  fs.writeFileSync(openCmd, `#!/bin/bash\necho "$1" > ${JSON.stringify(opened)}\n`, { mode: 0o755 });
  u.swapAfterQuit(running.pid, current, fresh, true, openCmd);
  // Not before it quit.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fs.readFileSync(path.join(current, 'v'), 'utf8'), 'old');
  for (let i = 0; i < 50 && !fs.existsSync(opened); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.readFileSync(path.join(current, 'v'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(opened, 'utf8').trim(), current);
  assert.ok(!fs.existsSync(current + '.new'));
});

test('the bundle the app runs from', () => {
  assert.equal(u.bundleOf('/Applications/Toolbox.app/Contents/MacOS/Toolbox'), '/Applications/Toolbox.app');
  assert.equal(u.bundleOf('/opt/toolbox/toolbox'), null);
});
