// TOML formatter and the semantic diff.
import { clipboard, editor, expect, nav, open, rows, setValue, status, test, textView, toast } from './helpers';
import type { Page } from '@playwright/test';

const TOML_SRC = "# config\nhex=0xFF  # trailing\npi = 3.14159265358979323846\npath='C:\\dir'\nt = 07:32:00.999999\na.b = 1\n  [srv]\n  port=8080\n  list = [ # note\n    1, 2,\n  ]\n";

test.describe('TOML formatter', () => {
  test('keeps every literal and comment; only whitespace changes', async ({ page }) => {
    await open(page, 'TOML 格式化');
    await editor(page).fill(TOML_SRC);
    const head = "# config\nhex = 0xFF # trailing\npi = 3.14159265358979323846\npath = 'C:\\dir'\nt = 07:32:00.999999\na.b = 1\n\n[srv]\n";
    // Keys under a table are indented (2 spaces by default), and so is what is inside their arrays.
    await expect.poll(() => textView(page)).toBe(head + '  port = 8080\n  list = [\n    # note\n    1,\n    2,\n  ]\n');
    await page.locator('.seg button', { hasText: '4 空格' }).click();
    await expect.poll(() => textView(page)).toBe(head + '    port = 8080\n    list = [\n        # note\n        1,\n        2,\n    ]\n');
    await page.locator('.seg button', { hasText: '不缩进' }).click();
    await expect.poll(() => textView(page)).toBe(head + 'port = 8080\nlist = [\n  # note\n  1,\n  2,\n]\n');
    // Remembered.
    await page.reload();
    await editor(page).fill(TOML_SRC);
    await expect.poll(() => textView(page)).toBe(head + 'port = 8080\nlist = [\n  # note\n  1,\n  2,\n]\n');
  });

  test('tree is laid out as TOML with values as written', async ({ page }) => {
    await open(page, 'TOML 格式化');
    await editor(page).fill('hex = 0xFF\n[t]\nx = 1.0\n');
    await expect.poll(() => rows(page)).toEqual(['hex = 0xFF', '▼[t]', 'x = 1.0']);
  });

  test('to JSON: exact numbers, dates reported, nan refused', async ({ page }) => {
    await open(page, 'TOML 格式化');
    await editor(page).fill('n = 0xFF\nbig = 9223372036854775807\nd = 1979-05-27\n');
    await page.getByRole('button', { name: '转为 JSON' }).click();
    await expect(editor(page)).toHaveValue('{\n  "n": 255,\n  "big": 9223372036854775807,\n  "d": "1979-05-27"\n}');
    await expect(toast(page)).toContainText('已转换；1 个日期时间已转为字符串（JSON 没有日期类型）');
    await nav(page, 'TOML 格式化');
    await editor(page).fill('x = nan\n');
    await page.getByRole('button', { name: '转为 JSON' }).click();
    await expect(toast(page)).toHaveText('无法转换：JSON 不支持 nan（$.x）');
  });

  test('errors show line and column', async ({ page }) => {
    await open(page, 'TOML 格式化');
    await editor(page).fill('a = 1\nb = \n');
    await expect(status(page)).toHaveText('第 2 行，第 5 列');
  });
});

const A = (page: Page) => page.locator('textarea').nth(0);
const B = (page: Page) => page.locator('textarea').nth(1);
const badges = (page: Page) => page.locator('.badge').allTextContents();
const diffRows = async (page: Page) => (await page.locator('.trow').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim());

