// The tools added in the second round: each one's main flow and errors, and where pasted or
// dropped content lands. Expected values come from Node's own zlib / crypto where they can.
import { createHmac } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Locator, Page } from '@playwright/test';
import { activeTool, clipboard, drop, expect, nav, open, pasteOnBlank, setValue, test } from './helpers';

const input = (page: Page) => page.locator('textarea[data-autofocus], input[data-autofocus]').first();
const out = (page: Page) => page.locator('.out-card .tool-out').first();
const outStatus = (page: Page) => page.locator('.out-status').first();
const notes = (page: Page) => page.locator('.out-notes').first();
const errBox = (page: Page) => page.locator('.err-box').first();
const kv = (page: Page, label: string | RegExp) => page.locator('.kv', { has: page.locator('.k', { hasText: label }) }).first();
const flag = (page: Page, label: string) => page.locator('button.btn', { hasText: label }).first();
const seg = (page: Page, label: string) => page.locator('.seg button', { hasText: label }).first();

/** A real Ctrl+V into a field, with this text on the clipboard. */
async function pasteInto(page: Page, el: Locator, text: string) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await el.focus();
  await page.keyboard.press('Control+V');
}

const jwt = (payload: string, secret: string) => {
  const h = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const p = Buffer.from(payload).toString('base64url');
  return h + '.' + p + '.' + createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
};

