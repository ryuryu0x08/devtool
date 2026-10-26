// Timestamp tool: exact precision, time zones, DST, input conveniences.
import { clipboard, expect, open, test, toast } from './helpers';
import type { Page } from '@playwright/test';

const tsInput = (page: Page) => page.locator('input.field').nth(0);
const tmInput = (page: Page) => page.locator('input.field').nth(1);
const heroes = (page: Page) => page.locator('.hero');
const rowValues = (page: Page) => page.locator('.kv .v').allTextContents();

test('ns / µs timestamps: every digit is shown, nothing rounded', async ({ page }) => {
  await open(page, '时间戳转换');
  await tsInput(page).fill('1793000000123456789');
  await expect(heroes(page).first()).toContainText('识别为纳秒 · 19 位');
  await expect(heroes(page).first()).toContainText('2026-10-26 15:33:20.123456789');
  const v = await rowValues(page);
  expect(v[0]).toBe('2026-10-26T15:33:20.123456789+08:00');
  expect(v[1]).toBe('2026-10-26 07:33:20.123456789');
  expect(v[3]).toBe('1793000000.123456789');
  await tsInput(page).fill('1700000000.001');
  await expect(heroes(page).first()).toContainText('2023-11-15 06:13:20.001');
});

test('forced unit; non-numeric input explained', async ({ page }) => {
  await open(page, '时间戳转换');
  await tsInput(page).fill('1793000000');
  await page.locator('.seg button', { hasText: '毫秒' }).click();
  await expect(heroes(page).first()).toContainText('按毫秒解析');
  await expect(heroes(page).first()).toContainText('1970-01-22 02:03:20');
  await tsInput(page).fill('abc');
  await expect(page.getByText('请输入数字时间戳')).toBeVisible();
});

test.describe('in New York', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('the offset shown is the one at that moment (EST in January, EDT in July)', async ({ page }) => {
    await open(page, '时间戳转换');
    await tsInput(page).fill('1768478400');
    await expect(heroes(page).first()).toContainText('纽约 UTC−05:00');
    await tsInput(page).fill('1783000000');
    await expect(heroes(page).first()).toContainText('纽约 UTC−04:00');
  });

  test('a time that occurs twice is flagged with the other timestamp', async ({ page }) => {
    await open(page, '时间戳转换');
    await tmInput(page).fill('2026-11-01 01:30');
    await expect(page.getByText('这个时间在夏令时切换时会出现两次：已按第一次（UTC−04:00）计算；第二次（UTC−05:00）的时间戳是 1793514600')).toBeVisible();
  });

  test('a time that does not exist is flagged', async ({ page }) => {
    await open(page, '时间戳转换');
    await tmInput(page).fill('2026-03-08 02:30');
    await expect(page.getByText('这个时间因夏令时切换而不存在，已按 2026-03-08 03:30:00 UTC−04:00 计算')).toBeVisible();
  });

  test('−1 day keeps the wall-clock time across DST; landing in a gap is announced', async ({ page }) => {
    await open(page, '时间戳转换');
    await tmInput(page).fill('2026-11-02 00:00:00');
    await page.locator('button.pill', { hasText: '−1 天' }).click();
    await expect(tmInput(page)).toHaveValue('2026-11-01 00:00:00');
    await tmInput(page).fill('2026-03-09 02:30:00');
    await page.locator('button.pill', { hasText: '−1 天' }).click();
    await expect(tmInput(page)).toHaveValue('2026-03-08 03:30:00');
    await expect(toast(page)).toHaveText('目标时间因夏令时切换不存在，已调整为 2026-03-08 03:30:00');
  });
});

