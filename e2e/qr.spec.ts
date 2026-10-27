// QR codes: what is generated scans back to exactly the same text; what is scanned is shown faithfully.
import { fileURLToPath } from 'node:url';
import { clipboard, drop, expect, nav, open, setValue, test, toast } from './helpers';
import type { Page } from '@playwright/test';

const fixture = (name: string) => fileURLToPath(new URL('./fixtures/' + name, import.meta.url));
const qrText = (page: Page) => page.locator('textarea');
const results = (page: Page) => page.locator('.qr-text');

/** Generate a code, download the PNG, scan that file: the round trip through real pixels. */
async function roundTrip(page: Page, text: string) {
  await nav(page, '生成二维码');
  await setValue(qrText(page), text);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 PNG' }).click()]);
  await nav(page, '识别二维码');
  // The downloaded temp file has no extension (so no type): the picker must still read it.
  await page.locator('input[type=file]').setInputFiles(await dl.path());
  await expect(page.getByText(/识别到 \d+ 个二维码|未识别到二维码/)).toBeVisible();
  return results(page).allTextContents();
}

test('generate → download → scan gives back exactly the same text', async ({ page }) => {
  await open(page);
  for (const text of ['https://example.com/a?b=1&c=中文', '中文 😀 emoji\nnew line\ttab', 'é ü ß ñ', 'x'.repeat(1200), '0']) {
    expect(await roundTrip(page, text)).toEqual([text]);
  }
});

test('text with no UTF-8 encoding is refused, too much text is explained', async ({ page }) => {
  await open(page, '生成二维码');
  await setValue(qrText(page), 'a\ud800b');
  await expect(page.getByText('文本含孤立代理字符（无法按 UTF-8 编码），未生成')).toBeVisible();
  await page.locator('.seg button', { hasText: 'H' }).click();
  await setValue(qrText(page), 'x'.repeat(4000));
  await expect(page.getByText('内容过长，无法生成')).toBeVisible();
});

test('copy image puts a PNG on the clipboard', async ({ page }) => {
  await open(page, '生成二维码');
  await page.getByRole('button', { name: '复制图片', exact: true }).click();
  // Chrome sometimes takes ~7 s to put an image on the clipboard in a freshly opened page (measured here;
  // repeated copies take ~0.1 s), so the wait is longer than for text.
  await expect(toast(page)).toHaveText('图片已复制', { timeout: 15_000 });
  expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain('image/png');
});

test('a GBK-encoded code is decoded and labelled (jsQR alone returns empty text)', async ({ page }) => {
  await open(page, '识别二维码');
  await page.locator('input[type=file]').setInputFiles(fixture('gbk.svg'));
  await expect(results(page)).toHaveText(['中文测试']);
  await expect(page.getByText('按 GB18030 解码（不是 UTF-8）')).toBeVisible();
});

for (const [file, texts] of [['three-in-a-row.svg', ['one', 'two', 'three']], ['four-grid.svg', ['A1', 'A2', 'B1', 'B2']]] as const) {
  test(`several codes: ${file}`, async ({ page }) => {
    await open(page, '识别二维码');
    await page.locator('input[type=file]').setInputFiles(fixture(file));
    await expect(results(page)).toHaveText([...texts]);
    // Numbered in the list and on the image.
    await expect(page.locator('section .card span.mono', { hasText: /^\d+$/ })).toHaveText(texts.map((_, i) => String(i + 1)));
    await expect(page.locator('section.card div[style*="position: absolute"] > span')).toHaveText(texts.map((_, i) => String(i + 1)));
  });
}

test('every code in an image is found, numbered and copyable together', async ({ page }) => {
  await open(page, '识别二维码');
  await page.locator('input[type=file]').setInputFiles(fixture('two-codes.svg'));
  await expect(page.getByText('识别到 2 个二维码')).toBeVisible();
  await expect(results(page)).toHaveText(['https://example.com/first', '第二个 second']);
  await expect(page.getByRole('link', { name: /打开/ })).toHaveAttribute('href', 'https://example.com/first');
  await page.getByRole('button', { name: '复制全部' }).click();
  await expect(toast(page)).toHaveText('已复制');
  expect(await clipboard(page)).toBe('https://example.com/first\n第二个 second');
});

test('only http(s) links get an "open" button; invisible characters are marked', async ({ page }) => {
  await open(page);
  expect(await roundTrip(page, 'javascript:alert(1)')).toEqual(['javascript:alert(1)']);
  await expect(page.getByRole('link', { name: /打开/ })).toHaveCount(0);
  await roundTrip(page, 'pay‮txt.exe');
  await expect(page.locator('[data-cp="U+202E"]')).toHaveCount(1);
});

test('two images in quick succession: the result is for the last one', async ({ page }) => {
  await open(page);
  await drop(page, [{ name: 'broken.png', type: 'image/png', bytes: [1, 2, 3] }]);
  await page.locator('input[type=file]').setInputFiles(fixture('gbk.svg'));
  await expect(results(page)).toHaveText(['中文测试']);
  await expect(page.getByText('无法读取这张图片', { exact: false })).toHaveCount(0);
});

test('copying text the clipboard may alter (NUL) warns', async ({ page }) => {
  await open(page, '生成二维码');
  await setValue(qrText(page), 'a\u0000b');
  await page.getByRole('button', { name: '复制文本' }).click();
  await expect(toast(page)).toHaveText('已复制；注意：内容含 NUL 或孤立代理字符，系统剪贴板可能改动它们');
});

test('copying an image says at once that it has started', async ({ page }) => {
  await open(page, '生成二维码');
  // A clipboard that never finishes: the click must still get an answer straight away.
  await page.evaluate(() => { navigator.clipboard.write = () => new Promise(() => {}); });
  await page.getByRole('button', { name: '复制图片', exact: true }).click();
  await expect(toast(page)).toHaveText('正在复制图片…', { timeout: 1000 });
});