test.describe('encoding', () => {
  test('URL: pasted %XX text is decoded; "+" is kept unless asked; the result copies on click', async ({ page }) => {
    await open(page, 'URL 编解码');
    await pasteInto(page, input(page), 'a%20b%E4%B8%AD+c');
    await expect(seg(page, '解码')).toHaveClass(/on/);
    await expect(out(page)).toHaveText('a b中+c');
    await expect(notes(page)).toContainText('有 1 个「+」按原样保留为加号');
    await flag(page, '+ 表示空格').click();
    await expect(out(page)).toHaveText('a b中 c');
    await out(page).click();
    await expect.poll(() => clipboard(page)).toBe('a b中 c');
    await input(page).fill('100%zz');
    await expect(errBox(page)).toContainText('「%」后面应是两位十六进制数字');
    await expect(page.locator('mark.err-at')).toHaveText('%');
    await seg(page, '编码').click();
    await input(page).fill('a b&c=中');
    await expect(out(page)).toHaveText(encodeURIComponent('a b&c=中'));
  });

  test('Unicode escapes, HTML entities and string escapes: pasted escaped text is unescaped', async ({ page }) => {
    await open(page, 'Unicode 转义');
    await pasteInto(page, input(page), '\\u4e2d\\u{1F600}');
    await expect(out(page)).toHaveText('中😀');
    await nav(page, 'HTML 实体');
    await pasteInto(page, input(page), '&lt;b&gt;&copy');
    // "&copy" without ";" is kept as written, and said so.
    await expect(out(page)).toHaveText('<b>&copy');
    await expect(notes(page)).toContainText('有 1 处实体没有结尾的「;」');
    await nav(page, '转义 / 还原');
    await pasteInto(page, input(page), '"say \\"hi\\"\\n\\u00e9"');
    expect(await out(page).textContent()).toBe(JSON.parse('"say \\"hi\\"\\n\\u00e9"'));
    await seg(page, 'Shell').click();
    await seg(page, '转义').click();
    await input(page).fill("it's $HOME");
    await expect(out(page)).toHaveText("'it'\\''s $HOME'");
    await seg(page, '还原').click();
    await input(page).fill('echo $HOME');
    await expect(errBox(page)).toContainText('含有 $ 或 ` 展开');
  });

  test('Hex: text ⇄ hex with separators and prefixes; a wrong digit is marked', async ({ page }) => {
    await open(page, 'Hex 编解码');
    await input(page).fill('Hi!');
    await expect(out(page)).toHaveText('48 69 21');
    await seg(page, '0x').click();
    await flag(page, '大写').click();
    await expect(out(page)).toHaveText('0x48 0x69 0x21');
    await page.getByRole('button', { name: '清空' }).click();
    await pasteInto(page, input(page), '48 69 21');
    await expect(seg(page, 'Hex → 文本')).toHaveClass(/on/);
    await expect(out(page)).toHaveText('Hi!');
    await input(page).fill('48 6g');
    await expect(errBox(page)).toContainText('「g」不是十六进制数字');
    await expect(page.locator('mark.err-at')).toHaveText('g');
    // Options are remembered.
    await page.reload();
    await seg(page, '文本 → Hex').click();
    await input(page).fill('A');
    await expect(out(page)).toHaveText('0x41');
  });

  test('Hex and Gzip take any dropped file as bytes', async ({ page }) => {
    await open(page, 'Hex 编解码');
    await drop(page, [{ name: 'x.bin', bytes: [0, 255, 16] }]);
    await expect(out(page)).toHaveText('00 ff 10');
    await nav(page, 'Gzip 压缩解压');
    await drop(page, [{ name: 'notes.txt.gz', bytes: [...gzipSync('dropped 文本')] }]);
    await expect(seg(page, '解压')).toHaveClass(/on/);
    await expect(out(page)).toHaveText('dropped 文本');
    // Saved under the name it had inside the .gz, not notes.txt.txt.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载' }).click()]);
    expect(dl.suggestedFilename()).toBe('notes.txt');
  });

  test('Gzip: what it compresses, zlib decompresses; what zlib compresses, it decompresses', async ({ page }) => {
    await open(page, 'Gzip 压缩解压');
    const text = 'hello 你好 '.repeat(40);
    await input(page).fill(text);
    await expect(outStatus(page)).toContainText('结果（Base64）');
    const b64 = (await out(page).textContent())!;
    expect(gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')).toBe(text);
    await page.getByRole('button', { name: '清空' }).click();
    await pasteInto(page, input(page), gzipSync('来自 zlib').toString('base64'));
    await expect(seg(page, '解压')).toHaveClass(/on/);
    await expect(out(page)).toHaveText('来自 zlib');
    await input(page).fill('H4sIAAAAAAAAA3uyd8HTpXsV');
    await expect(errBox(page)).toContainText('无法按 gzip 解压');
  });

  test('Number bases: every base is a box; editing any one updates the rest, exactly', async ({ page }) => {
    await open(page, '进制转换');
    const box = (name: string) => page.getByRole('textbox', { name, exact: true });
    const values = () => page.locator('.base-row input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    await box('十六进制').fill('ff');
    expect(await values()).toEqual(['11111111', '377', '255', 'ff', (255).toString(36)]);
    await box('二进制').fill('-101');
    expect(await values()).toEqual(['-101', '-5', '-5', '-5', '-5']);
    await expect(kv(page, '8 位无符号').locator('.v')).toHaveText('251');
    await box('十进制').fill('0xFFFFFFFFFFFFFFFFFFFF');
    await expect(box('八进制')).toHaveValue(BigInt('0xFFFFFFFFFFFFFFFFFFFF').toString(8));
    await expect(box('十进制')).toHaveValue('0xFFFFFFFFFFFFFFFFFFFF');
    await flag(page, '大写').click();
    await expect(box('36 进制')).toHaveValue(BigInt('0xFFFFFFFFFFFFFFFFFFFF').toString(36).toUpperCase());
    await page.getByRole('spinbutton', { name: '自定义' }).fill('7');
    await expect(box('7 进制')).toHaveValue(BigInt('0xFFFFFFFFFFFFFFFFFFFF').toString(7));
    // A click selects the whole number, ready to copy or type over; the label copies it.
    await box('十六进制').click();
    expect(await box('十六进制').evaluate((e: HTMLInputElement) => e.selectionEnd! - e.selectionStart!)).toBe(20);
    await page.locator('.base-label', { hasText: '二进制' }).click();
    await expect.poll(() => clipboard(page)).toBe(BigInt('0xFFFFFFFFFFFFFFFFFFFF').toString(2));
    await box('十进制').fill('12.5');
    await expect(errBox(page)).toContainText('只支持整数');
    await box('二进制').fill('1012');
    await expect(errBox(page)).toContainText('「2」不是 2 进制的数字');
    await expect(box('十进制')).toHaveValue('');
    // Pasted on the page: bare hex lands in the hex box.
    await pasteOnBlank(page, { text: 'beef' });
    await expect(box('十进制')).toHaveValue(String(0xbeef));
  });
});

test.describe('web', () => {
  test('JWT: payload numbers exactly as written; signature checked with the key, which is never stored', async ({ page }) => {
    await open(page);
    const token = jwt('{"sub":"42","exp":4102444800,"big":12345678901234567890}', 's3cret');
    await pasteOnBlank(page, { text: 'Bearer ' + token });
    await expect.poll(() => activeTool(page)).toContain('JWT 解码');
    await expect(outStatus(page)).toHaveText('算法 HS256 · 在有效期内');
    await expect(page.locator('.jwt-part').first()).toContainText('"big": 12345678901234567890');
    await expect(kv(page, '过期时间 exp')).toContainText('2100-01-01 08:00:00');
    const key = page.getByRole('textbox', { name: '校验签名' });
    await key.fill('s3cret');
    await expect(page.locator('.jwt-verify')).toHaveText('✓ 签名有效');
    await key.fill('wrong');
    await expect(page.locator('.jwt-verify')).toHaveText('✗ 签名无效');
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.getByRole('textbox', { name: '校验签名' })).toHaveValue('');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('wrong');
    await input(page).fill('abc.def');
    await expect(errBox(page)).toContainText('JWT 应由两个「.」分成三段');
  });

  test('URL parse: parts and decoded parameters, each copies on click', async ({ page }) => {
    await open(page, 'URL 解析');
    await input(page).fill('https://example.com:8443/p%20q?a=1&b=%E4%B8%AD#h');
    await expect(kv(page, '端口').locator('.v')).toHaveText('8443');
    await expect(kv(page, '路径（解码后）').locator('.v')).toHaveText('/p q');
    await page.locator('.urlp-params .kv', { hasText: 'b' }).click();
    await expect.poll(() => clipboard(page)).toBe('中');
    await input(page).fill('example.com/x');
    await expect(notes(page)).toContainText('没有写协议，已按 https:// 解析');
    await input(page).fill('hello world');
    await expect(errBox(page)).toContainText('无法识别为链接');
  });

  test('Colour: every format, the picker, and contrast checks', async ({ page }) => {
    await open(page, '颜色转换');
    await input(page).fill('#3d6df2');
    await expect(kv(page, 'RGB').locator('.v')).toHaveText('rgb(61 109 242)');
    await page.locator('input[type=color]').first().fill('#ff0000');
    await expect(input(page)).toHaveValue('#ff0000');
    await expect(kv(page, 'HSL').locator('.v')).toHaveText('hsl(0 100% 50%)');
    await input(page).fill('oklch(70% 0.4 150)');
    await expect(notes(page)).toContainText('超出 sRGB 能显示的范围');
    await page.getByRole('textbox', { name: '前景（文字）', exact: true }).fill('#777777');
    await page.getByRole('textbox', { name: '背景', exact: true }).fill('#ffffff');
    // 4.478 : 1 is shown as 4.47 — never rounded up past a threshold.
    await expect(page.locator('.contrast-out .out-status')).toHaveText('对比度 · 4.47 : 1');
    await expect(page.locator('.contrast-row', { hasText: 'AA 正文（≥ 4.5）' })).toContainText('✗ 不通过');
    await expect(page.locator('.contrast-row', { hasText: 'AA 大号文字（≥ 3）' })).toContainText('✓ 通过');
    await input(page).fill('notacolor');
    await expect(errBox(page)).toContainText('无法识别为颜色');
  });
});

test.describe('formatting', () => {
  test('YAML: re-indented; numbers and comments exactly as written; errors located', async ({ page }) => {
    await open(page, 'YAML 格式化');
    await input(page).fill('a:\n    b: 0x1F   # note\n    c: 0.10000000000000000555\n');
    await expect(out(page)).toHaveText('a:\n  b: 0x1F # note\n  c: 0.10000000000000000555\n');
    await expect(outStatus(page)).toHaveText('有效 YAML · 1 个文档');
    await input(page).fill('a: 1\na: 2\n');
    await expect(outStatus(page)).toHaveText('第 2 行，第 1 列');
  });

  test('XML: element-only content indented, text kept; errors named', async ({ page }) => {
    await open(page, 'XML 格式化');
    await input(page).fill('<a><b>t  u</b><c/></a>');
    await expect(out(page)).toHaveText('<a>\n  <b>t  u</b>\n  <c/>\n</a>\n');
    await input(page).fill('<a><b></a>');
    await expect(errBox(page)).toContainText('结束标签与开始标签 <b> 不匹配');
  });

  test('SQL: dialects and keyword case; strings untouched', async ({ page }) => {
    await open(page, 'SQL 格式化');
    await input(page).fill("select a from t where s = 'x  y' and n=-1");
    await expect(out(page)).toContainText("'x  y'");
    await expect(out(page)).toContainText('SELECT\n  a\nFROM');
    await seg(page, '保持').click();
    await expect(out(page)).toContainText('select\n  a\nfrom');
    await page.getByRole('combobox', { name: '方言' }).selectOption('postgresql');
    await input(page).fill("select E'a\\'b'");
    await expect(out(page)).toContainText("E'a\\'b'");
  });

  test('XML and SQL can be minified', async ({ page }) => {
    await open(page, 'XML 格式化');
    await input(page).fill('<a>\n  <b x="1">t</b>\n  <c/>\n</a>');
    await seg(page, '压缩').click();
    await expect(out(page)).toHaveText('<a><b x="1">t</b><c/></a>');
    await nav(page, 'SQL 格式化');
    await input(page).fill("select a,\n  count ( * )\nfrom t -- c\nwhere s = 'x  y'");
    await seg(page, '压缩').click();
    await expect(out(page)).toHaveText("SELECT a, count(*) FROM t -- c\nWHERE s = 'x  y'");
  });

  test('formatted results are in syntax colours; a click still copies the plain text', async ({ page }) => {
    await open(page, 'SQL 格式化');
    await input(page).fill("select count(*) from t where s = 'x' -- c");
    await expect(out(page).locator('.hl-kw').first()).toHaveText('SELECT');
    await expect(out(page).locator('.hl-fn')).toHaveText('count');
    await expect(out(page).locator('.hl-str')).toHaveText("'x'");
    await expect(out(page).locator('.hl-com')).toHaveText('-- c');
    const shown = (await out(page).textContent())!;
    expect(shown).toContain("WHERE\n  s = 'x' -- c");
    await out(page).click();
    await expect.poll(() => clipboard(page)).toBe(shown);
    for (const [tool, text, cls, word] of [['YAML 格式化', 'a: 1', 'hl-key', 'a'], ['XML 格式化', '<a x="1"/>', 'hl-tag', 'a']]) {
      await nav(page, tool);
      await input(page).fill(text);
      await expect(out(page).locator('.' + cls).first(), tool).toHaveText(word);
    }
    // JSON's text view and a JWT's parts too.
    await nav(page, 'JSON 格式化');
    await input(page).fill('{"k": [1, true]}');
    await page.getByRole('button', { name: '文本', exact: true }).click();
    await expect(page.locator('.hl-key').first()).toHaveText('"k"');
    await nav(page, 'JWT 解码');
    await input(page).fill('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2ln');
    await expect(page.locator('.jwt-part .hl-key').first()).toHaveText('"sub"');
  });

  test('JSON Schema: problems with paths; the box with a syntax error is named', async ({ page }) => {
    await open(page, 'JSON Schema 校验');
    await input(page).fill('{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}},"additionalProperties":false}');
    await page.locator('textarea').nth(1).fill('{"id":1}');
    await expect(page.locator('.schema-out .out-status')).toHaveText('✓ 通过校验');
    await page.locator('textarea').nth(1).fill('{"id":"x","y":1}');
    await expect(page.locator('.schema-out .out-status')).toHaveText('✗ 2 处不符合');
    await expect(page.locator('.schema-issues')).toContainText('$.id');
    await page.locator('textarea').nth(1).fill('{"id":');
    await expect(page.locator('.schema-out .out-status')).toContainText('数据 · 第 1 行');
  });
});

test.describe('text', () => {
  test('Text diff: changed characters marked; pastes fill A, then B', async ({ page }) => {
    await open(page, '文本对比');
    await pasteOnBlank(page, { text: 'one\ntwo\nthree' });
    await pasteOnBlank(page, { text: 'one\n2wo\nthree\nfour' });
    await expect(page.locator('textarea').nth(0)).toHaveValue('one\ntwo\nthree');
    await expect(page.locator('textarea').nth(1)).toHaveValue('one\n2wo\nthree\nfour');
    await expect(page.locator('.tdiff-out .out-status')).toHaveText('− 1 行  + 2 行');
    await expect(page.locator('.td-row.add .ch').first()).toHaveText('2');
    await flag(page, '仅显示差异').click();
    await page.locator('.tdiff-out .copy-block').click();
    await expect.poll(() => clipboard(page)).toBe('  one\n- two\n+ 2wo\n  three\n+ four');
  });

  test('Regex: matches, named groups, replacement; a pasted /literal/ sets the flags; runaway patterns stop', async ({ page }) => {
    await open(page, '正则表达式测试');
    await input(page).fill('(\\d+)-(?<b>\\d+)');
    await page.locator('textarea').first().fill('1-2 x 33-44');
    await expect(page.locator('.re-out .out-status')).toHaveText('2 处匹配');
    await expect(kv(page, '分组 b')).toContainText('2');
    await page.getByRole('textbox', { name: '替换为' }).fill('$<b>:$1');
    await expect(page.locator('.re-replaced .tool-out')).toHaveText('2:1 x 44:33');
    await page.getByRole('button', { name: '清空' }).first().click();
    await pasteInto(page, input(page), '/X/i');
    await expect(input(page)).toHaveValue('X');
    await expect(flag(page, 'i · 忽略大小写')).toHaveClass(/on/);
    await input(page).fill('(a+)+$');
    await page.locator('textarea').first().fill('a'.repeat(40) + '!');
    await expect(errBox(page)).toContainText('超过 1.5 秒未完成', { timeout: 10_000 });
  });

  test('case names, counts and line processing', async ({ page }) => {
    await open(page, '命名转换');
    await input(page).fill('XMLHttpRequest');
    await expect(kv(page, 'snake_case').locator('.v')).toHaveText('xml_http_request');
    await kv(page, 'camelCase').click();
    await expect.poll(() => clipboard(page)).toBe('xmlHttpRequest');
    await nav(page, '字数统计');
    await input(page).fill('👨‍👩‍👧 ab\n\n中文');
    await expect(kv(page, '字符（按显示）').locator('.v')).toHaveText('8');
    await expect(kv(page, 'UTF-8 字节').locator('.v')).toHaveText(String(Buffer.byteLength('👨‍👩‍👧 ab\n\n中文')));
    await nav(page, '文本处理');
    await input(page).fill(' b\na\n\nb \nA');
    await flag(page, '去重').click();
    await seg(page, '升序').click();
    await expect(out(page)).toHaveText('a\nA\nb');
    await expect(notes(page)).toContainText('去掉 1 行重复');
  });
});

test.describe('generators and time', () => {
  test('UUID: a v7 batch sorts as strings; any UUID is inspected', async ({ page }) => {
    await open(page, 'UUID');
    await seg(page, 'v7').click();
    await page.getByRole('spinbutton', { name: '数量' }).fill('50');
    const list = (await out(page).textContent())!.split('\n');
    expect(list).toHaveLength(50);
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(50);
    await page.getByRole('textbox', { name: '解析' }).fill(list[0]);
    await expect(kv(page, '版本').locator('.v')).toHaveText('v7 · Unix 时间（可排序）');
    await page.getByRole('textbox', { name: '解析' }).fill('{C232AB00-9414-11EC-B3C8-9F6BDECED846}');
    await expect(kv(page, '节点（MAC）').locator('.v')).toHaveText('9f:6b:de:ce:d8:46');
    await expect(kv(page, '时间').locator('.v')).toContainText('2022-02-23 03:22:22');
  });

  test('Cron: description and the next runs in the chosen zone; errors name the field', async ({ page }) => {
    await open(page, 'Cron 表达式');
    await input(page).fill('30 9 * * 1-5');
    await expect(page.locator('.cron-desc')).toHaveText('每个工作日（周一至周五） 09:30');
    await expect(page.locator('.cron-runs .kv')).toHaveCount(10);
    await expect(page.locator('.cron-runs .kv').first()).toContainText('09:30:00');
    await expect(page.locator('.cron-runs .kv').first()).toContainText('UTC+08:00');
    await input(page).fill('0 0 1 * 1');
    await expect(notes(page)).toContainText('满足其中一个就执行');
    await input(page).fill('61 * * * *');
    await expect(errBox(page)).toContainText('第 1 个字段（分）的「61」超出范围');
    await expect(page.locator('mark.err-at')).toHaveText('6');
    await seg(page, 'Quartz').click();
    await input(page).fill('0 0 12 * * *');
    await expect(errBox(page)).toContainText('Quartz 要求「日」和「星期」中有一个写成「?」');
  });

  test('Cron visual editor: clicks write the expression; a typed expression shows in the editor', async ({ page }) => {
    await open(page, 'Cron 表达式');
    const radio = (name: string) => page.getByRole('radio', { name, exact: true });
    const chip = (group: string, name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });
    await radio('每周').click();
    await expect(input(page)).toHaveValue('0 9 * * 1');
    await page.getByRole('button', { name: '工作日' }).click();
    await page.locator('input[type=time]').fill('18:30');
    await expect(input(page)).toHaveValue('30 18 * * 1-5');
    await expect(page.locator('.cron-desc')).toHaveText('每个工作日（周一至周五） 18:30');
    await chip('星期', '三').click();
    await expect(input(page)).toHaveValue('30 18 * * 1,2,4,5');
    // Switching keeps the time.
    await radio('每天').click();
    await expect(input(page)).toHaveValue('30 18 * * *');
    await radio('每隔几分钟').click();
    await page.getByRole('combobox', { name: '分钟' }).selectOption('15');
    await expect(input(page)).toHaveValue('*/15 * * * *');
    // Typed: the editor follows.
    await input(page).fill('0 9 1,15 * *');
    await expect(radio('每月')).toHaveAttribute('aria-checked', 'true');
    await expect(chip('日期', '15')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '最后一天' })).toBeDisabled();
    // Quartz: "?" and Sunday = 1; the last day of the month is offered.
    await seg(page, 'Quartz').click();
    await input(page).fill('');
    await radio('每周').click();
    await expect(input(page)).toHaveValue('0 0 9 ? * 2');
    await radio('每月').click();
    await page.getByRole('button', { name: '最后一天' }).click();
    await expect(input(page)).toHaveValue('0 0 9 L * ?');
    // Advanced: any field on its own.
    await radio('高级').click();
    const hour = page.locator('.cron-field', { has: page.locator('.cron-row-label', { hasText: /^时$/ }) });
    await hour.locator('.seg button', { hasText: '范围' }).click();
    await hour.getByRole('combobox', { name: '到' }).selectOption('17');
    await expect(input(page)).toHaveValue('0 0 9-17 L * ?');
    await input(page).fill('* * *');
    await expect(page.locator('.cron-builder')).toContainText('字段数和所选规则不一致');
  });

  test('Timestamp: a ULID or a Snowflake ID gives its time', async ({ page }) => {
    await open(page);
    await input(page).fill('01ARYZ6S41TSV4RRFFQ69G5FAV');
    await expect(page.locator('.hero').first()).toContainText('识别为 ULID');
    await expect(page.locator('.hero').first()).toContainText('2016-07-31 06:36:16');
    const id = 1541815603606036480n;
    const ms = Number(id >> 22n) + 1288834974657;
    const wall = new Date(ms + 8 * 3600e3).toISOString().replace('T', ' ').replace('Z', '');
    await input(page).fill(String(id));
    await expect(page.locator('.snowflake')).toContainText(wall);
  });
});

