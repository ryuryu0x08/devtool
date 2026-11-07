// Base64 and hashes: exact bytes in, exact results out, compared with Node's own implementations.
import { createHash } from 'node:crypto';
import { clipboard, drop, expect, nav, open, setValue, test, toast } from './helpers';
import type { Page } from '@playwright/test';

const input = (page: Page) => page.locator('textarea[data-autofocus]');
const b64Out = (page: Page) => page.locator('pre.b64-out');
const b64Status = (page: Page) => page.locator('.b64-status');
const hashOf = (page: Page, algo: string) => page.locator(`[data-algo="${algo}"] .v`);
const node = (algo: string, b: Buffer | string) => createHash(algo).update(b).digest('hex');
/** Same pattern in the page and here, so large files don't cross the test protocol. */
const pattern = (n: number) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (i * 31 + (i >> 9)) & 255));
async function dropPattern(page: Page, name: string, n: number) {
  await page.evaluate(({ name, n }) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 31 + (i >> 9)) & 255;
    const dt = new DataTransfer();
    dt.items.add(new File([b], name));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { name, n });
}

test.describe('Base64', () => {
  const TEXT = '你好，世界 😀\nline 2\t<tab>';

  test('encodes UTF-8 text; both alphabets, with and without padding; LF or CRLF', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await input(page).fill(TEXT);
    await expect(b64Out(page)).toHaveText(Buffer.from(TEXT).toString('base64'));
    await expect(b64Status(page)).toHaveText(`${Buffer.byteLength(TEXT)} 字节 → ${Buffer.from(TEXT).toString('base64').length} 个字符`);
    await page.locator('.seg button', { hasText: 'URL 安全' }).click();
    await page.getByRole('button', { name: /补齐 =/ }).click();
    await expect(b64Out(page)).toHaveText(Buffer.from(TEXT).toString('base64url'));
    await page.locator('.seg button', { hasText: /^CRLF$/ }).click();
    await expect(b64Out(page)).toHaveText(Buffer.from(TEXT.replace(/\n/g, '\r\n')).toString('base64url'));
    await b64Out(page).click();
    await expect.poll(() => clipboard(page)).toBe(Buffer.from(TEXT.replace(/\n/g, '\r\n')).toString('base64url'));
  });

  test('pasting CRLF text says the box turned it into LF; CRLF gives the original bytes', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await page.evaluate(() => navigator.clipboard.writeText('a\r\nb'));
    await input(page).focus();
    await page.keyboard.press('Control+V');
    await expect(page.getByText(/粘贴的内容用的是 CRLF/)).toBeVisible();
    await expect(b64Out(page)).toHaveText(Buffer.from('a\nb').toString('base64'));
    await page.locator('.seg button', { hasText: /^CRLF$/ }).click();
    await expect(b64Out(page)).toHaveText(Buffer.from('a\r\nb').toString('base64'));
  });

  test('text with no UTF-8 form is refused', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await setValue(input(page), 'a\ud800b');
    await expect(b64Status(page)).toHaveText('文本含孤立代理字符（无法按 UTF-8 编码）');
    await expect(b64Out(page)).toHaveCount(0);
  });

  test('decoding says everything it tolerated', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await page.locator('.seg button', { hasText: '解码' }).click();
    await input(page).fill('data:text/plain;charset=utf-8;base64,5L2g5aW9\n77yM5LiW55WM');
    await expect(b64Out(page)).toHaveText('你好，世界');
    await expect(page.locator('.b64-notes span')).toHaveText(['已去掉开头的 data URL 前缀（text/plain;charset=utf-8）', '已忽略中间的 1 个空白或换行']);
    await input(page).fill('PDw_Pz4-');
    await expect(b64Out(page)).toHaveText('<<??>>');
    await expect(page.locator('.b64-notes span')).toHaveText(['按 URL 安全字符集（- _）解码']);
    await input(page).fill('QR');
    await expect(b64Out(page)).toHaveText('A');
    await expect(page.locator('.b64-notes span')).toHaveText(['末尾没有补齐的 =，已按无补齐解码', '最后一个字符里有不为 0 的多余位，已丢弃：这段 Base64 不是规范写法，重新编码会得到不同的文本']);
    await input(page).fill(Buffer.from('a​b').toString('base64'));
    await expect(page.locator('.b64-notes span')).toHaveText(['含 1 个不可见或方向控制字符（已在结果中标出）']);
    await expect(b64Out(page).locator('[data-cp="U+200B"]')).toHaveCount(1);
  });

  for (const [src, msg, mark] of [
    ['aGVs bG8 d29ybGQ=', '「U+00A0」不是 Base64 字符', 'U+00A0'],
    ['ab+/ab-_', '同时出现了标准（+ /）和 URL 安全（- _）两套字符', '-'],
    ['QQ==QQ==', '= 只能在末尾，数量要让总长度是 4 的倍数', '='],
    ['aGVsb', '去掉空白后有 5 个字符，除以 4 余 1，不是完整的 Base64', 'b'],
  ] as const) {
    test(`refused with the position: ${JSON.stringify(src)}`, async ({ page }) => {
      await open(page, 'Base64 编解码');
      await page.locator('.seg button', { hasText: '解码' }).click();
      await input(page).fill(src);
      await expect(b64Status(page)).toHaveText(/^第 1 行，第 \d+ 列$/);
      await expect(page.locator('section span', { hasText: /不是 Base64|两套字符|= 只能|不是完整/ }).first()).toHaveText(msg.replace('U+00A0', ' '));
      if (mark.startsWith('U+')) await expect(page.locator(`.err-at [data-cp="${mark}"]`)).toHaveCount(1);
      else await expect(page.locator('.err-at')).toHaveText(mark);
      await expect(page.locator('.copy-block')).toHaveCount(0);
    });
  }

  test('binary is shown as hex and downloaded byte for byte; images are previewed', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await page.locator('.seg button', { hasText: '解码' }).click();
    const bin = Buffer.from([0, 1, 2, 0xff, 0xfe, 0x80, 0x41]);
    await input(page).fill(bin.toString('base64'));
    await expect(b64Status(page)).toHaveText('7 字节 · 不是有效的 UTF-8 文本，以十六进制显示');
    await expect(page.locator('pre.b64-hex')).toHaveText('00000000  00 01 02 ff fe 80 41                               |......A|');
    await page.locator('pre.b64-hex').click();
    await expect.poll(() => clipboard(page)).toBe('000102fffe8041');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载' }).click()]);
    expect(dl.suggestedFilename()).toBe('decoded.bin');
    const fs = await import('node:fs');
    expect(fs.readFileSync((await dl.path())!)).toEqual(bin);
    // A 1×1 PNG as a data URL.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await input(page).fill('data:image/png;base64,' + png);
    await expect(page.locator('section img')).toBeVisible();
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载' }).click()]);
    expect(dl2.suggestedFilename()).toBe('decoded.png');
    expect(fs.readFileSync((await dl2.path())!)).toEqual(Buffer.from(png, 'base64'));
  });

  test('a dropped file is encoded byte for byte; data URL output; removing it brings back the text', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await input(page).fill('kept');
    const bytes = [0, 255, 10, 13, 128, 65, 66];
    await drop(page, [{ name: 'x.bin', type: 'application/octet-stream', bytes }]);
    await expect(page.getByText('x.bin')).toBeVisible();
    await expect(b64Out(page)).toHaveText(Buffer.from(bytes).toString('base64'));
    await page.getByRole('button', { name: /输出 data URL/ }).click();
    await expect(b64Out(page)).toHaveText('data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64'));
    await expect(page.getByText('data URL 固定用标准字符集并补齐')).toBeVisible();
    await page.getByRole('button', { name: '移除文件' }).click();
    await expect(input(page)).toHaveValue('kept');
  });

  test('files over 50 MB are refused with the reason', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await dropPattern(page, 'big.bin', 50 * 1024 * 1024 + 1);
    await expect(b64Status(page)).toHaveText('文件超过 50 MB，Base64 结果过大，未处理');
  });

  test('decode mode: a text file is read into the input; a binary file switches to encode', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await page.locator('.seg button', { hasText: '解码' }).click();
    await drop(page, [{ name: 'b.txt', type: 'text/plain', bytes: 'aGVsbG8=\r\n' }]);
    await expect(input(page)).toHaveValue('aGVsbG8=\n');
    await expect(b64Out(page)).toHaveText('hello');
    await drop(page, [{ name: 'p.bin', bytes: [0xff, 0xfe, 0] }]);
    await expect(toast(page)).toHaveText('这个文件的内容不是 Base64，已切换到「编码」，按文件原样编码');
    await expect(b64Out(page)).toHaveText('//4A');
  });

  test('pasting on a blank area fills this tool (no jump to another tool), and can be undone', async ({ page }) => {
    await open(page, 'Base64 编解码');
    await input(page).fill('mine');
    await page.locator('.content').click({ position: { x: 2, y: 2 } });
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '{"a":1}\r\n');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('.nav-item.on')).toContainText('Base64');
    await expect(input(page)).toHaveValue('{"a":1}\n');
    await expect(page.getByText(/粘贴的内容用的是 CRLF/)).toBeVisible();
    await toast(page).getByRole('button', { name: '撤销' }).click();
    await expect(input(page)).toHaveValue('mine');
  });
});

