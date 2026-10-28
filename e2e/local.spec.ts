// Local plugins: the user's own pages, run isolated, against a stand-in API (no real endpoint).
// The quota dashboard template, the toolbox bridge (fetch, storage), isolation, running while
// another tool is shown, carrying over a first-version dashboard, editing and deleting.
import type { FrameLocator, Page, Request } from '@playwright/test';
import { STAND_IN_API, expect, nav, open, test } from './helpers';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const URL_ = STAND_IN_API + 'api/v1/billing/usage';
const usage = (nick: string, daily: number) => ({
  code: 0, message: 'OK', ttl: 1,
  data: { valid: true, nick_name: nick, balance: 925.000445, daily_usage: daily, daily_limit: 200, overflow_limit: 100, overflow_usage: 0,
    pool_limit: 6000, pool_usage: 6016.16, user_monthly_limit: 0, user_monthly_usage: 0, user_weekly_limit: 0, user_weekly_usage: 0 },
});

/** The stand-in API: `sk-<nick>` is a valid key; records the requests. */
async function api(page: Page, opts: { down?: boolean } = {}) {
  const seen: Request[] = [];
  await page.route(STAND_IN_API + '**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.push(req);
    if (opts.down) return route.abort('failed');
    if (!req.url().startsWith(URL_)) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"hello":"world"}' });
    const key = ((await req.allHeaders())['authorization'] ?? '').replace(/^Bearer /, '');
    const body = key.startsWith('sk-') ? usage(key.slice(3), 100 + seen.length) : { code: 401, message: 'invalid token', data: null };
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  return seen;
}

const frame = (page: Page): FrameLocator => page.frameLocator('iframe.plugin-frame:visible');

async function installQuota(page: Page, keys: [string, string][]) {
  await open(page, '本地插件');
  await page.getByRole('button', { name: '额度看板模板' }).click();
  await page.getByRole('button', { name: '安装' }).click();
  const f = frame(page);
  await f.locator('#url').fill(URL_);
  for (const [name, key] of keys) {
    await f.locator('#add').click();
    await f.locator('#keys .row').last().locator('.n').fill(name);
    await f.locator('#keys .row').last().locator('.k').fill(key);
  }
  await f.locator('#save').click();
  return f;
}

test('the quota dashboard template: a card per key with values and bars; the key goes as a bearer token; a bad key says why', async ({ page }) => {
  const seen = await api(page);
  const f = await installQuota(page, [['主力', 'sk-alice'], ['', 'sk-bob'], ['坏的', 'nope']]);
  await expect(f.locator('.cards > .card')).toHaveCount(3);
  await expect(f.locator('.cards > .card').nth(0).locator('.title')).toHaveText('主力');
  await expect(f.locator('.cards > .card').nth(0).locator('.sub')).toHaveText('alice');
  await expect(f.locator('.cards > .card').nth(1).locator('.title')).toHaveText('bob');
  await expect(f.locator('.cards > .card').nth(0)).toContainText('925');
  await expect(f.locator('.cards > .card').nth(0).locator('.bar.full', { hasText: '额度池' })).toContainText('100.3%');
  await expect(f.locator('.cards > .card').nth(0).locator('.bar', { hasText: '本周' })).toHaveCount(0);
  await expect(f.locator('.cards > .card').nth(2).locator('.err')).toHaveText('invalid token');
  const auth = await Promise.all(seen.map(async (r) => (await r.allHeaders())['authorization']));
  expect(new Set(auth)).toEqual(new Set(['Bearer sk-alice', 'Bearer sk-bob', 'Bearer nope']));
  // Settings fold away once saved; the trends draw.
  await expect(f.locator('#settings')).toBeHidden();
  await f.locator('#refresh').click();
  await expect(f.locator('.chart canvas')).toHaveCount(2);
  // Its name is its <title>.
  await expect(page.locator('.local .seg button.on')).toHaveText('额度看板');
});

