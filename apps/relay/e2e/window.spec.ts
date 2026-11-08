// The relay's window: making routes, upstreams and tokens, what it says when something is wrong,
// and that the keys never show.
import { expect, test, type Page } from '@playwright/test';
import { installFake, type FakeStart } from './fake';

async function open(page: Page, start: FakeStart = {}) {
  await page.addInitScript(installFake, start);
  await page.goto('/');
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: { cmd: string; args: Record<string, unknown> }[] }).__calls);

async function newRoute(page: Page, name: string, protocol: 'Anthropic' | 'OpenAI' = 'Anthropic') {
  await page.getByLabel('新入口名字').fill(name);
  await page.locator('.new-route').getByRole('radio', { name: protocol }).click();
  await page.locator('.new-route').getByRole('button', { name: '新建' }).click();
  await expect(page.locator('.route-head .title')).toHaveText(name);
}

/** The upstream row named exactly `name`. */
const upRow = (page: Page, name: string) => page.locator('.row.upstream').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) });

async function addUpstream(page: Page, name: string, url: string, key: string) {
  const f = page.locator('.upstream-form').last();
  await f.getByLabel('上游名字').fill(name);
  await f.getByLabel('上游地址').fill(url);
  await f.getByLabel('上游 key').fill(key);
  await f.getByRole('button', { name: '添加上游' }).click();
}

test('empty: it says what to do first; the relay runs and its address copies', async ({ page }) => {
  await open(page);
  await expect(page.getByText('先在左边新建一个入口')).toBeVisible();
  await expect(page.locator('.state.ok')).toContainText('运行中');
  await page.locator('.state.ok .copy').click();
  await expect(page.getByRole('status')).toHaveText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:8790');
});

test('an Anthropic route: its address and the Claude Code setting; an OpenAI one: /v1', async ({ page }) => {
  await open(page);
  await newRoute(page, '主线');
  await expect(page.locator('.row', { hasText: '地址' }).locator('.copy')).toHaveText('http://127.0.0.1:8790');
  await expect(page.getByText('ANTHROPIC_BASE_URL=http://127.0.0.1:8790')).toBeVisible();
  await newRoute(page, '对话', 'OpenAI');
  await expect(page.locator('.row', { hasText: '地址' }).locator('.copy')).toHaveText('http://127.0.0.1:8790/v1');
  await expect(page.getByText('base_url="http://127.0.0.1:8790/v1"')).toBeVisible();
  // Both listed; the first chosen again.
  await page.locator('.route-item', { hasText: '主线' }).click();
  await expect(page.locator('.route-head .title')).toHaveText('主线');
  // Renamed; an empty name is refused with the reason.
  await page.getByRole('button', { name: '改名' }).click();
  await page.getByLabel('入口名字', { exact: true }).fill(' ');
  await page.locator('.rename').getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('status')).toHaveText('名字不能为空');
  await page.getByLabel('入口名字', { exact: true }).fill('主线 2');
  await page.locator('.rename').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.route-head .title')).toHaveText('主线 2');
  await expect(page.locator('.route-item.on')).toContainText('主线 2');
});

