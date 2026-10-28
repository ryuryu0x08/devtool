// Local plugins: pasted or imported pages, each a tool of its own in the sidebar, run isolated,
// against a stand-in API (no real endpoint). Installing, the toolbox bridge (fetch, storage),
// isolation, running while another tool is shown, editing, exporting and deleting.
import type { Page, Request } from '@playwright/test';
import { STAND_IN_API, expect, nav, open, test } from './helpers';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const URL_ = STAND_IN_API + 'usage';
/** A plugin that asks the stand-in API for "alice" every second and shows the answer. */
const PLUGIN = `<!doctype html><html><head><title>测试插件</title><meta name="toolbox-icon" content="T"></head><body>
<p id="out">…</p>
<style>.flex { display: flex; }</style><div id="hid" class="flex" hidden>should not show</div>
<script>
async function tick() {
  try {
    const r = await toolbox.fetch(${JSON.stringify(URL_)}, { headers: { Authorization: 'Bearer sk-alice' } });
    document.getElementById('out').textContent = r.status + ' ' + r.json().name;
  } catch (e) { document.getElementById('out').textContent = e.message; }
}
tick(); setInterval(tick, 1000);
</script></body></html>`;

async function api(page: Page, opts: { down?: boolean } = {}) {
  const seen: Request[] = [];
  await page.route(STAND_IN_API + '**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.push(req);
    if (opts.down) return route.abort('failed');
    const key = ((await req.allHeaders())['authorization'] ?? '').replace(/^Bearer sk-/, '');
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ name: key }) });
  });
  return seen;
}

const frame = (page: Page) => page.frameLocator('iframe.plugin-frame:visible');
const navItem = (page: Page, name: string) => page.locator('.nav-item', { hasText: name });

async function install(page: Page, html = PLUGIN) {
  await open(page, '添加插件');
  await page.getByLabel('插件代码（HTML）').fill(html);
  await page.getByRole('button', { name: /^安装「/ }).click();
}

test('pasted code becomes a tool of its own in the sidebar, named by its <title>, with its icon; it reaches APIs through the toolbox', async ({ page }) => {
  const seen = await api(page);
  await install(page);
  await expect(navItem(page, '测试插件')).toHaveClass(/on/);
  await expect(navItem(page, '测试插件').locator('.ticon')).toHaveText('T');
  // Listed under "我的插件", above "添加插件".
  const names = await page.locator('.nav-item').allInnerTexts();
  expect(names.indexOf(names.find((n) => n.includes('测试插件'))!)).toBe(names.length - 2);
  await expect(page.locator('.plugin-bar .plugin-name')).toHaveText('测试插件');
  await expect(frame(page).locator('#out')).toHaveText('200 alice');
  expect((await seen[0].allHeaders())['authorization']).toBe('Bearer sk-alice');
  // "hidden" wins over the plugin's own display styles.
  await expect(frame(page).locator('#hid')).toBeHidden();
  // Opened again on reload.
  await page.reload();
  await expect(frame(page).locator('#out')).toHaveText('200 alice');
  // And found in the palette.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('测试插件');
  await expect(page.locator('.pop')).toContainText('测试插件');
});

test('a plugin is isolated: it can’t read the toolbox page or its storage; it has its own storage through toolbox', async ({ page }) => {
  await api(page);
  await open(page, '添加插件');
  await page.getByRole('button', { name: '从空白模板开始' }).click();
  await page.getByRole('button', { name: /^安装「/ }).click();
  await frame(page).locator('#go').waitFor();
  const fr = page.frames().find((x) => x !== page.mainFrame())!;
  expect(await fr.evaluate(() => { try { return String(!!parent.document.body); } catch { return 'blocked'; } })).toBe('blocked');
  expect(await fr.evaluate(() => { try { return String(localStorage.length); } catch { return 'blocked'; } })).toBe('blocked');
  expect(await fr.evaluate(() => location.origin)).toBe('null');
  await frame(page).locator('#url').fill(URL_);
  await frame(page).locator('#go').click();
  await expect(frame(page).locator('#out')).toHaveText('HTTP 200\n{"name":""}');
  type TB = { toolbox: { storage: { set: (k: string, v: unknown) => Promise<unknown>; get: (k: string) => Promise<unknown> } } };
  await fr.evaluate(() => (window as unknown as TB).toolbox.storage.set('n', { a: [1, 2] }));
  await page.reload();
  await frame(page).locator('#go').waitFor();
  const fr2 = page.frames().find((x) => x !== page.mainFrame())!;
  expect(await fr2.evaluate(() => (window as unknown as TB).toolbox.storage.get('n'))).toEqual({ a: [1, 2] });
});

test('plugins keep running while another tool is shown, and start on load whichever tool it opens on', async ({ page }) => {
  const seen = await api(page);
  await install(page);
  await expect(frame(page).locator('#out')).toHaveText('200 alice');
  await nav(page, 'JSON 格式化');
  const before = seen.length;
  await page.reload();
  await expect.poll(() => seen.length, { timeout: 8000 }).toBeGreaterThan(before + 1);
});

test('edit changes the plugin and its name in the sidebar; delete asks twice, then it is gone', async ({ page }) => {
  await api(page);
  await install(page);
  await page.getByRole('button', { name: '编辑代码' }).click();
  await page.getByLabel('插件代码（HTML）').fill('<title>Hello</title><p id="x">changed</p>');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(navItem(page, 'Hello')).toHaveClass(/on/);
  await expect(navItem(page, '测试插件')).toHaveCount(0);
  await expect(frame(page).locator('#x')).toHaveText('changed');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(navItem(page, 'Hello')).toHaveCount(1);
  await page.getByRole('button', { name: '再点一次确认删除' }).click();
  await expect(navItem(page, 'Hello')).toHaveCount(0);
  await expect(navItem(page, '添加插件')).toHaveClass(/on/);
  await page.reload();
  await expect(navItem(page, 'Hello')).toHaveCount(0);
});

test('import from an .html file; export gives the same code back', async ({ page }) => {
  await api(page);
  await open(page, '添加插件');
  // An ASCII title: this test machine's file system turns other download names into "download".
  const code = PLUGIN.replace('<title>测试插件</title>', '<title>Mine</title>');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入 .html' }).click();
  await (await chooser).setFiles({ name: 'mine.html', mimeType: 'text/html', buffer: Buffer.from(code) });
  await expect(page.getByLabel('插件代码（HTML）')).toHaveValue(code);
  await page.getByRole('button', { name: '安装「Mine」' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 .html' }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('Mine.html');
  const chunks: Buffer[] = [];
  for await (const c of (await d.createReadStream())!) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).toString()).toBe(code);
});

test('an API that can’t be reached rejects toolbox.fetch with "connect: …"', async ({ page }) => {
  await api(page, { down: true });
  await install(page);
  await expect(frame(page).locator('#out')).toContainText('connect: ');
});