test('a plugin is isolated: it can’t read the toolbox page or its storage; it has its own storage through toolbox', async ({ page }) => {
  await api(page);
  await open(page, '本地插件');
  await page.getByRole('button', { name: '新建插件' }).click();
  await page.getByRole('button', { name: '安装' }).click();
  await frame(page).locator('#go').waitFor();
  const fr = page.frames().find((x) => x !== page.mainFrame())!;
  expect(await fr.evaluate(() => { try { return String(!!parent.document.body); } catch { return 'blocked'; } })).toBe('blocked');
  expect(await fr.evaluate(() => { try { return String(localStorage.length); } catch { return 'blocked'; } })).toBe('blocked');
  expect(await fr.evaluate(() => location.origin)).toBe('null');
  // Requests go through the toolbox; the reply comes back whole.
  await frame(page).locator('#url').fill(STAND_IN_API + 'hello');
  await frame(page).locator('#go').click();
  await expect(frame(page).locator('#out')).toHaveText('HTTP 200\n{"hello":"world"}');
  // Its own storage survives a reload.
  await fr.evaluate(() => (window as unknown as { toolbox: { storage: { set: (k: string, v: unknown) => Promise<unknown> } } }).toolbox.storage.set('n', { a: [1, 2] }));
  await page.reload();
  await frame(page).locator('#go').waitFor();
  const fr2 = page.frames().find((x) => x !== page.mainFrame())!;
  expect(await fr2.evaluate(() => (window as unknown as { toolbox: { storage: { get: (k: string) => Promise<unknown> } } }).toolbox.storage.get('n'))).toEqual({ a: [1, 2] });
});

test('plugins keep running while another tool is shown, and start on load whichever tool it opens on', async ({ page }) => {
  const seen = await api(page);
  const f = await installQuota(page, [['', 'sk-alice']]);
  await expect(f.locator('.cards > .card .title')).toHaveText('alice');
  await nav(page, 'JSON 格式化');
  const before = seen.length;
  await page.reload();
  await expect.poll(() => seen.length).toBeGreaterThan(before);
  await nav(page, '本地插件');
  await expect(frame(page).locator('.cards > .card .title')).toHaveText('alice');
});

test('a dashboard saved by the first version becomes the template plugin with its URL, interval and keys', async ({ page }) => {
  await api(page);
  await open(page);
  await page.evaluate((url) => {
    localStorage.setItem('tb.tool', '"local"');
    localStorage.setItem('tb.plugins', JSON.stringify([{ id: 'old1', src: JSON.stringify({ type: 'dashboard', name: '额度看板', url, interval: 30 }), keys: [{ id: 'k1', name: '主力', key: 'sk-alice' }, { id: 'k2', name: '', key: 'sk-bob' }] }]));
  }, URL_);
  await page.reload();
  const f = frame(page);
  await expect(f.locator('.cards > .card')).toHaveCount(2);
  await expect(f.locator('.cards > .card').nth(0).locator('.title')).toHaveText('主力');
  await expect(f.locator('#status')).toContainText('每 30 秒刷新');
  expect(await page.evaluate(() => localStorage.getItem('tb.plugins'))).not.toContain('"src"');
});

test('editing the code changes the plugin; deleting asks twice and removes it', async ({ page }) => {
  await api(page);
  await open(page, '本地插件');
  await page.getByRole('button', { name: '新建插件' }).click();
  await page.getByRole('button', { name: '安装' }).click();
  await page.getByRole('button', { name: '编辑代码' }).click();
  const code = page.getByLabel('插件代码（HTML）');
  await code.fill('<title>Hello</title><p id="x">changed</p>');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.local .seg button.on')).toHaveText('Hello');
  await expect(frame(page).locator('#x')).toHaveText('changed');
  await page.getByRole('button', { name: '编辑代码' }).click();
  await page.getByRole('button', { name: '删除插件' }).click();
  await page.getByRole('button', { name: '再点一次确认删除（连同它保存的数据）' }).click();
  await expect(page.locator('iframe.plugin-frame')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.local-intro')).toBeVisible();
});

test('an API that can’t be reached is explained in the template', async ({ page }) => {
  await api(page, { down: true });
  const f = await installQuota(page, [['', 'sk-alice']]);
  await expect(f.locator('.cards > .card .err')).toContainText('本地转发程序没有运行');
});