test.describe('pasting and dropping', () => {
  const cases: [string, string, string][] = [
    [jwt('{"a":1}', 'k'), 'JWT 解码', 'jwtIn'],
    ['550e8400-e29b-41d4-a716-446655440000', 'UUID', 'uuidIn'],
    ['#ff8800', '颜色转换', 'colorIn'],
    ['*/5 * * * *', 'Cron 表达式', 'cronIn'],
    ['<a><b/></a>', 'XML 格式化', 'xmlIn'],
    ['SELECT * FROM t', 'SQL 格式化', 'sqlIn'],
    ['a: 1\nb: [2]', 'YAML 格式化', 'yamlIn'],
    ['%E4%B8%AD%E6%96%87', 'URL 编解码', 'urlIn'],
    ['\\u4e2d\\u6587', 'Unicode 转义', 'uniIn'],
    ['&lt;p&gt;', 'HTML 实体', 'htmlIn'],
    ['01ARYZ6S41TSV4RRFFQ69G5FAV', '时间戳转换', 'tsIn'],
  ];
  for (const [text, tool, key] of cases) {
    test(`pasted on a blank area: ${JSON.stringify(text.slice(0, 24))} opens ${tool}`, async ({ page }) => {
      await open(page);
      await pasteOnBlank(page, { text });
      await expect.poll(() => activeTool(page)).toContain(tool);
      expect(await page.evaluate((k) => new Promise((r) => setTimeout(() => r(JSON.parse(localStorage.getItem('tb.in.' + k) ?? 'null')), 600)), key)).toBe(text);
    });
  }

  test('escaped text is opened decoded', async ({ page }) => {
    await open(page);
    await pasteOnBlank(page, { text: '%E4%B8%AD%E6%96%87' });
    await expect(out(page)).toHaveText('中文');
  });

  test('a link still makes a QR code', async ({ page }) => {
    await open(page);
    await pasteOnBlank(page, { text: 'https://example.com/a%20b' });
    await expect.poll(() => activeTool(page)).toContain('生成二维码');
  });

  test('a tool for one kind of value keeps only that kind; text tools keep any text', async ({ page }) => {
    await open(page, 'Cron 表达式');
    await pasteOnBlank(page, { text: '0 0 * * *' });
    await expect(input(page)).toHaveValue('0 0 * * *');
    await pasteOnBlank(page, { text: '{"a":1}' });
    await expect.poll(() => activeTool(page)).toContain('JSON 格式化');
    await nav(page, '字数统计');
    await pasteOnBlank(page, { text: '{"a":1}' });
    await expect(input(page)).toHaveValue('{"a":1}');
    await expect.poll(() => activeTool(page)).toContain('字数统计');
  });

  test('two text files dropped on the text diff fill A and B', async ({ page }) => {
    await open(page, '文本对比');
    await drop(page, [{ name: 'a.txt', bytes: 'x\ny' }, { name: 'b.log', bytes: 'x\nz' }]);
    await expect(page.locator('textarea').nth(0)).toHaveValue('x\ny');
    await expect(page.locator('textarea').nth(1)).toHaveValue('x\nz');
  });

  test('a dropped .yaml / .sql opens its formatter', async ({ page }) => {
    await open(page);
    await drop(page, [{ name: 'c.yaml', bytes: 'k:   v\n' }]);
    await expect.poll(() => activeTool(page)).toContain('YAML 格式化');
    await expect(out(page)).toHaveText('k: v\n');
    await drop(page, [{ name: 'q.sql', bytes: 'select 1' }]);
    await expect.poll(() => activeTool(page)).toContain('SQL 格式化');
  });
});

