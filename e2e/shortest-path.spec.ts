// The shortest path: the result itself copies; a paste or a dropped file lands where it is useful.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { activeTool, clipboard, drop, expect, open, pasteOnBlank, test, toast } from './helpers';
import type { Page } from '@playwright/test';

const input = (page: Page) => page.locator('textarea[data-autofocus]');
const A = (page: Page) => page.locator('textarea').nth(0);
const B = (page: Page) => page.locator('textarea').nth(1);
const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
/** A real Ctrl+V into a field, with this text on the clipboard. */
async function pasteInto(page: Page, el: ReturnType<Page['locator']>, text: string) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await el.focus();
  await page.keyboard.press('Control+V');
}

test.describe('the result itself copies', () => {
  test('hash: a click anywhere on a row copies its value', async ({ page }) => {
    await open(page, '哈希');
    await input(page).fill('abc');
    for (const part of ['.k', '.v', '.c']) {
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.locator(`[data-algo="sha256"] ${part}`).click();
      await expect.poll(() => clipboard(page)).toBe(sha256('abc'));
    }
  });

  test('QR scan: a click on the decoded text copies it', async ({ page }) => {
    await open(page, '识别二维码');
    await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('./fixtures/gbk.svg', import.meta.url)));
    await page.locator('.qr-text').click();
    await expect.poll(() => clipboard(page)).toBe('中文测试');
  });

  test('QR generator: a click on the code copies the image', async ({ page }) => {
    await open(page, '生成二维码');
    await page.getByRole('button', { name: '二维码（点击复制图片）' }).click();
    // Chrome sometimes takes ~7 s to put an image on the clipboard in a freshly opened page (measured here;
    // repeated copies take ~0.1 s), so the wait is longer than for text.
    await expect(toast(page)).toHaveText('图片已复制', { timeout: 15_000 });
    expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain('image/png');
  });
});

test.describe('a paste on a blank area stays in a tool that can use it', () => {
  test('QR generator keeps any text, even JSON (and Undo brings back the old text)', async ({ page }) => {
    await open(page, '生成二维码');
    await pasteOnBlank(page, { text: '{"a":1}' });
    expect(await activeTool(page)).toContain('生成二维码');
    await expect(input(page)).toHaveValue('{"a":1}');
    await toast(page).getByRole('button', { name: '撤销' }).click();
    await expect(input(page)).toHaveValue('https://example.com/hello');
  });

  test('diff: two pastes fill A, then B; after typing in A the paste goes to B', async ({ page }) => {
    await open(page, 'JSON 对比');
    await pasteOnBlank(page, { text: '{"a":1}' });
    await expect(toast(page)).toContainText('已填入 A');
    await pasteOnBlank(page, { text: '{"a":2}' });
    await expect(toast(page)).toContainText('已填入 B');
    await expect(A(page)).toHaveValue('{"a":1}');
    await expect(B(page)).toHaveValue('{"a":2}');
    await expect(page.locator('.badge')).toHaveText(['+ 0 新增', '− 0 删除', '~ 1 修改']);
    await A(page).fill('{"a":3}');
    await pasteOnBlank(page, { text: 'a = 3' });
    await expect(B(page)).toHaveValue('a = 3');
    await expect(page.getByText('语义完全一致')).toBeVisible();
    // Not JSON / TOML: routed as before (a timestamp opens the timestamp tool).
    await pasteOnBlank(page, { text: '1793000000' });
    await expect.poll(() => activeTool(page)).toContain('时间戳转换');
  });

  test('hash: with a file loaded, a pasted checksum is checked — the file stays', async ({ page }) => {
    await open(page, '哈希');
    await drop(page, [{ name: 'app.bin', bytes: 'payload' }]);
    await expect(page.locator('[data-algo="sha256"] .v')).toHaveText(sha256('payload'));
    await pasteOnBlank(page, { text: sha256('payload') + '  app.bin' });
    await expect(toast(page)).toHaveText('已填入「核对」');
    await expect(page.locator('.check-result')).toHaveText('✓ 与 SHA-256 一致');
    await expect(page.getByText('app.bin', { exact: true })).toBeVisible();
  });

  test('hash: with nothing to check, a pasted hash is the text to hash', async ({ page }) => {
    await open(page, '哈希');
    await pasteOnBlank(page, { text: sha256('x') });
    await expect(input(page)).toHaveValue(sha256('x'));
    await expect(page.locator('input.hash-check')).toHaveValue('');
  });

  test('hash: text pasted over a loaded file replaces it, and Undo brings the file back', async ({ page }) => {
    await open(page, '哈希');
    await drop(page, [{ name: 'keep.bin', bytes: [1, 2, 3] }]);
    await expect(page.getByText('keep.bin')).toBeVisible();
    await pasteOnBlank(page, { text: 'some text' });
    await expect(input(page)).toHaveValue('some text');
    await toast(page).getByRole('button', { name: '撤销' }).click();
    await expect(page.getByText('keep.bin')).toBeVisible();
    await expect(page.locator('[data-algo="md5"] .v')).toHaveText(createHash('md5').update(Buffer.from([1, 2, 3])).digest('hex'));
  });

  test('Base64: the direction follows the content, and says so', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await pasteOnBlank(page, { text: 'aGVsbG8gd29ybGQ=' });
    await expect(toast(page)).toHaveText('已按内容切换到「解码」');
    await expect(page.locator('pre.b64-out')).toHaveText('hello world');
    await pasteOnBlank(page, { text: 'plain text' });
    await expect(toast(page)).toContainText('已按内容切换到「编码」');
    await expect(page.locator('pre.b64-out')).toHaveText(Buffer.from('plain text').toString('base64'));
  });

  test('Base64: a real Ctrl+V into the empty box picks the direction too; adding to existing text does not', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await pasteInto(page, input(page), 'data:text/plain;base64,5L2g5aW9');
    await expect(toast(page)).toHaveText('已按内容切换到「解码」');
    await expect(page.locator('pre.b64-out')).toHaveText('你好');
    // Typing more into a filled box never flips the direction.
    await pasteInto(page, input(page), 'zzz');
    await expect(page.locator('.seg button.on', { hasText: '解码' })).toHaveCount(1);
  });
});

