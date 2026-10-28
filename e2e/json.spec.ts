// JSON formatter: output changes whitespace only; everything else is reported, never silent.
import { clipboard, editor, expect, nav, open, rows, setValue, status, test, textView, toast, treeView } from './helpers';

const LOSSLESS = '{"id":1234567890123456789,"p":3.141592653589793238,"e":1E400,"z":-0,"f":1.50,"s":"\\u00e9\\/","\\u0061":1}';

test('formatting keeps every token: numbers, escapes, key spelling', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill(LOSSLESS);
  const text = await textView(page);
  expect(text).toBe('{\n  "id": 1234567890123456789,\n  "p": 3.141592653589793238,\n  "e": 1E400,\n  "z": -0,\n  "f": 1.50,\n  "s": "\\u00e9\\/",\n  "\\u0061": 1\n}');
  await page.getByRole('button', { name: '复制结果' }).click();
  await expect(toast(page)).toHaveText('已复制');
  expect(await clipboard(page)).toBe(text);
  // Minified: shown in the text view (chosen from the tree view, it goes there), copied as shown.
  await page.getByRole('button', { name: '结构' }).click();
  await page.locator('.seg button', { hasText: '压缩' }).click();
  await expect(page.locator('.seg button.on', { hasText: /^文本$/ })).toHaveCount(1);
  await expect(page.locator('pre').first()).toHaveText(LOSSLESS);
  await page.getByRole('button', { name: '复制结果' }).click();
  await expect.poll(() => clipboard(page)).toBe(LOSSLESS);
  // The choice is remembered.
  await page.reload();
  await editor(page).fill(LOSSLESS);
  await expect.poll(() => textView(page)).toBe(LOSSLESS);
});

test('indent 4 / Tab', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('{"a":[1]}');
  await page.locator('.seg button', { hasText: '4 空格' }).click();
  await expect.poll(() => textView(page)).toBe('{\n    "a": [\n        1\n    ]\n}');
  await page.locator('.seg button', { hasText: 'Tab' }).click();
  await expect.poll(() => textView(page)).toBe('{\n\t"a": [\n\t\t1\n\t]\n}');
});

test('duplicate keys are kept as written, flagged in the tree and the status', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('{"a":1,"a":2}');
  await expect(status(page)).toContainText('1 个重复键（已原样保留；多数程序只读取最后一个）：$.a');
  await expect(page.locator('.trow .meta', { hasText: '重复键' })).toHaveCount(1);
  await expect.poll(() => textView(page)).toBe('{\n  "a": 1,\n  "a": 2\n}');
});

test('errors show line and column, and mark the character in its line', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('{\n  "a": 1,\n  "b": }');
  await expect(status(page)).toHaveText('第 3 行，第 8 列');
  await expect(page.locator('pre .err-at')).toHaveText('}');
  await expect(page.locator('pre', { has: page.locator('.err-at') })).toHaveText('  "b": }');
  // Wide characters before the error don't shift the mark.
  await editor(page).fill('{"名称":"值",}');
  await expect(page.locator('pre .err-at')).toHaveText('}');
  // End of input is marked too.
  await editor(page).fill('{"a":');
  await expect(page.locator('pre .err-at')).toHaveCount(1);
});

test('an invisible character that breaks the syntax is named, in the message and in the line', async ({ page }) => {
  await open(page, 'JSON 格式化');
  for (const [ch, cp] of [['\u00a0', 'U+00A0'], ['\u200b', 'U+200B'], ['\u202e', 'U+202E']]) {
    await editor(page).fill('{"a":1,' + ch + '"b":2}');
    await expect(page.locator('pre .err-at [data-cp="' + cp + '"]')).toHaveCount(1);
    await expect(page.locator('span', { hasText: 'Unexpected' }).locator('[data-cp="' + cp + '"]')).toHaveCount(1);
  }
});

test('nesting deeper than supported is refused with a message (no lossy fallback)', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await setValue(editor(page), '['.repeat(600) + ']'.repeat(600));
  await expect(page.getByText('Nesting deeper than 512 levels is not supported')).toBeVisible();
});

test('sort keys is stable and explicit', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('{"b":1,"a":2,"a":3}');
  await page.getByRole('button', { name: /按 key 排序/ }).click();
  await expect.poll(() => textView(page)).toBe('{\n  "a": 2,\n  "a": 3,\n  "b": 1\n}');
});

