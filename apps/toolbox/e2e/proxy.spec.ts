// Proxy & Capture: offered in the macOS desktop app only. There, against a stand-in bmitmproxy
// that the app really runs (desktop/test/fake-bmitmproxy.cjs, laid out as pipx lays out the real
// one, answering its API with flows captured from a real run): the page is a slim bar over the
// capture; one click switches everything on (the bar says which part it is at, nothing more); what
// it captures (live list, filter, detail, cURL, clear with undo); the certificate and scripts; the
// system proxy changed by another program, and put back by the app; the backend quitting by
// itself; one already running found; an entry that needs fixing first, or can't be used; a start
// that fails, in one line with its details folded away; switching off.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { MITMWEB_FLOWS } from '../src/lib/proxy/mitmweb.fixture';
import type { MFlow } from '../src/lib/proxy/mitmproxy';
import { activeTool, clipboard, desktopApp, expect, HOME, IN_MAC_APP, open, test, toast } from './helpers';

interface Fake {
  dir: string;
  entry: string;
  venv: string;
  token: string;
  set(change: Record<string, unknown>): void;
  serving(): { pid: number; api: string; proxyPort: number } | null;
}
const fake = createRequire(import.meta.url)('../desktop/test/fake-bmitmproxy.cjs') as {
  install(dir: string, cfg?: Record<string, unknown>): Fake;
  ask(api: string, path: string, init?: RequestInit): Promise<unknown>;
};
const [GET, POST] = MITMWEB_FLOWS;

const rows = (page: Page) => page.locator('.px-tbody .px-tr');
const bar = (page: Page) => page.locator('.px-bar');
const status = (page: Page) => page.locator('.px-status');
const barButton = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true });
const chip = (page: Page, text: string | RegExp) => page.locator('.px-chip', { hasText: text });
const idle = (page: Page) => page.locator('.px-idle');

/** The stand-in, laid out in the test's folder. */
const install = (info: TestInfo, cfg: Record<string, unknown> = {}) => fake.install(info.outputPath('bmitmproxy'), { flows: [GET, POST], ...cfg });

/**
 * The tool open with this entry already chosen (as a user's earlier choice is kept). Every test
 * opens it so: with no entry the app would look for the program where it is usually installed,
 * and find (and use) the bmitmproxy of whoever runs the tests.
 */
async function openWith(page: Page, entry: string) {
  await page.goto(HOME);
  await page.evaluate((e) => {
    localStorage.clear();
    localStorage.setItem('tb.prefs', JSON.stringify({ o: { 'proxy.entry.bmitmproxy': e } }));
    localStorage.setItem('tb.tool', JSON.stringify('proxy'));
  }, entry);
  await page.reload();
  await page.waitForSelector('.app');
}

/** Switched on from the empty capture area: one click, and the capture shows. */
async function switchOn(page: Page) {
  await idle(page).getByRole('button', { name: '开启', exact: true }).click();
  await expect(status(page)).toHaveText(/^已开启 · 代理 127\.0\.0\.1:\d+$/);
  await expect(page.locator('.px-cap')).toBeVisible();
}

/** A port free on this computer now. */
const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address() as { port: number };
    s.close(() => resolve(port));
  });
});

const stopStandIn = (f: Fake) => { const s = f.serving(); if (s) try { process.kill(s.pid, 'SIGKILL'); } catch { /* gone */ } };

test('offered in the macOS desktop app only', async ({ page }) => {
  await open(page);
  await expect(page.locator('.nav-item', { hasText: '代理抓包' })).toHaveCount(IN_MAC_APP ? 1 : 0);
  // Where it isn't offered, a saved choice of it opens the first tool instead
  await openWith(page, '/nonexistent/bmitmproxy');
  expect(await activeTool(page)).toContain(IN_MAC_APP ? '代理抓包' : '时间戳转换');
});