test.describe('pasted / dropped content opens the right tool from anywhere', () => {
  for (const [text, out] of [['data:text/plain;base64,aGk=', 'hi'], ['5L2g5aW977yM5LiW55WM', '你好，世界']] as const) {
    test(`Base64 is decoded: ${text}`, async ({ page }) => {
      await open(page, '时间戳转换');
      await pasteOnBlank(page, { text });
      await expect.poll(() => activeTool(page)).toContain('Base64');
      await expect(page.locator('pre.b64-out')).toHaveText(out);
    });
  }

  test('ordinary words are not taken for Base64', async ({ page }) => {
    await open(page, '时间戳转换');
    await pasteOnBlank(page, { text: 'username' });
    await expect.poll(() => activeTool(page)).toContain('生成二维码');
  });

  test('the search box offers Base64 for Base64 text', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('搜索工具，或直接粘贴内容…').fill('aGVsbG8gd29ybGQ=');
    await expect(page.locator('.list-item').first()).toContainText('用「Base64 编解码」处理输入的内容');
  });

  test('diff: two files dropped together fill A and B', async ({ page }) => {
    await open(page, 'JSON 对比');
    await drop(page, [{ name: 'old.json', bytes: '{"v":1}' }, { name: 'new.json', bytes: '{"v":2}' }]);
    await expect(toast(page)).toContainText('已填入 A：old.json；B：new.json');
    await expect(A(page)).toHaveValue('{"v":1}');
    await expect(B(page)).toHaveValue('{"v":2}');
    await drop(page, [{ name: 'c.toml', bytes: 'v = 2\n' }]);
    await expect(A(page)).toHaveValue('v = 2\n');
    await expect(page.getByText('语义完全一致')).toBeVisible();
  });

  test('Base64 decode: a dropped file of Base64 text fills the input', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await page.locator('.seg button', { hasText: '解码' }).click();
    await drop(page, [{ name: 'note.txt', bytes: 'aGVsbG8=\n' }]);
    await expect(page.locator('pre.b64-out')).toHaveText('hello');
    // A text file that isn't Base64 is encoded as a file instead.
    await drop(page, [{ name: 'plain.txt', bytes: 'not base64!' }]);
    await expect(toast(page)).toHaveText('这个文件的内容不是 Base64，已切换到「编码」，按文件原样编码');
    await expect(page.locator('pre.b64-out')).toHaveText(Buffer.from('not base64!').toString('base64'));
  });

  test('QR generator: a dropped .txt fills it', async ({ page }) => {
    await open(page, '生成二维码');
    await drop(page, [{ name: 'link.txt', bytes: 'https://example.org/x\n' }]);
    await expect(input(page)).toHaveValue('https://example.org/x\n');
  });
});