test('tree: fold by level, keyboard navigation, copy path / value', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('{"a":{"x":"v\\u0000"},"b":[1,2]}');
  await page.getByRole('button', { name: '1 层' }).click();
  await expect.poll(() => rows(page)).toEqual(['▼{2 个键', '▶"a": { … },1 个键', '▶"b": [ … ]2 项', '}']);
  await page.getByRole('button', { name: '全部展开' }).click();
  await page.locator('[data-row]').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.trow').nth(1)).toContainText('{ … }');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.mono[style*="--acc"]').first()).toHaveText('$.a.x');
  await page.getByRole('button', { name: '复制路径' }).click();
  await expect.poll(() => clipboard(page)).toBe('$.a.x');
  // The value holds NUL, which clipboards may cut: its escaped form is copied instead.
  await page.getByRole('button', { name: '复制值' }).click();
  await expect(toast(page)).toHaveText('值含 NUL 或孤立代理字符，剪贴板无法原样保存，已复制其转义写法');
  expect(await clipboard(page)).toBe('"v\\u0000"');
});

test('direction-control characters are marked (copying stays exact)', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('{"user":"admin‮txt.exe"}');
  await expect(status(page)).toContainText('含 1 个不可见或方向控制字符（已在结果中标出）');
  await expect(page.locator('.trow [data-cp="U+202E"]')).toHaveCount(1);
  await textView(page);
  await expect(page.locator('pre [data-cp="U+202E"]')).toHaveCount(1);
  await page.getByRole('button', { name: '复制结果' }).click();
  await expect.poll(() => clipboard(page)).toBe('{\n  "user": "admin‮txt.exe"\n}');
});

test.describe('to TOML', () => {
  for (const [src, msg] of [
    ['{"a":3.141592653589793238}', '无法转换：TOML 浮点数为双精度，无法精确表示 3.141592653589793238 → 3.141592653589793（$.a）'],
    ['{"a":9223372036854775808}', '无法转换：整数 9223372036854775808 超出 TOML 的 64 位整数范围（$.a）'],
    ['{"a":[1,null]}', '无法转换：TOML 没有 null（$.a[1]）'],
    ['{"a":1e400}', '无法转换：数值 1e400 超出浮点数范围（$.a）'],
    ['{"a":1,"a":2}', '无法转换：存在重复键 $.a，无法确定应使用哪个值'],
    ['[1,2]', '无法转换：TOML 顶层必须是对象'],
  ] as const) {
    test(`refused: ${src}`, async ({ page }) => {
      await open(page, 'JSON 格式化');
      await editor(page).fill(src);
      await page.getByRole('button', { name: '转为 TOML' }).click();
      await expect(toast(page)).toHaveText(msg);
      await expect(editor(page)).toHaveValue(src);
    });
  }

  test('converted exactly; the TOML that was there can be restored', async ({ page }) => {
    await open(page, 'TOML 格式化');
    await editor(page).fill('# my config\nkeep = 1\n');
    await nav(page, 'JSON 格式化');
    await editor(page).fill('{"id":9223372036854775807,"price":1.50,"tags":["a"],"srv":{"port":8080}}');
    await page.getByRole('button', { name: '转为 TOML' }).click();
    await expect(editor(page)).toHaveValue('id = 9223372036854775807\nprice = 1.50\ntags = ["a"]\n\n[srv]\nport = 8080\n');
    await toast(page).getByRole('button', { name: '撤销' }).click();
    await nav(page, 'TOML 格式化');
    await expect(editor(page)).toHaveValue('# my config\nkeep = 1\n');
  });
});

test('sample / clear can be undone', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('{"mine":1}');
  await page.getByRole('button', { name: '清空' }).click();
  await expect(editor(page)).toHaveValue('');
  await toast(page).getByRole('button', { name: '撤销' }).click();
  await expect(editor(page)).toHaveValue('{"mine":1}');
});

test('large input: processed when typing pauses, nothing copyable until it matches', async ({ page }) => {
  await open(page, 'JSON 格式化');
  const doc = JSON.stringify(Array.from({ length: 2500 }, (_, i) => ({ id: i, name: 'item ' + i })), null, 1);
  await setValue(editor(page), doc);
  await expect(status(page)).toHaveText('处理中…');
  await page.getByRole('button', { name: '复制结果' }).click();
  await expect(toast(page)).toHaveCount(0);
  await expect(status(page)).toContainText('有效 JSON');
  await expect(page.getByText(/仅显示前 4000 行/)).toBeVisible();
});

test('empty input asks for input', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('   ');
  await expect(page.getByText('在左侧输入或粘贴 JSON')).toBeVisible();
  await treeView(page);
});

test('the selected path marks invisible characters in key names and copies them exactly', async ({ page }) => {
  await open(page, 'JSON 格式化');
  await editor(page).fill('{"a\\u200bb":{"  x":1}}');
  await page.locator('[data-row]').nth(2).click();
  const path = page.locator('.mono[style*="--acc"]').first();
  await expect(path.locator('[data-cp="U+200B"]')).toHaveCount(1);
  // Two leading spaces in the key stay visible.
  expect(await path.evaluate((el) => (el as HTMLElement).innerText)).toContain('["  x"]');
  await page.getByRole('button', { name: '复制路径' }).click();
  await expect.poll(() => clipboard(page)).toBe('$["a​b"]["  x"]');
});