test.describe('hash', () => {
  test('MD5 / SHA-1 / SHA-256 of UTF-8 text, in hex, HEX or Base64', async ({ page }) => {
    await open(page, '哈希');
    const t = '中文 😀 abc';
    await input(page).fill(t);
    for (const a of ['md5', 'sha1', 'sha256']) await expect(hashOf(page, a)).toHaveText(node(a, t));
    await page.locator('.seg button', { hasText: /^HEX$/ }).click();
    await expect(hashOf(page, 'sha256')).toHaveText(node('sha256', t).toUpperCase());
    await page.locator('.seg button', { hasText: /^Base64$/ }).click();
    await expect(hashOf(page, 'md5')).toHaveText(createHash('md5').update(t).digest('base64'));
    // The whole row copies (no separate button to aim for).
    await page.locator('[data-algo="sha1"] .k').click();
    await expect.poll(() => clipboard(page)).toBe(createHash('sha1').update(t).digest('base64'));
  });

  test('line endings: LF by default, CRLF on request', async ({ page }) => {
    await open(page, '哈希');
    await input(page).fill('a\nb\n');
    await expect(hashOf(page, 'sha256')).toHaveText(node('sha256', 'a\nb\n'));
    await page.locator('.seg button', { hasText: /^CRLF$/ }).click();
    await expect(hashOf(page, 'sha256')).toHaveText(node('sha256', 'a\r\nb\r\n'));
  });

  test('a dropped file is hashed byte for byte (in a worker, with progress)', async ({ page }) => {
    await open(page, '哈希');
    const n = 24 * 1024 * 1024 + 7;
    await dropPattern(page, 'big.iso', n);
    const b = pattern(n);
    for (const a of ['md5', 'sha1', 'sha256']) await expect(hashOf(page, a)).toHaveText(node(a, b), { timeout: 30_000 });
    await expect(page.getByText(`文件原样 · ${n.toLocaleString('en-US')} 字节`)).toBeVisible();
    await expect(page.getByText('big.iso')).toBeVisible();
  });

  test('a newer file replaces a slower one: never the old result', async ({ page }) => {
    await open(page, '哈希');
    await dropPattern(page, 'slow.bin', 40 * 1024 * 1024);
    await drop(page, [{ name: 'small.txt', bytes: 'small' }]);
    await expect(hashOf(page, 'sha256')).toHaveText(node('sha256', 'small'));
    await page.waitForTimeout(1500);
    await expect(hashOf(page, 'sha256')).toHaveText(node('sha256', 'small'));
  });

  test('large text (over 1 MB) is hashed in a worker too', async ({ page }) => {
    await open(page, '哈希');
    const big = '测试 abc\n'.repeat(120_000);
    await setValue(input(page), big);
    await expect(hashOf(page, 'sha256')).toHaveText(node('sha256', big), { timeout: 30_000 });
  });

  for (const [paste, result] of [
    ['BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD', '✓ 与 SHA-256 一致'],
    ['ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  ubuntu.iso', '✓ 与 SHA-256 一致'],
    ['sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=', '✓ 与 SHA-256 一致 · 按 Base64 比较'],
    ['900150983cd24fb0d6963f7d28e17f73', '✗ 与 MD5 不一致'],
    ['a9993e364706816aba3e25717850c26c9cd0d89', '这是 39 位十六进制；MD5 / SHA-1 / SHA-256 分别是 32 / 40 / 64 位'],
    ['not a hash', '无法识别：MD5 / SHA-1 / SHA-256 分别是 32 / 40 / 64 位十六进制'],
  ] as const) {
    test(`check: ${paste.slice(0, 40)}`, async ({ page }) => {
      await open(page, '哈希');
      await input(page).fill('abc');
      await page.locator('input.hash-check').fill(paste);
      await expect(page.locator('.check-result')).toHaveText(result);
    });
  }

  test('text with no UTF-8 form is refused; clearing can be undone', async ({ page }) => {
    await open(page, '哈希');
    await setValue(input(page), 'x\udc00');
    await expect(page.locator('.hash-status')).toHaveText('文本含孤立代理字符（无法按 UTF-8 编码）');
    await input(page).fill('keep me');
    await page.getByRole('button', { name: '清空' }).click();
    await toast(page).getByRole('button', { name: '撤销' }).click();
    await expect(input(page)).toHaveValue('keep me');
  });

  test('a file pasted on a blank area is hashed', async ({ page }) => {
    await open(page, '哈希');
    await page.locator('.content').click({ position: { x: 2, y: 2 } });
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'clip.bin'));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(hashOf(page, 'md5')).toHaveText(node('md5', Buffer.from([1, 2, 3])));
  });

  test('inputs survive a reload; the file does not (it was never stored)', async ({ page }) => {
    await open(page, '哈希');
    await input(page).fill('persist');
    await page.locator('input.hash-check').fill('abc123');
    await page.waitForTimeout(600);
    await page.reload();
    await expect(input(page)).toHaveValue('persist');
    await expect(page.locator('input.hash-check')).toHaveValue('abc123');
    await nav(page, 'Base64 编解码');
    await expect(page.locator('.nav-item.on')).toContainText('Base64');
  });
});
