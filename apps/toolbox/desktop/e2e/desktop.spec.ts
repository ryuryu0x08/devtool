// The desktop app as a user meets it: it opens the toolbox from its own origin and serves only
// the build; storage and the window size stay between launches; other sites open in the system
// browser and the window stays on the toolbox; a second launch shows the first one; only the
// permissions the toolbox uses are granted.
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';

const APP = process.env.TOOLBOX_APP!;

async function launch(dir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    executablePath: APP,
    args: [`--user-data-dir=${dir}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.app');
  return { app, page };
}

test('it opens the toolbox from app://toolbox and serves the build only', async ({}, info) => {
  const { app, page } = await launch(info.outputPath('data'));
  expect(page.url()).toBe('app://toolbox/');
  await expect(page).toHaveTitle('工具箱 · Toolbox');
  const status = (path: string) => page.evaluate((p) => fetch(p).then((r) => r.status), path);
  expect(await status('/favicon.svg')).toBe(200);
  // Its module workers load (they need a JavaScript type).
  const type = await page.evaluate(async () => {
    const src = [...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/'))!;
    return (await fetch(src)).headers.get('content-type');
  });
  expect(type).toMatch(/javascript/);
  // Nothing outside the build: the app's own code, paths that climb out, other hosts.
  for (const p of ['/main.cjs', '/package.json', '/%2e%2e/main.cjs', '/..%2fmain.cjs', '/assets/../../main.cjs', '/nope.html', '/%E0%A4%A']) {
    expect(await status(p), p).toBe(404);
  }
  // Another app:// host (asked from the app itself: a page can't reach another origin at all).
  expect(await app.evaluate(({ net }) => net.fetch('app://other/index.html').then((r) => r.status))).toBe(404);
  await app.close();
});

test('storage and the window size stay between launches', async ({}, info) => {
  const dir = info.outputPath('data');
  let { app, page } = await launch(dir);
  await page.evaluate(() => localStorage.setItem('tb.kept', '1'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1000, height: 700 }));
  await app.close();
  ({ app, page } = await launch(dir));
  expect(await page.evaluate(() => localStorage.getItem('tb.kept'))).toBe('1');
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  expect([b.width, b.height]).toEqual([1000, 700]);
  await app.close();
});

test('other sites open in the system browser; the window stays on the toolbox', async ({}, info) => {
  const { app, page } = await launch(info.outputPath('data'));
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] };
    g.opened = [];
    shell.openExternal = async (url: string) => void g.opened.push(url);
  });
  await page.evaluate(() => {
    window.open('https://example.com/a');
    const a = Object.assign(document.createElement('a'), { href: 'https://example.com/b', target: '_blank' });
    document.body.append(a);
    a.click();
    location.href = 'https://example.com/c';
  });
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
  // A file:// page (a file dropped on the window, say) isn't opened at all.
  await page.evaluate(() => (location.href = 'file:///etc/hosts'));
  await page.waitForTimeout(500);
  // Read from the app: Playwright keeps waiting for the navigations that were stopped.
  const shown = await app.evaluate(async ({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const wc = all[0].webContents;
    return { windows: all.length, url: wc.getURL(), toolbox: await wc.executeJavaScript("!!document.querySelector('.app')") };
  });
  expect(shown).toEqual({ windows: 1, url: 'app://toolbox/', toolbox: true });
  await app.close();
});

test('a second launch shows the first one and quits', async ({}, info) => {
  const dir = info.outputPath('data');
  const { app, page } = await launch(dir);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  const second = spawn(APP, [`--user-data-dir=${dir}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])], { stdio: 'ignore' });
  const code = await new Promise<number | null>((done) => {
    const t = setTimeout(() => (second.kill(), done(-1)), 15_000);
    second.on('exit', (c) => (clearTimeout(t), done(c)));
  });
  expect(code).toBe(0);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await expect(page.locator('.app')).toBeVisible();
  await app.close();
});

test('copying works; permissions the toolbox doesn’t use are refused', async ({}, info) => {
  const { app, page } = await launch(info.outputPath('data'));
  await page.bringToFront();
  await page.evaluate(() => navigator.clipboard.writeText('从工具箱复制'));
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('从工具箱复制');
  const states = await page.evaluate(async () => {
    const q = (name: string) => navigator.permissions.query({ name: name as PermissionName }).then((s) => s.state, () => 'error');
    return { geolocation: await q('geolocation'), notifications: await Notification.requestPermission(), camera: await q('camera') };
  });
  expect(states).toEqual({ geolocation: 'denied', notifications: 'denied', camera: 'denied' });
  await app.close();
});