test("each route has its own forms: the upstream form takes the route's way of sending the key", async ({ page }) => {
  await open(page);
  await newRoute(page, '对话', 'OpenAI');
  await expect(page.locator('.upstream-form').getByRole('radio', { name: 'Bearer' })).toHaveAttribute('aria-checked', 'true');
  await page.locator('.upstream-form').getByLabel('上游名字').fill('half typed');
  await newRoute(page, '主线');
  await expect(page.locator('.upstream-form').getByRole('radio', { name: 'x-api-key' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.upstream-form').getByLabel('上游名字')).toHaveValue('');
  await addUpstream(page, 'A', 'https://a.example', 'key-a-000000000');
  await expect(upRow(page, 'A')).toContainText('x-api-key');
});

test('upstreams: a wrong address is refused with the reason; the key shows only its ends; edited without a key it stays', async ({ page }) => {
  await open(page);
  await newRoute(page, '主线');
  await addUpstream(page, '内网', 'api.example.com', 'sk-ant-SECRET-1234567890');
  await expect(page.getByRole('status')).toHaveText('地址需以 http:// 或 https:// 开头');
  await expect(page.locator('.row.upstream')).toHaveCount(0);
  await addUpstream(page, '内网', 'http://10.0.0.5/api/', 'sk-ant-SECRET-1234567890');
  const row = page.locator('.row.upstream');
  await expect(row).toContainText('内网');
  await expect(row).toContainText('http://10.0.0.5/api');
  await expect(row).toContainText('sk-a…7890');
  await expect(row).toContainText('x-api-key');
  await expect(page.locator('body')).not.toContainText('SECRET');
  // The add form is empty again, ready for the next.
  await expect(page.locator('.upstream-form').getByLabel('上游 key')).toHaveValue('');

  await row.getByRole('button', { name: '编辑' }).click();
  const form = page.locator('.upstream-form').first();
  await expect(form.getByLabel('上游 key')).toHaveAttribute('placeholder', /sk-a…7890, 不改就留空/);
  await form.getByLabel('上游名字').fill('内网 A');
  await form.getByRole('radio', { name: 'Bearer' }).click();
  await form.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.row.upstream')).toContainText('内网 A');
  await expect(page.locator('.row.upstream')).toContainText('Bearer');
  expect(await page.evaluate(() => (window as unknown as { __keys: () => string[] }).__keys())).toEqual(['sk-ant-SECRET-1234567890']);
  const last = (await calls(page)).filter((c) => c.cmd === 'update_upstream').pop()!;
  expect(last.args.upstream).not.toHaveProperty('key');
});

test('a route with no usable upstream says so, there and in the list, until one is on', async ({ page }) => {
  await open(page);
  await newRoute(page, '主线');
  await expect(page.getByRole('alert')).toContainText('还没有上游: 这个入口的请求会返回 503');
  await expect(page.locator('.route-item.on .mark')).toBeVisible();
  await addUpstream(page, 'A', 'https://a.example', 'key-a-000000000');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.route-item.on .mark')).toHaveCount(0);
  await upRow(page, 'A').getByRole('switch').click();
  await expect(page.getByRole('alert')).toContainText('上游都已停用');
  await expect(page.locator('.route-item.on .mark')).toBeVisible();
});

test('upstreams are tried in order: moved up and down, turned off, deleted after a second click', async ({ page }) => {
  await open(page);
  await newRoute(page, '主线');
  await addUpstream(page, 'A', 'https://a.example', 'key-a-000000000');
  await addUpstream(page, 'B', 'https://b.example', 'key-b-000000000');
  const names = () => page.locator('.row.upstream .name').allTextContents();
  expect(await names()).toEqual(['A', 'B']);
  await upRow(page, 'B').getByRole('button', { name: '上移' }).click();
  await expect(page.locator('.row.upstream .name').first()).toHaveText('B');
  await upRow(page, 'A').getByRole('switch').click();
  await expect(upRow(page, 'A')).toHaveClass(/off/);
  const del = upRow(page, 'A').getByRole('button', { name: '删除' });
  await del.click();
  await expect(upRow(page, 'A').getByRole('button', { name: '确认删除?' })).toBeVisible();
  await upRow(page, 'A').getByRole('button', { name: '确认删除?' }).click();
  expect(await names()).toEqual(['B']);
});

test('a token is shown once, copies on click, then only its hint; it can be turned off', async ({ page }) => {
  await open(page);
  await newRoute(page, '主线');
  await page.getByLabel('token 名字').fill('ye');
  await page.getByRole('button', { name: '生成 token' }).click();
  const reveal = page.locator('.reveal');
  await expect(reveal).toContainText('只显示这一次');
  const text = (await reveal.locator('.copy').textContent())!;
  expect(text).toMatch(/^rl-/);
  await reveal.locator('.copy').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await reveal.getByRole('button', { name: '已保存' }).click();
  await expect(reveal).toHaveCount(0);
  const row = page.locator('.row.token');
  await expect(row).toContainText('ye');
  await expect(row).toContainText(text.slice(-4));
  await expect(page.locator('body')).not.toContainText(text);
  await row.getByRole('switch').click();
  await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});

test('the port taken: the window says so; another port is applied', async ({ page }) => {
  await open(page, { server: { state: 'failed', port: 8790, error: '端口 8790 已被其他程序占用' } });
  await expect(page.locator('.state.bad')).toContainText('端口 8790 已被其他程序占用');
  await page.getByLabel('端口', { exact: true }).fill('8791');
  await page.locator('.port').getByRole('button', { name: '应用' }).click();
  await expect(page.locator('.state.ok')).toContainText('127.0.0.1:8791');
  await page.getByLabel('端口', { exact: true }).fill('80');
  await page.locator('.port').getByRole('button', { name: '应用' }).click();
  await expect(page.getByRole('status')).toHaveText('端口需在 1024 到 65535 之间');
});

test('on the local network: the switch, the addresses other devices use, and off again', async ({ page }) => {
  await open(page, { lanAddresses: ['192.168.1.5', '10.0.0.8'] });
  const lan = page.getByRole('switch', { name: '局域网访问' });
  await expect(lan).toHaveAttribute('aria-checked', 'false');
  await expect(lan).toHaveAttribute('title', '开启后监听 0.0.0.0, 局域网内的设备凭 token 访问');
  await expect(page.locator('.lan-addresses')).toHaveCount(0);
  await newRoute(page, '主线');
  await expect(page.locator('.row.lan-row')).toHaveCount(0);

  await lan.click();
  await expect(lan).toHaveAttribute('aria-checked', 'true');
  expect((await calls(page)).filter((c) => c.cmd === 'set_lan')).toEqual([{ cmd: 'set_lan', args: { on: true } }]);
  await expect(page.locator('.lan-addresses .copy')).toHaveText(['192.168.1.5:8790', '10.0.0.8:8790']);
  // This machine's own address stays as it is; the route lists the others to hand out.
  await expect(page.locator('.state.ok .copy')).toHaveText('127.0.0.1:8790');
  await expect(page.locator('.row.lan-row .copy')).toHaveText(['http://192.168.1.5:8790', 'http://10.0.0.8:8790']);
  await page.locator('.row.lan-row .copy').first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://192.168.1.5:8790');
  await newRoute(page, '对话', 'OpenAI');
  await expect(page.locator('.row.lan-row .copy')).toHaveText(['http://192.168.1.5:8790/v1', 'http://10.0.0.8:8790/v1']);
  // Another port: the addresses follow.
  await page.getByLabel('端口', { exact: true }).fill('8791');
  await page.locator('.port').getByRole('button', { name: '应用' }).click();
  await expect(page.locator('.lan-addresses .copy').first()).toHaveText('192.168.1.5:8791');

  await lan.click();
  await expect(lan).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.lan-addresses')).toHaveCount(0);
  await expect(page.locator('.row.lan-row')).toHaveCount(0);
});

test('on the local network without an address there: it says so', async ({ page }) => {
  await open(page, { lanAddresses: [] });
  await page.getByRole('switch', { name: '局域网访问' }).click();
  await expect(page.locator('.lan-addresses')).toHaveText('没找到局域网地址');
  await newRoute(page, '主线');
  await expect(page.locator('.row.lan-row')).toHaveCount(0);
});

test('the latest requests of the route, with what was tried before', async ({ page }) => {
  const at = Date.now();
  await open(page, {
    recent: [
      { at, route: '主线', token: 'ye', upstream: 'B', method: 'POST', path: '/v1/messages', status: 200, ms: 812, note: '先试了: A 503' },
      { at, route: '别的', token: 'yy', upstream: 'C', method: 'POST', path: '/v1/x', status: 500, ms: 3, note: '' },
    ],
  });
  await newRoute(page, '主线');
  const rows = page.locator('.recent tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('POST /v1/messages');
  await expect(rows.first()).toContainText('先试了: A 503');
  await expect(rows.first().locator('.status')).toHaveClass(/s2/);
});
