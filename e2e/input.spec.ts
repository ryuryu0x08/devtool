// Getting content in and keeping it: smart paste, drag & drop, undo, persistence.
import { activeTool, drop, editor, expect, nav, open, pasteOnBlank, setValue, status, test, toast } from './helpers';

test.describe('smart paste on a blank area', () => {
  for (const [text, tool] of [
    ['1700000000', '时间戳转换'], ['2026-10-26 14:30', '时间戳转换'], ['{"a":1}', 'JSON 格式化'],
    ['[server]\nport = 8080', 'TOML 格式化'], ['hello world', '生成二维码'],
  ] as const) {
    test(`${JSON.stringify(text)} → ${tool}`, async ({ page }) => {
      await open(page);
      await pasteOnBlank(page, { text });
      await expect.poll(() => activeTool(page)).toContain(tool);
    });
  }

  test('replacing existing input offers Undo, which restores it and the tool', async ({ page }) => {
    await open(page, 'JSON 格式化');
    await editor(page).fill('{"mine":true}');
    await nav(page, '时间戳转换');
    await pasteOnBlank(page, { text: '{"pasted":1}' });
    await expect(toast(page)).toContainText('原内容已被替换');
    await toast(page).getByRole('button', { name: '撤销' }).click();
    await expect.poll(() => activeTool(page)).toContain('时间戳转换');
    await nav(page, 'JSON 格式化');
    await expect(editor(page)).toHaveValue('{"mine":true}');
  });

  test('text wins over an image on the same clipboard (Office copies both)', async ({ page }) => {
    await open(page, 'JSON 格式化');
    await pasteOnBlank(page, { text: '1700000000', image: true });
    await expect.poll(() => activeTool(page)).toContain('时间戳转换');
  });

  test('an image alone goes to the QR scanner', async ({ page }) => {
    await open(page);
    await pasteOnBlank(page, { image: true });
    await expect.poll(() => activeTool(page)).toContain('识别二维码');
  });

  test('paste inside an editor is a normal paste', async ({ page }) => {
    await open(page, 'JSON 格式化');
    await editor(page).fill('');
    await editor(page).focus();
    await page.evaluate(() => {
      const dt = new DataTransfer(); dt.setData('text/plain', '1700000000');
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect.poll(() => activeTool(page)).toContain('JSON 格式化');
  });
});

test.describe('drag & drop', () => {
  test('a .toml file opens the TOML formatter; replacing input can be undone', async ({ page }) => {
    await open(page, 'TOML 格式化');
    await editor(page).fill('# keep me\na = 1\n');
    await drop(page, [{ name: 'conf.toml', bytes: 'b = 2\n' }]);
    await expect(editor(page)).toHaveValue('b = 2\n');
    await toast(page).getByRole('button', { name: '撤销' }).click();
    await expect(editor(page)).toHaveValue('# keep me\na = 1\n');
  });

  test('invalid UTF-8 is refused, not shown with replacement characters', async ({ page }) => {
    await open(page, 'JSON 格式化');
    await editor(page).fill('{"before":1}');
    await drop(page, [{ name: 'bad.json', bytes: [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d] }]);
    await expect(toast(page)).toHaveText('文件不是有效的 UTF-8 编码，未打开');
    await expect(editor(page)).toHaveValue('{"before":1}');
  });

  test('a BOM is kept out of the data and reported', async ({ page }) => {
    await open(page);
    await drop(page, [{ name: 'bom.json', bytes: [0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')] }]);
    await expect(status(page)).toContainText('已去除开头的 BOM');
  });

  test('several files: one is opened and named', async ({ page }) => {
    await open(page);
    await drop(page, [{ name: 'notes.docx', bytes: 'a: 1' }, { name: 'b.json', bytes: '{"b":1}' }]);
    await expect(toast(page)).toContainText('一次只处理一个文件，已打开「b.json」');
  });

  test('an unsupported file type is explained', async ({ page }) => {
    await open(page);
    await drop(page, [{ name: 'notes.docx', bytes: 'a: 1' }]);
    await expect(toast(page)).toHaveText('这里不支持这种文件：请拖入图片或文本文件（.json、.toml、.yaml、.xml、.sql、.txt 等）；任意文件可在「Base64」「哈希」「Hex」「Gzip」中处理');
  });

  test('an unreadable image says so (not "no QR code")', async ({ page }) => {
    await open(page);
    await drop(page, [{ name: 'photo.heic', type: 'image/heic', bytes: [1, 2, 3] }]);
    await expect(page.getByText('无法读取这张图片（浏览器不支持该格式，或文件已损坏）')).toBeVisible();
    await expect(page.getByText('未识别到二维码')).toHaveCount(0);
  });
});

test.describe('persistence', () => {
  test('inputs and preferences survive a reload exactly', async ({ page }) => {
    await open(page, 'JSON 格式化');
    const text = '{"big":12345678901234567890,"s":"\\u00e9\\ud800"}';
    await editor(page).fill(text);
    await page.locator('.seg button', { hasText: '4 空格' }).click();
    await page.waitForTimeout(600);
    await page.reload();
    await expect(editor(page)).toHaveValue(text);
    await expect(page.locator('.seg button.on', { hasText: '4 空格' })).toBeVisible();
  });

  test('damaged stored preferences fall back to defaults', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('tb.prefs', JSON.stringify({ view: 'bogus', theme: 42, indent: '9', lang: 'fr', diffView: null }));
      localStorage.setItem('tb.tzRecent', '{"x":1}');
      localStorage.setItem('tb.tz', '"Mars/Olympus"');
      localStorage.setItem('tb.tool', '"json"');
    });
    await page.reload();
    await expect(page.locator('.trow').first()).toBeVisible();
    await nav(page, '时间戳转换');
    await page.getByText('▾').click();
    await expect(page.locator('.pop')).toBeVisible();
  });

  test('input too large to store: told so, and no stale copy after reload', async ({ page }) => {
    await open(page, '生成二维码');
    await page.locator('textarea').fill('old text');
    await page.waitForTimeout(600);
    await setValue(page.locator('textarea'), 'x'.repeat(6_000_000));
    // Laying out 6 MB of text takes the browser over a second, several when the machine is busy.
    await expect(toast(page)).toHaveText('内容过大，浏览器无法保存；刷新页面后不会保留', { timeout: 20_000 });
    await page.reload();
    await expect(page.locator('textarea')).not.toHaveValue('old text');
  });
});

test.describe('copy', () => {
  test('when the clipboard refuses, the user is told (never "copied")', async ({ page }) => {
    await open(page, 'JSON 格式化');
    await editor(page).fill('{"a":1}');
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
      document.execCommand = () => false;
    });
    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(toast(page)).toHaveText('复制失败，请手动选择并复制');
  });

  test('the fallback copy reports success and gives focus back', async ({ page }) => {
    await open(page, 'JSON 格式化');
    await editor(page).fill('{"a":1}');
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
      const w = window as unknown as { copied: string };
      document.execCommand = () => { w.copied = (document.activeElement as HTMLTextAreaElement).value; return true; };
    });
    const btn = page.getByRole('button', { name: '复制结果' });
    await btn.click();
    await expect(toast(page)).toHaveText('已复制');
    expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe('{\n  "a": 1\n}');
    // The hidden helper textarea took focus; it must be returned (keyboard users keep their place).
    await expect(btn).toBeFocused();
  });
});