test.describe('large and unusual input', () => {
  test('nesting too deep, a dangling YAML alias, a schema that refers to itself: each is explained', async ({ page }) => {
    await open(page, 'XML 格式化');
    await setValue(input(page), '<a>'.repeat(20000) + '</a>'.repeat(20000));
    await expect(errBox(page)).toContainText('嵌套层级太深', { timeout: 15000 });
    await nav(page, 'YAML 格式化');
    await input(page).fill('*.log');
    await expect(errBox(page)).toContainText('Unresolved alias');
    await nav(page, 'JSON Schema 校验');
    await input(page).fill('{"$ref":"#"}');
    await page.locator('textarea').nth(1).fill('1');
    await expect(page.locator('.schema-out')).toContainText('绕回了自己');
  });

  test('a regex the engine gives up on is explained, not left "processing"', async ({ page }) => {
    await open(page, '正则表达式测试');
    await input(page).fill('(a|b)*c');
    await setValue(page.locator('textarea').first(), 'ab'.repeat(3e6));
    await expect(errBox(page)).toContainText('回溯太深', { timeout: 15000 });
  });

  test('very large results are shown in part; a click still copies all of it', async ({ page }) => {
    await open(page, 'Hex 编解码');
    await drop(page, [{ name: 'x.bin', bytes: Array.from({ length: 70000 }, (_, i) => i & 255) }]);
    await expect(page.locator('.shown-first')).toContainText('仅显示前 200,000 个字符');
    await out(page).click();
    await expect.poll(async () => (await clipboard(page)).length).toBe(70000 * 3 - 1);
  });

  test('Cron: a "*/2" day with a weekday says which rule it follows', async ({ page }) => {
    await open(page, 'Cron 表达式');
    await input(page).fill('0 0 */2 * 1');
    await expect(notes(page)).toContainText('Vixie cron');
    await expect(page.locator('.cron-desc')).toContainText('且是周一');
  });

  test('a sentence that starts with an SQL word is not sent to the SQL formatter', async ({ page }) => {
    await open(page);
    await pasteOnBlank(page, { text: 'Select the file from the list' });
    await expect.poll(() => activeTool(page)).toContain('生成二维码');
  });
});