test.describe('diff', () => {
  for (const [name, a, b, expected] of [
    ['field added', '{"a":1}', '{"a":1,"b":2}', ['+ 1 新增', '− 0 删除', '~ 0 修改']],
    ['element inserted at the front', '[1,2,3]', '[0,1,2,3]', ['+ 1 新增', '− 0 删除', '~ 0 修改']],
    ['element removed in the middle', '[1,2,3]', '[1,3]', ['+ 0 新增', '− 1 删除', '~ 0 修改']],
    ['type change', '{"a":{}}', '{"a":[]}', ['+ 0 新增', '− 0 删除', '~ 1 修改']],
    ['big integers', '[12345678901234567890]', '[12345678901234567891]', ['+ 0 新增', '− 0 删除', '~ 1 修改']],
    ['beyond double precision', '[0.1]', '[0.10000000000000000555]', ['+ 0 新增', '− 0 删除', '~ 1 修改']],
    ['null vs missing', '{"a":null}', '{}', ['+ 0 新增', '− 1 删除', '~ 0 修改']],
  ] as const) {
    test(name, async ({ page }) => {
      await open(page, 'JSON 对比');
      await A(page).fill(a);
      await B(page).fill(b);
      await expect.poll(() => badges(page)).toEqual(expected);
    });
  }

  test('identical apart from key order / whitespace', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('{"a":1,"b":[1,2]}');
    await B(page).fill('{ "b": [1, 2], "a": 1 }');
    await expect(page.getByText('语义完全一致')).toBeVisible();
    await expect(page.getByText('key 顺序、缩进、空白不影响结果')).toBeVisible();
  });

  test('equal values written differently are listed, not hidden', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('{"a":1.0,"\\u0062":"\\u00e9"}');
    await B(page).fill('{"a":1,"b":"é"}');
    await expect(page.getByText('值都相同，但有 3 处写法不同')).toBeVisible();
    await expect.poll(() => diffRows(page)).toEqual(['▼ {', '≈ "a" : 1.0 → 1 写法不同', '≈ "\\u0062" → "b" : "\\u00e9" → "é" 键的写法不同 · 写法不同', '}']);
  });

  test('moved elements show both indices; the list gives both paths', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('[1,{"x":1}]');
    await B(page).fill('[0,1,{"x":2}]');
    await page.getByRole('button', { name: /仅显示差异/ }).click();
    await expect.poll(() => diffRows(page)).toContain('▼ 1→2 : {');
    await page.locator('.seg button', { hasText: '差异清单' }).click();
    await expect(page.locator('.path-btn')).toHaveText(['$[0]', '$[1].x', '→ $[2].x']);
  });

  test('long strings: the difference is in view; invisible characters are shown', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill(JSON.stringify({ s: 'x'.repeat(200) + 'A', z: 'ab' }));
    await B(page).fill(JSON.stringify({ s: 'x'.repeat(200) + 'B', z: 'a\u200bb' }));
    await expect.poll(() => diffRows(page)).toEqual(['▼ {', `~ "s" : …${'x'.repeat(30)}A" → …${'x'.repeat(30)}B"`, '~ "z" : "ab" → "a\\u200bb"', '}']);
  });

  test('JSON vs TOML: compared by value, spelling differences listed', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('{"n":255,"s":"x"}');
    await B(page).fill("n = 0xFF\ns = 'x'\n");
    await expect(page.getByText('值都相同，但有 2 处写法不同')).toBeVisible();
  });

  test('changes that look alike say why they are changes', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('n = 1\nt = 1979-05-27T07:32:00Z\nd = "1979-05-27"\n');
    await B(page).fill('n = 1.0\nt = 1979-05-27T15:32:00+08:00\nd = 1979-05-27\n');
    await expect.poll(() => diffRows(page)).toEqual([
      '▼ {',
      '~ "n" : 1 → 1.0 类型：整数 → 浮点数',
      '~ "t" : 1979-05-27T07:32:00Z → 1979-05-27T15:32:00+08:00 同一时刻，时区偏移不同',
      '~ "d" : "1979-05-27" → 1979-05-27 类型：字符串 → 本地日期',
      '}',
    ]);
    await page.locator('.seg button', { hasText: '差异清单' }).click();
    await expect(page.getByText('类型：整数 → 浮点数')).toBeVisible();
    // In JSON 1 and 1.0 are the same number: no type note, listed as written differently.
    await A(page).fill('{"n":1}');
    await B(page).fill('n = 1.0');
    await expect(page.getByText('值都相同，但有 1 处写法不同')).toBeVisible();
  });

  test('whitespace inside values is shown as written (newlines, runs of spaces)', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('s = """a\nb"""\nw = "a  b"\n');
    await B(page).fill('{"s":"a\\nb","w":"a b"}');
    // innerText is what is rendered: collapsed whitespace would read "a b" here.
    const shown = (row: number) => page.locator('.trow').nth(row).locator('.body > span').nth(3).evaluate((el) => (el as HTMLElement).innerText);
    await expect.poll(() => shown(1)).toBe('"""a\nb"""');
    await expect.poll(() => shown(2)).toBe('"a  b"');
  });

  test('duplicate keys and syntax errors are explained per side', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('{"a":1,"a":2}');
    await expect(page.getByText('存在重复键 $.a，无法确定应使用哪个值')).toBeVisible();
    await B(page).fill('{\n  "a": 1,\n  "b": [1, 2,]\n}');
    await expect(page.getByText('无效 · 第 3 行，第 14 列')).toBeVisible();
  });

  test('ignore array order; fold; only-differences toggle', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('{"t":[1,2,3],"u":1}');
    await B(page).fill('{"t":[3,1,2],"u":2}');
    await expect.poll(() => badges(page)).toEqual(['+ 1 新增', '− 1 删除', '~ 1 修改']);
    await page.getByRole('button', { name: /忽略数组顺序/ }).click();
    await expect.poll(() => badges(page)).toEqual(['+ 0 新增', '− 0 删除', '~ 1 修改']);
    await expect(page.getByText('… 1 项未变化')).toBeVisible();
    await page.getByRole('button', { name: /仅显示差异/ }).click();
    await expect(page.getByText('… 1 项未变化')).toHaveCount(0);
    await page.getByRole('button', { name: '展开 / 折叠' }).first().click();
    await expect(page.getByText('1 处差异')).toBeVisible();
  });

  test('huge diffs: first 4000 rows with the exact total', async ({ page }) => {
    await open(page, 'JSON 对比');
    await setValue(A(page), JSON.stringify(Array.from({ length: 6000 }, (_, i) => i)));
    await setValue(B(page), JSON.stringify(Array.from({ length: 6000 }, (_, i) => -i - 1)));
    await expect(page.getByText('仅显示前 4000 条，共 6002 条')).toBeVisible();
  });

  test('swap; sample and clear can be undone', async ({ page }) => {
    await open(page, 'JSON 对比');
    await A(page).fill('[1]');
    await B(page).fill('[2]');
    await page.getByRole('button', { name: /交换/ }).click();
    await expect(A(page)).toHaveValue('[2]');
    await page.getByRole('button', { name: '清空' }).click();
    await toast(page).getByRole('button', { name: '撤销' }).click();
    await expect(A(page)).toHaveValue('[2]');
    await expect(B(page)).toHaveValue('[1]');
  });

  test('round trip across tools: formatted output vs its source is identical', async ({ page }) => {
    await open(page, 'JSON 格式化');
    const src = '{"id":1234567890123456789,"f":1.50,"s":"\\u00e9","a":[1,{"b":null}]}';
    await editor(page).fill(src);
    await page.getByRole('button', { name: '复制结果' }).click();
    await expect(toast(page)).toHaveText('已复制');
    const formatted = await clipboard(page);
    expect(formatted).toContain('\n  "id": 1234567890123456789,');
    await nav(page, 'JSON 对比');
    await A(page).fill(src);
    await B(page).fill(formatted);
    await expect(page.getByText('语义完全一致')).toBeVisible();
    await expect(page.getByText('key 顺序、缩进、空白不影响结果')).toBeVisible();
    // Same for TOML.
    await nav(page, 'TOML 格式化');
    await editor(page).fill(TOML_SRC);
    const tomlOut = await textView(page);
    await nav(page, 'JSON 对比');
    await A(page).fill(TOML_SRC);
    await B(page).fill(tomlOut);
    await expect(page.getByText('语义完全一致')).toBeVisible();
    await expect(page.getByText('key 顺序、缩进、空白不影响结果')).toBeVisible();
  });
});
