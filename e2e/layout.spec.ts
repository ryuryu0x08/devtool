// Input and result: side by side or stacked, resizable, remembered per tool.
import type { Page } from '@playwright/test';
import { expect, nav, open, test } from './helpers';

const layout = (page: Page) => page.locator('.split').getAttribute('data-layout');
const panes = (page: Page) => page.locator('.split-pane');
const box = async (page: Page, i: number) => (await panes(page).nth(i).boundingBox())!;

async function dragBy(page: Page, sel: string, dx: number, dy: number) {
  const b = (await page.locator(sel).boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test('the result is dragged below: both panes take the full width; each tool remembers its own layout', async ({ page }) => {
  await open(page, 'URL 编解码');
  expect(await layout(page)).toBe('row');
  const content = (await page.locator('.content').boundingBox())!;
  await dragBy(page, '.split-grip', 0, 260);
  expect(await layout(page)).toBe('col');
  const a = await box(page, 0), b = await box(page, 1);
  expect(b.y).toBeGreaterThan(a.y + a.height);
  // Stacked panes span the content width (its padding stays as the margin).
  expect(Math.abs(a.width - b.width)).toBeLessThan(1);
  expect(a.width).toBeGreaterThan(content.width - 80);
  await page.reload();
  expect(await layout(page)).toBe('col');
  await nav(page, 'Hex 编解码');
  expect(await layout(page)).toBe('row');
  await nav(page, 'URL 编解码');
  // Dragged back up to the right.
  await dragBy(page, '.split-grip', 0, -250);
  expect(await layout(page)).toBe('row');
});

test('a click on the handle switches; so does Enter on it', async ({ page }) => {
  await open(page, 'YAML 格式化');
  await page.locator('.split-grip').click();
  expect(await layout(page)).toBe('col');
  await page.locator('.split-grip').focus();
  await page.keyboard.press('Enter');
  expect(await layout(page)).toBe('row');
});

test('the gap is dragged to share the width, remembered; a double-click shares it equally', async ({ page }) => {
  await open(page, 'SQL 格式化');
  const before = (await box(page, 0)).width;
  await dragBy(page, '.split-gutter', 180, 0);
  const wider = (await box(page, 0)).width;
  expect(wider).toBeGreaterThan(before + 150);
  await page.reload();
  expect(Math.abs((await box(page, 0)).width - wider)).toBeLessThan(2);
  // Never narrower than 280 px.
  await dragBy(page, '.split-gutter', 2000, 0);
  expect((await box(page, 1)).width).toBeGreaterThanOrEqual(279);
  await page.locator('.split-gutter').dblclick();
  expect(Math.abs((await box(page, 0)).width - (await box(page, 1)).width)).toBeLessThan(2);
});

test('the older tools have it too: Base64, hash, JSON, QR code', async ({ page }) => {
  await open(page);
  for (const t of ['Base64 编解码', '哈希', 'JSON 格式化', '生成二维码']) {
    await nav(page, t);
    await page.locator('.split-grip').click();
    expect(await layout(page), t).toBe('col');
  }
});

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  test('always stacked, with no handles', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { localStorage.setItem('tb.tool', '"url"'); localStorage.setItem('tb.prefs', JSON.stringify({ o: { 'lay.url': 'row' } })); });
    await page.reload();
    expect(await layout(page)).toBe('col');
    await expect(page.locator('.split-grip')).toHaveCount(0);
    await expect(page.locator('.split-gutter')).toHaveCount(0);
  });
});
