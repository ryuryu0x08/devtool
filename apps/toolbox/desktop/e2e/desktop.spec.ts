// The desktop app as a user meets it: it opens the toolbox from its own origin and serves only
// the build; storage and the window size stay between launches; other sites open in the system
// browser and the window stays on the toolbox; a second launch shows the first one; only the
// permissions the toolbox uses are granted; the title bar is the page's own, in its theme; on macOS
// closing the window hides it; the settings show the app's updates.
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
  // As the system lets it be (a small screen keeps a window within it): that size comes back.
  const size = () => app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0].getBounds();
    return [b.width, b.height];
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 900, height: 600 }));
  const set = await size();
  expect(set[0]).toBeLessThan(1280);
  await app.close();
  ({ app, page } = await launch(dir));
  expect(await page.evaluate(() => localStorage.getItem('tb.kept'))).toBe('1');
  expect(await size()).toEqual(set);
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

test('no system title bar: the page draws the strip at the top, in the theme’s colours', async ({}, info) => {
  const { app, page } = await launch(info.outputPath('data'));
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\bdesktop\\b.*\\bdesktop-${process.platform}\\b`));
  // The strip drags the window; what is below it starts under it.
  const strip = await page.evaluate(() => {
    const region = (sel: string) => getComputedStyle(document.querySelector(sel)!, '::before').getPropertyValue('-webkit-app-region') || getComputedStyle(document.querySelector(sel)!, '::before').getPropertyValue('app-region');
    const top = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
    return { side: region('.side'), main: region('.main'), content: top('.content'), search: top('.search-btn') };
  });
  expect(strip.side).toBe('drag');
  expect(strip.main).toBe('drag');
  expect(strip.content).toBeGreaterThanOrEqual(36);
  expect(strip.search).toBeGreaterThanOrEqual(36);
  if (process.platform === 'darwin') {
    // The window buttons sit in the strip, over the sidebar.
    const p = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getWindowButtonPosition());
    expect(p).toEqual({ x: 14, y: 11 });
  }
  // The theme chosen in the settings: the title bar takes its colours.
  const colors = () => app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0] as unknown as { titleBarColors?: object }).titleBarColors);
  await page.locator('.side-link').click();
  await page.locator('.settings .seg button', { hasText: /^(深色|Dark)$/ }).click();
  await expect.poll(colors).toEqual({ bg: '#121211', fg: '#ededeb' });
  await page.locator('.settings .seg button', { hasText: /^(浅色|Light)$/ }).click();
  await expect.poll(colors).toEqual({ bg: '#f6f6f4', fg: '#1b1b1d' });
  // The bridge is all the page gets, and it takes plain colours only.
  const bridge = await page.evaluate(() => {
    const d = (window as unknown as { toolboxDesktop: { titleBar(a: string, b: string): void } }).toolboxDesktop;
    d.titleBar('red; background: url(x)', '#000000');
    const update = (d as unknown as { update: object }).update;
    return { keys: Object.keys(d).sort(), update: Object.keys(update).sort(), node: typeof (window as unknown as { require?: unknown }).require };
  });
  expect(bridge).toEqual({ keys: ['platform', 'titleBar', 'update'], update: ['check', 'get', 'install', 'onState', 'restart', 'setAuto'], node: 'undefined' });
  await page.waitForTimeout(300);
  expect(await colors()).toEqual({ bg: '#f6f6f4', fg: '#1b1b1d' });
  await app.close();
});

test('macOS: closing the window only hides it; the Dock icon shows it again as it was; quitting quits', async ({}, info) => {
  test.skip(process.platform !== 'darwin', 'macOS only: elsewhere closing the window quits');
  const { app, page } = await launch(info.outputPath('data'));
  await page.evaluate(() => ((window as unknown as { kept: number }).kept = 1));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  const shown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
  await expect.poll(shown).toEqual([false]);
  // The Dock icon clicked.
  await app.evaluate(({ app }) => app.emit('activate'));
  await expect.poll(shown).toEqual([true]);
  // The same page, not loaded anew.
  expect(await page.evaluate(() => (window as unknown as { kept: number }).kept)).toBe(1);
  await app.close();
});

test('the settings show the app’s updates: only a macOS app built by build.sh updates itself', async ({}, info) => {
  const { app, page } = await launch(info.outputPath('data'));
  const state = await page.evaluate(() => (window as unknown as { toolboxDesktop: { update: { get(): Promise<{ state: string; reason: string | null }> } } }).toolboxDesktop.update.get());
  await page.locator('.side-link').click();
  if (process.platform !== 'darwin') {
    expect(state).toMatchObject({ state: 'unsupported', reason: 'platform' });
    await expect(page.locator('[data-update="unsupported"]')).toContainText(/macOS/);
  } else if (state.state === 'unsupported') {
    expect(state.reason).toBe('not-built-here');
    await expect(page.locator('[data-update="unsupported"]')).toContainText('build.sh');
  } else {
    // Built by build.sh: the check button, and automatic updates off until turned on (kept).
    await expect(page.locator('.settings .btn', { hasText: /^(检查更新|Check for updates)$/ })).toBeVisible();
    await page.locator('.settings .seg button', { hasText: /^(开|On)$/ }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { toolboxDesktop: { update: { get(): Promise<{ auto: boolean }> } } }).toolboxDesktop.update.get().then((s) => s.auto))).toBe(true);
  }
  await app.close();
});
