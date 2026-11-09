// App shell: navigation, sidebar, search palette, themes, languages, layout, offline.
import { HOME, OWN_HOST, activeTool, expect, nav, open, test } from './helpers';

const TOOLS = ['时间戳转换', 'Cron 表达式', '生成二维码', '识别二维码', 'JSON 格式化', 'TOML 格式化', 'YAML 格式化', 'XML 格式化', 'SQL 格式化', 'JSON Schema 校验',
  'JSON 对比', '文本对比', 'Base64 编解码', '哈希', 'URL 编解码', 'Unicode 转义', 'HTML 实体', 'Hex 编解码', '进制转换', 'Gzip 压缩解压', '转义 / 还原',
  'URL 解析', 'JWT 解码', '颜色转换', '正则表达式', '命名转换', '字数统计', '文本处理', 'UUID', '大模型对话测试', '添加插件'];

test('every tool opens; the page has no title / breadcrumb / smart-paste card', async ({ page }) => {
  await open(page);
  for (const t of TOOLS) {
    await nav(page, t);
    await expect.poll(() => activeTool(page)).toContain(t);
  }
  await expect(page.locator('h1')).toHaveCount(0);
  await expect(page.getByText('智能粘贴')).toHaveCount(0);
});

test('sidebar collapses with the button and Ctrl+B, and remembers it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.locator('.side')).toHaveCSS('width', '64px');
  await page.keyboard.press('Control+b');
  await expect(page.locator('.side')).toHaveCSS('width', '232px');
  await page.keyboard.press('Control+b');
  await page.reload();
  await expect(page.locator('.side')).toHaveCSS('width', '64px');
});

test('language and theme switch, and are remembered', async ({ page }) => {
  await open(page);
  await page.locator('.side-link').click();
  await page.locator('.settings .seg button', { hasText: 'English' }).click();
  await expect(page.locator('.side-link')).toContainText('Settings');
  await page.locator('.settings .seg button', { hasText: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('.nav-item.on')).toContainText('Timestamp');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('palette: Ctrl+K, "/", search by pinyin initials, Enter opens, Esc closes', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('搜索工具，或直接粘贴内容…');
  await input.fill('gsh');
  await expect(page.locator('.list-item').first()).toContainText('JSON 格式化');
  await input.press('Enter');
  await expect.poll(() => activeTool(page)).toContain('JSON 格式化');
  await page.locator('.content').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('/');
  await expect(input).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
});

for (const [q, tool] of [['md5', '哈希'], ['sha256', '哈希'], ['hx', '哈希'], ['base64', 'Base64 编解码'], ['jm', 'Base64 编解码']] as const) {
  test(`palette: "${q}" finds ${tool}`, async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('搜索工具，或直接粘贴内容…').fill(q);
    await expect(page.locator('.list-item').first()).toContainText(tool);
    await page.keyboard.press('Enter');
    await expect.poll(() => activeTool(page)).toContain(tool);
  });
}

test('palette: content typed into it is offered to the matching tool', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('搜索工具，或直接粘贴内容…').fill('{"a":1}');
  await expect(page.locator('.list-item').first()).toContainText('用「JSON 格式化」处理输入的内容');
});

test('IME: Enter / Escape that end a pinyin composition are not shortcuts', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('搜索工具，或直接粘贴内容…');
  await input.fill('json');
  for (const key of ['Enter', 'Escape', 'ArrowDown']) {
    await input.evaluate((el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, isComposing: true, keyCode: 229, bubbles: true })), key);
  }
  await expect(input).toBeVisible();
  await expect.poll(() => activeTool(page)).toContain('时间戳转换');
});

test('after switching tools the main input gets focus, but never steals it from another field', async ({ page }) => {
  await open(page);
  await nav(page, 'JSON 格式化');
  await expect(page.locator('textarea[data-autofocus]')).toBeFocused();
  // Click the B side right after switching: the delayed autofocus must leave it there.
  await page.locator('.nav-item', { hasText: 'JSON 对比' }).evaluate((b) => {
    (b as HTMLElement).click();
    requestAnimationFrame(() => document.querySelectorAll('textarea')[1].focus());
  });
  await page.waitForTimeout(200);
  await page.keyboard.insertText('MARK-7Q');
  await expect(page.locator('textarea').nth(1)).toBeFocused();
  await expect(page.locator('textarea').nth(1)).toHaveValue(/MARK-7Q/);
  await expect(page.locator('textarea').nth(0)).not.toHaveValue(/MARK-7Q/);
});

test('a button in the tool chosen right after switching keeps the focus: a key pressed on it works there', async ({ page }) => {
  await open(page);
  await nav(page, 'JSON 格式化');
  // Switch, and go to the result's handle before the delayed autofocus runs.
  await page.locator('.nav-item', { hasText: 'YAML 格式化' }).evaluate((b) => {
    (b as HTMLElement).click();
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.split-grip')!.focus());
  });
  await page.waitForTimeout(200);
  await expect(page.locator('.split-grip')).toBeFocused();
  const before = await page.locator('.split').getAttribute('data-layout');
  await page.keyboard.press('Enter');
  await expect(page.locator('.split')).not.toHaveAttribute('data-layout', before!);
});

