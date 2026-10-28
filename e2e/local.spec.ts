// Local plugins, against a stand-in API (no real endpoint): a quota dashboard from the template,
// one card per key, errors in words, kept across reloads, refreshed whichever tool is open.
import type { Page, Request } from '@playwright/test';
import { STAND_IN_API, expect, nav, open, test } from './helpers';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const URL_ = STAND_IN_API + 'api/v1/billing/usage';
const usage = (nick: string, daily: number) => ({
  code: 0, message: 'OK', ttl: 1,
  data: { valid: true, nick_name: nick, balance: 925.000445, daily_usage: daily, daily_limit: 200, overflow_limit: 100, overflow_usage: 0,
    pool_limit: 6000, pool_usage: 6016.16, user_monthly_limit: 0, user_monthly_usage: 0, user_weekly_limit: 0, user_weekly_usage: 0 },
});

/** The stand-in API: a reply per key (`sk-<nick>` is valid), recording the requests. */
async function api(page: Page, opts: { down?: boolean } = {}) {
  const seen: Request[] = [];
  await page.route(STAND_IN_API + '**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    seen.push(req);
    if (opts.down) return route.abort('failed');
    const key = ((await req.allHeaders())['authorization'] ?? '').replace(/^Bearer /, '');
    const body = key.startsWith('sk-') ? usage(key.slice(3), 100 + seen.length) : { code: 401, message: 'invalid token', data: null };
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  return seen;
}

async function install(page: Page, keys: [string, string][]) {
  await open(page, '本地插件');
  await page.getByRole('button', { name: '用额度看板模板' }).click();
  const ta = page.getByLabel('插件定义（JSON）');
  await ta.fill((await ta.inputValue()).replace('http://127.0.0.1:8787/api/v1/billing/usage', URL_));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  for (const [name, key] of keys) {
    await page.getByRole('button', { name: '添加 key' }).click();
    const row = page.locator('.local-key-row').last();
    if (name) await row.getByLabel('名称（可留空）').fill(name);
    await row.getByLabel('sk-…').fill(key);
    await row.getByLabel('sk-…').blur();
  }
}
const card = (page: Page, i: number) => page.locator('.local-card').nth(i);

test('a quota dashboard from the template: a card per key with values and bars; the key goes as a bearer token; a bad key says why', async ({ page }) => {
  const seen = await api(page);
  await install(page, [['主力', 'sk-alice'], ['', 'sk-bob'], ['坏的', 'nope']]);
  await expect(page.locator('.local-card')).toHaveCount(3);
  await expect(card(page, 0).locator('.local-card-title')).toHaveText('主力');
  await expect(card(page, 0).locator('.local-card-sub')).toHaveText('alice');
  // No name: the account's name from the reply.
  await expect(card(page, 1).locator('.local-card-title')).toHaveText('bob');
  await expect(card(page, 0).locator('.local-values')).toContainText('925');
  await expect(card(page, 0).locator('.local-bar', { hasText: '今日' })).toContainText('/ 200');
  // Over the limit: shown in full, marked.
  await expect(card(page, 0).locator('.local-bar.full', { hasText: '额度池' })).toContainText('100.3%');
  // A limit of 0 means none: no bar.
  await expect(card(page, 0).locator('.local-bar', { hasText: '本周' })).toHaveCount(0);
  await expect(card(page, 2).locator('.local-err')).toHaveText('invalid token');
  const auth = await Promise.all(seen.map(async (r) => (await r.allHeaders())['authorization']));
  expect(new Set(auth)).toEqual(new Set(['Bearer sk-alice', 'Bearer sk-bob', 'Bearer nope']));
  // The trend chart draws once there is history.
  await page.getByRole('button', { name: '立即刷新' }).click();
  await expect(page.locator('.local-chart canvas')).toHaveCount(2);
  await expect(page.locator('.local-chart .u-title').first()).toHaveText('今日用量');
});

test('kept in this browser: after a reload the plugin and its keys are there, and it refreshes while another tool is open', async ({ page }) => {
  const seen = await api(page);
  await install(page, [['', 'sk-alice']]);
  await expect(card(page, 0).locator('.local-card-title')).toHaveText('alice');
  // Reloaded on another tool: refreshed on load, without the dashboard being opened.
  await nav(page, 'JSON 格式化');
  const before = seen.length;
  await page.reload();
  await expect.poll(() => seen.length).toBeGreaterThan(before);
  await nav(page, '本地插件');
  await expect(page.locator('.local-keys summary')).toHaveText('Key（1 个）');
  await expect(card(page, 0).locator('.local-card-title')).toHaveText('alice');
});

test('a definition with mistakes lists them and can’t be saved; deleting asks twice', async ({ page }) => {
  await api(page);
  await install(page, [['', 'sk-alice']]);
  await page.getByRole('button', { name: '编辑定义' }).click();
  const ta = page.getByLabel('插件定义（JSON）');
  await ta.fill('{"type": "dashboard", "name": "x", "url": "ftp://x", "interval": 1}');
  await expect(page.locator('.local-errors li')).toHaveText(['url: expected http:// or https://', 'interval: expected a number of seconds, at least 10', 'values / bars / trends: show at least one']);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '删除插件' }).click();
  await expect(page.locator('.local-card')).toHaveCount(0);
  await page.getByRole('button', { name: '再点一次确认删除（连同 key 和历史数据）' }).click();
  await expect(page.getByRole('button', { name: '用额度看板模板' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '用额度看板模板' })).toBeVisible();
});

test('an API that can’t be reached is explained (forwarder not running, CORS, local network)', async ({ page }) => {
  await api(page, { down: true });
  await install(page, [['', 'sk-alice']]);
  await expect(card(page, 0).locator('.local-err')).toContainText('本地转发程序没有运行');
});
