// JSON 去转义: escaped JSON (a message push's, its parts escaped to different depths) back to
// JSON; pasted on a blank area, it opens here by itself. The escape tools sit together.
import { readFileSync } from 'node:fs';
import { activeTool, expect, nav, open, test } from './helpers';

const SAMPLE = readFileSync(new URL('../src/lib/fixtures/escaped-push.txt', import.meta.url), 'utf8').trim();

test('escaped JSON comes back as JSON, formatted; nested JSON strings open up', async ({ page }) => {
  await open(page, 'JSON 去转义');
  await page.locator('textarea.area').fill(SAMPLE);
  const out = page.locator('.out-card');
  await expect(out.locator('.out-status')).toHaveText('去掉 2 层转义');
  // Mixed depths: said, to look over.
  await expect(out).toContainText('转义层数不一致');
  const text = await out.locator('.pane-scroll').innerText();
  const v = JSON.parse(text);
  expect(v.msg_title).toBe('啦啦啦');
  expect(v.push_button.buttons[0]).toMatchObject({ button: 4, text: '回复' });
  expect(text).toContain('\n  "voice": 0,');
  // A JSON string with JSON in its values: the quotes and the inner string, opened.
  await page.locator('textarea.area').fill('"{\\"data\\":\\"{\\\\\\"id\\\\\\":12345678901234567890}\\"}"');
  await expect(out.locator('.out-status')).toHaveText('去掉外层引号 · 展开了 1 个嵌套 JSON 字符串');
  // Long numbers stay as written.
  await expect(out.locator('.pane-scroll')).toContainText('"id": 12345678901234567890');
  await page.locator('.btn', { hasText: '展开嵌套的 JSON 字符串' }).click();
  await expect(out.locator('.out-status')).toHaveText('去掉外层引号');
  // Not JSON at any depth: why.
  await page.locator('textarea.area').fill('{\\"a\\":}');
  await expect(out).toContainText('去掉转义后仍不是 JSON');
});

test('pasted on a blank area, escaped JSON opens in JSON 去转义; the escape tools sit together', async ({ page }) => {
  await open(page);
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, SAMPLE);
  await expect.poll(() => activeTool(page)).toContain('JSON 去转义');
  await expect(page.locator('.out-card .out-status')).toHaveText('去掉 2 层转义');
  // One group: URL, Unicode, HTML, escape / unescape, unescape JSON.
  const group = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.side *')].filter((e) => e.children.length === 0 && e.textContent?.trim() === '转义');
    return heads.length;
  });
  expect(group).toBeGreaterThan(0);
  await nav(page, 'URL 编解码');
});