test('the app mark replaces "TB" everywhere; the tab icon and touch icon load', async ({ page }) => {
  await open(page);
  await expect(page.locator('.logo svg')).toHaveCount(1);
  await expect(page.locator('.logo', { hasText: 'TB' })).toHaveCount(0);
  for (const sel of ['link[rel=icon]', 'link[rel=apple-touch-icon]']) {
    const href = (await page.locator(sel).getAttribute('href'))!;
    // Fetched by the page itself: from wherever it is served (the desktop app's own origin too).
    const r = await page.evaluate((h) => fetch(h).then((r) => ({ status: r.status, type: r.headers.get('content-type') ?? '' })), href);
    expect(r.status, sel).toBe(200);
    expect(r.type, sel).toMatch(sel.includes('apple') ? /image\/png/ : /image\/svg\+xml/);
  }
  await page.getByRole('button', { name: '收起侧栏' }).click();
  const rail = page.getByRole('button', { name: '展开侧栏' }).first();
  await expect(rail.locator('svg')).toHaveCount(1);
  await rail.click();
  await expect(page.locator('.side')).toHaveCSS('width', '232px');
});

test('settings: language, appearance and text size on a page of their own, opened from the bottom of the sidebar', async ({ page }) => {
  await open(page, 'JSON 格式化');
  const entry = page.locator('.side-link');
  // The sidebar's bottom holds only the entry: shown whole, in both languages.
  const fits = async () => {
    const [b, side] = [(await entry.boundingBox())!, (await page.locator('.side').boundingBox())!];
    expect(b.x + b.width).toBeLessThanOrEqual(side.x + side.width);
    expect(b.y + b.height).toBeLessThanOrEqual(side.y + side.height);
  };
  await fits();
  await entry.click();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.nav-item.on')).toHaveCount(0);
  const card = page.locator('.settings');
  await expect(card.locator('.card-head')).toHaveText('设置');
  await card.getByRole('button', { name: 'English' }).click();
  await expect(card.locator('.card-head')).toHaveText('Settings');
  await expect(entry).toHaveText('Settings');
  await fits();
  // Every choice is shown whole, in English too.
  for (const b of await card.locator('.seg button').all()) {
    expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await card.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await card.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await card.getByRole('button', { name: '中文' }).click();
  // Kept after a reload; the page itself is not (the tool is shown again).
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.settings')).toHaveCount(0);
  await expect(page.locator('.nav-item.on')).toHaveText(/JSON 格式化/);
  // A tool chosen leaves the page; a second click on the entry does too.
  await entry.click();
  await nav(page, '时间戳转换');
  await expect(page.locator('.settings')).toHaveCount(0);
  await expect(page.locator('.nav-item.on')).toHaveText(/时间戳转换/);
  await entry.click();
  await entry.click();
  await expect(page.locator('.settings')).toHaveCount(0);
  // The collapsed sidebar has it too.
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('.settings')).toBeVisible();
});

test('no request leaves the page (works offline)', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', (r) => {
    if (new URL(r.request().url()).hostname !== OWN_HOST) { external.push(r.request().url()); return r.abort(); }
    return r.continue();
  });
  await open(page);
  for (const t of TOOLS) await nav(page, t);
  expect(external).toEqual([]);
});

test('icon-only buttons have accessible names', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: '收起侧栏' })).toBeVisible();
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.getByRole('button', { name: '展开侧栏' }).first()).toBeVisible();
});

for (const [width, locale, scheme] of [[320, 'zh-CN', 'dark'], [390, 'en-US', 'light'], [1280, 'en-US', 'dark']] as const) {
  test.describe(`${width}px ${locale} ${scheme}`, () => {
    test.use({ viewport: { width, height: 800 }, locale, colorScheme: scheme, hasTouch: width < 800, isMobile: width < 800 });
    test('every tool fits the width', async ({ page }) => {
      await page.goto(HOME);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      const count = width < 800 ? await page.locator('.chip').count() : await page.locator('.nav-item').count();
      expect(count).toBe(TOOLS.length);
      for (let i = 0; i < count; i++) {
        await (width < 800 ? page.locator('.chip').nth(i) : page.locator('.nav-item').nth(i)).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      }
    });
    test('a long message stays fully on screen', async ({ page }) => {
      await page.goto(HOME);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      if (width < 800) await page.locator('.chip').filter({ hasText: /^JSON$/ }).click();
      else await nav(page, 'JSON Formatter');
      await page.locator('textarea[data-autofocus]').fill('{"a_very_long_key_name_that_goes_on_and_on":{"another_long_key_for_the_path":[1,null]}}');
      await page.locator('button', { hasText: /转为 TOML|To TOML/ }).click();
      const box = (await page.locator('.toast').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  });
}