test.describe('in the macOS desktop app', () => {
  test.skip(!IN_MAC_APP, 'offered in the macOS desktop app only');

  test('one click does it all, the bar saying only which part it is at; then the page is the capture', async ({ page }, info) => {
    // Slow to come up, so the bar can be seen while it waits
    const f = install(info, { startDelayMs: 1500 });
    try {
      await openWith(page, f.entry);
      await expect(status(page)).toHaveText('未开启');
      await expect(idle(page)).toContainText('开启后，经过这里的 HTTP / HTTPS 请求会实时显示在这里。');
      await idle(page).getByRole('button', { name: '开启', exact: true }).click();
      await expect(status(page)).toHaveText('正在启动 · 启动后端…');
      await expect(status(page)).toHaveText(/^已开启 · 代理 127\.0\.0\.1:\d+$/);
      const s = f.serving()!;
      await expect(status(page)).toHaveText(`已开启 · 代理 127.0.0.1:${s.proxyPort}`);
      // Run as `<entry> serve`, its API open to the app's page
      expect(await fake.ask(s.api, '/__fake/argv')).toEqual(expect.arrayContaining([f.entry, 'serve', '--origin', 'app://toolbox']));
      // The certificate trusted and the system proxy taken over, without asking
      await expect(chip(page, '系统代理')).toHaveAttribute('aria-pressed', 'true');
      await expect(chip(page, '证书')).toHaveText('证书');
      const calls = (await fake.ask(s.api, '/__fake/calls')) as { method: string; path: string; body: unknown }[];
      expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual(['POST /bmitmproxy-api/ca/trust', 'PUT /bmitmproxy-api/system-proxy']);

      // The bar is one slim row; the capture takes the rest of the window
      const barBox = (await bar(page).boundingBox())!;
      const capBox = (await page.locator('.px-cap').boundingBox())!;
      expect(barBox.height).toBeLessThanOrEqual(56);
      expect(capBox.height).toBeGreaterThan(page.viewportSize()!.height * 0.75);
      await expect(page.locator('.px-details')).toHaveCount(0);

      await expect(rows(page)).toHaveCount(2);
      await expect(rows(page).first()).toContainText('GET200httpbin.org/jsonjson429 B');
      // A request arriving over the WebSocket, then its update, then its removal
      const late: MFlow = { ...GET, id: '00000000-0000-4000-8000-000000000001', request: { ...(GET.request as object), path: '/late' } as MFlow['request'], response: undefined };
      const send = (m: unknown) => fake.ask(s.api, '/__fake/send', { method: 'POST', body: JSON.stringify(m) });
      await send({ resource: 'flows', cmd: 'add', data: late });
      await expect(rows(page)).toHaveCount(3);
      await expect(rows(page).nth(2)).toContainText('…');
      await send({ resource: 'flows', cmd: 'update', data: { ...late, response: GET.response } });
      await expect(rows(page).nth(2)).toContainText('/late');
      await send({ resource: 'flows', cmd: 'remove', data: late.id });
      await expect(rows(page)).toHaveCount(2);

      await page.locator('.px-filter').fill('httpbin -get');
      await expect(rows(page)).toHaveCount(1);
      await expect(page.locator('.px-count')).toHaveText('1 / 2 条');
      await rows(page).first().click();
      await expect(page.locator('.px-d-url')).toHaveText('POST http://httpbin.org/post?x=1');
      await page.locator('.px-d .seg button', { hasText: '请求' }).click();
      await expect(page.locator('.px-head-line')).toHaveText('POST /post?x=1 HTTP/1.1');
      await expect(page.locator('.px-body pre')).toHaveText('{\n    "a": 1\n}');
      await page.locator('.px-d .kv', { hasText: 'Content-Type' }).click();
      expect(await clipboard(page)).toBe('application/json');
      await page.getByRole('button', { name: '复制为 cURL' }).click();
      await expect(toast(page)).toHaveText('已复制 cURL 命令');
      expect(await clipboard(page)).toBe(`curl -X POST 'http://httpbin.org/post?x=1' -d '{"a":1}'`);
    } finally {
      stopStandIn(f);
    }
  });

  test('off puts the system proxy back and stops it; on again; quitting by itself is told at once', async ({ page }, info) => {
    const f = install(info);
    try {
      await openWith(page, f.entry);
      await switchOn(page);
      const record = join(f.dir, 'system-proxy.json');
      expect(existsSync(record)).toBe(true);

      await barButton(page, '关闭').click();
      await expect(status(page)).toHaveText('未开启');
      await expect(idle(page)).toBeVisible();
      expect(f.serving()).toBeNull();
      // Put back before it stopped (the backend removes its record once it has)
      expect(existsSync(record)).toBe(false);

      // On again, from the bar: the certificate is still trusted (as the keychain keeps it)
      await barButton(page, '开启').click();
      await expect(status(page)).toHaveText(/^已开启/);
      const on = f.serving()!;
      const calls = (await fake.ask(on.api, '/__fake/calls')) as { method: string; path: string }[];
      expect(calls.some((c) => c.path === '/bmitmproxy-api/ca/trust')).toBe(false);

      // Ended from outside: told by the app as it happens, the capture gone
      process.kill(on.pid, 'SIGKILL');
      await expect(status(page)).toHaveText('后端退出了（信号 SIGKILL）');
      await expect(page.locator('.px-cap')).toHaveCount(0);
      await expect(idle(page).getByRole('button', { name: '开启', exact: true })).toBeEnabled();
    } finally {
      stopStandIn(f);
    }
  });

  test('one already running is found when the tool opens, used as it is, and stopped by switching off', async ({ page }, info) => {
    const f = install(info);
    // Started as from a terminal
    const outside = spawn(f.entry, ['serve', '--proxy-port', String(await freePort()), '--web-port', String(await freePort()), '--origin', 'app://toolbox'], { stdio: 'ignore', detached: true });
    try {
      await expect.poll(() => f.serving()?.pid, { timeout: 10_000 }).toBe(outside.pid);
      await openWith(page, f.entry);
      await expect(status(page)).toHaveText(`已开启 · 代理 127.0.0.1:${f.serving()!.proxyPort}`);
      await expect(status(page)).toHaveAttribute('title', new RegExp(`pid ${outside.pid} · 不是本 App 启动的`));
      await expect(rows(page)).toHaveCount(2);
      await barButton(page, '关闭').click();
      await expect(status(page)).toHaveText('未开启');
      await expect.poll(() => f.serving()).toBeNull();
    } finally {
      stopStandIn(f);
    }
  });

  test('an entry that can\'t be used says why where the capture would be; the settings set another', async ({ page }, info) => {
    await openWith(page, info.outputPath('nope', 'bmitmproxy'));
    await expect(idle(page)).toContainText('找不到这个文件。 bmitmproxy 是内部项目，这里不提供下载。');
    await expect(page.locator('.px-badge-dot')).toBeVisible();
    await idle(page).getByRole('button', { name: '设置入口' }).click();
    const entry = page.getByLabel('入口');
    await expect(entry).toBeFocused();
    const old = fake.install(info.outputPath('old'), { serve: false });
    await entry.fill(old.entry);
    await expect(page.locator('.px-entry-check')).toHaveText('这是旧版 bmitmproxy 0.1.1：它不能在无窗口模式下运行（没有 serve）。请安装新版后再开启。');
    await entry.fill(info.outputPath());
    await expect(page.locator('.px-entry-check')).toContainText('这不是可以运行的程序');
    // Escape closes the settings; a good entry clears the warning
    const f = install(info);
    await entry.fill(f.entry);
    await expect(page.locator('.px-entry-check')).toHaveText('bmitmproxy 0.1.1：可以使用');
    await page.keyboard.press('Escape');
    await expect(page.locator('.px-pop')).toHaveCount(0);
    await expect(page.locator('.px-badge-dot')).toHaveCount(0);
    await expect(idle(page)).toContainText('开启后，经过这里的 HTTP / HTTPS 请求会实时显示在这里。');
  });

  test('an install without distutils (Python 3.12) is fixed on the way: setuptools into its venv', async ({ page }, info) => {
    const f = install(info, { distutils: false });
    try {
      await openWith(page, f.entry);
      await page.getByRole('button', { name: '后端设置' }).click();
      await expect(page.locator('.px-entry-check')).toHaveText('bmitmproxy 0.1.1：开启时会先安装 setuptools（Python 3.12 去掉了它要用的 distutils）');
      await page.keyboard.press('Escape');
      await switchOn(page);
      expect(JSON.parse(readFileSync(join(f.dir, 'pip-calls.json'), 'utf8'))).toEqual(['install', 'setuptools']);
    } finally {
      stopStandIn(f);
    }
  });

  test('a start that fails: one line, its details folded away, and a retry', async ({ page }, info) => {
    const f = install(info, { exitOnStart: { code: 1, stderr: 'Traceback (most recent call last):\nOSError: [Errno 48] Address already in use\n' } });
    try {
      await openWith(page, f.entry);
      await idle(page).getByRole('button', { name: '开启', exact: true }).click();
      await expect(status(page)).toHaveText('没能开启：后端启动时退出了（退出码 1）');
      await expect(page.locator('.px-details')).toHaveCount(0);
      await bar(page).getByRole('button', { name: '详细信息' }).click();
      await expect(page.locator('.px-details')).toContainText('OSError: [Errno 48] Address already in use');
      // Fixed outside; retried from the bar
      f.set({ exitOnStart: null });
      await bar(page).getByRole('button', { name: '重试' }).click();
      await expect(status(page)).toHaveText(/^已开启/);
      await expect(page.locator('.px-details')).toHaveCount(0);
    } finally {
      stopStandIn(f);
    }
  });

  test('clear can be undone; the certificate and scripts tabs; the system proxy changed by another program, and put back', async ({ page }, info) => {
    const f = install(info);
    try {
      await openWith(page, f.entry);
      await switchOn(page);
      const api = f.serving()!.api;
      const calls = async () => (await fake.ask(api, '/__fake/calls')) as { method: string; path: string; body: unknown }[];

      await expect(rows(page)).toHaveCount(2);
      await page.getByRole('button', { name: '清空' }).click();
      await expect(rows(page)).toHaveCount(0);
      await page.locator('.toast-undo').click();
      await expect(rows(page)).toHaveCount(2);
      await page.getByRole('button', { name: '清空' }).click();
      await expect.poll(async () => (await calls()).filter((c) => c.path === '/commands/view.flows.remove').length, { timeout: 10_000 }).toBe(1);

      // Another program changes the system proxy back: macOS says so, the app passes it on; a click takes it over again
      await fake.ask(api, '/__fake/set', { method: 'POST', body: JSON.stringify({ sys: { supported: true, platform: 'macOS', enabled: false, taken_over: true, overridden: true, upstream: 'http://127.0.0.1:7890', bypass: [], services: [], proxy: '127.0.0.1:1' } }) });
      const send = (e: unknown) => desktopApp(page)!.evaluate(({ BrowserWindow }, ev) => BrowserWindow.getAllWindows()[0].webContents.send('capture-event', ev), e);
      await send({ type: 'system-proxy' });
      await expect(chip(page, '系统代理被改掉了')).toHaveAttribute('aria-pressed', 'false');
      await chip(page, '系统代理被改掉了').click();
      await expect(chip(page, /^系统代理$/)).toHaveAttribute('aria-pressed', 'true');
      // What the app put back, told
      await send({ type: 'repaired', items: [{ service: 'Wi-Fi', kind: 'secure' }, { service: 'USB', kind: 'web' }] });
      await expect(toast(page)).toHaveText('已把系统代理恢复成开启前的设置：Wi-Fi HTTPS、USB HTTP');

      await chip(page, '证书').click();
      await expect(page.locator('.px-trust')).toContainText('本机已信任');
      await expect(page.locator('.px-steps .kv', { hasText: '192.168.6.44:' })).toBeVisible();
      await expect(page.locator('.px-qr')).toHaveAttribute('aria-label', 'http://mitm.it 的二维码');

      await fake.ask(api, '/__fake/set', { method: 'POST', body: JSON.stringify({ afterSave: { status: 'failed', error: 'Traceback (most recent call last):\nSyntaxError: expected \':\'' } }) });
      await bar(page).locator('.seg button', { hasText: '脚本' }).click();
      await expect(page.locator('.px-scripts .px-note')).toContainText('还没有脚本');
      await page.getByLabel('脚本路径（.py），如 ~/mitm/rewrite.py').fill('~/mitm/demo.py');
      await page.getByRole('button', { name: '添加', exact: true }).click();
      const ed = page.locator('.px-editor textarea');
      await expect(ed).toHaveValue('from mitmproxy import http\n');
      await ed.fill('def response(flow)\n');
      await ed.press('ControlOrMeta+s');
      await expect(page.locator('.px-badge')).toHaveText('加载失败');
      await expect(page.locator('.px-trace')).toContainText('SyntaxError');
      expect((await calls()).find((c) => c.method === 'PUT' && c.path === '/bmitmproxy-api/scripts/1/content')!.body).toEqual({ content: 'def response(flow)\n' });

      // Back to the capture: still there
      await bar(page).locator('.seg button', { hasText: '抓包' }).click();
      await expect(rows(page)).toHaveCount(0);
      await barButton(page, '关闭').click();
      await expect(status(page)).toHaveText('未开启');
    } finally {
      stopStandIn(f);
    }
  });
});