test('date → timestamp: exact, fractional, explicit offsets', async ({ page }) => {
  await open(page, '时间戳转换');
  await tmInput(page).fill('2026-10-26T14:30:00.123456Z');
  await expect(heroes(page).nth(1)).toContainText('1793025000.123456');
  // 14:30 at +08:00 = 06:30 UTC.
  await tmInput(page).fill('2026-10-26 14:30+08');
  await expect(heroes(page).nth(1)).toContainText('1792996200');
  await tmInput(page).fill('Mon Oct 26 2026 14:30:00 GMT+0800 (China Standard Time)');
  await expect(heroes(page).nth(1)).toContainText('1792996200');
});

for (const bad of ['2026-02-31', '10/32', 'hello 2020', '2026-10-26T10:00+25:00']) {
  test(`"${bad}" is not guessed`, async ({ page }) => {
    await open(page, '时间戳转换');
    await tmInput(page).fill(bad);
    await expect(page.getByText(/^无法识别/)).toBeVisible();
    await expect(heroes(page)).toHaveCount(1);
  });
}

test('±1 h keeps fractional seconds; ↑ ↓ adjust the segment under the caret', async ({ page }) => {
  await open(page, '时间戳转换');
  await tmInput(page).fill('2026-10-26 14:30:00.123456');
  await page.locator('button.pill', { hasText: '+1 时' }).click();
  await expect(tmInput(page)).toHaveValue('2026-10-26 15:30:00.123456');
  await tmInput(page).evaluate((el: HTMLInputElement) => { el.focus(); el.setSelectionRange(6, 6); });
  await page.keyboard.press('ArrowUp');
  await expect(tmInput(page)).toHaveValue('2026-11-26 15:30:00.123456');
  // ↑ while an IME is composing belongs to the IME.
  await tmInput(page).evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', isComposing: true, keyCode: 229, bubbles: true })));
  await expect(tmInput(page)).toHaveValue('2026-11-26 15:30:00.123456');
});

test('time zone: searchable, remembered, listed under recent', async ({ page }) => {
  await open(page, '时间戳转换');
  await page.getByText('▾').click();
  await page.getByPlaceholder(/搜索城市或时区/).fill('tokyo');
  await page.keyboard.press('Enter');
  await expect(page.locator('.search-btn', { hasText: '东京' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.search-btn', { hasText: '东京' })).toBeVisible();
  await page.getByText('▾').click();
  await expect(page.locator('.pop')).toContainText('最近使用');
});

test('full-width digits from a Chinese IME are read', async ({ page }) => {
  await open(page, '时间戳转换');
  await tsInput(page).fill('１７９３００００００');
  await expect(heroes(page).first()).toContainText('2026-10-26 15:33:20');
  await tmInput(page).fill('２０２６－１０－２６　１４：３０');
  await expect(heroes(page).nth(1)).toContainText('1792996200');
});

test('historic local mean time: the offset keeps its seconds, so the ISO text names the same instant', async ({ page }) => {
  await open(page, '时间戳转换');
  await tsInput(page).fill('-62135596800');
  await expect(heroes(page).first()).toContainText('UTC+08:05:43');
  expect((await rowValues(page))[0]).toBe('0001-01-01T08:05:43.000+08:05:43');
  await tmInput(page).fill('0001-01-01T08:05:43+08:05:43');
  await expect(heroes(page).nth(1)).toContainText('-62135596800');
});

test('the current time: each value, the date-time too, copies exactly what is shown', async ({ page }) => {
  await open(page, '时间戳转换');
  const btns = page.locator('.now-btn');
  await expect(btns).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    // The clock ticks every second: read the label and click in one step.
    const label = await btns.nth(i).evaluate((b) => { (b as HTMLButtonElement).click(); return b.textContent; });
    await expect.poll(() => clipboard(page)).toBe(label);
  }
  // The date-time reads back as the same second as the timestamp beside it.
  const [sec, wall] = await btns.evaluateAll((bs) => [bs[0].textContent!, bs[2].textContent!]);
  expect(wall).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await tmInput(page).fill(wall);
  await expect(heroes(page).nth(1).locator('.hero-big')).toHaveText(sec);
});
