// App shell: navigation, sidebar, search palette, themes, languages, layout, offline.
import { activeTool, expect, nav, open, test } from './helpers';

const TOOLS = ['时间戳转换', '生成二维码', '识别二维码', 'JSON 格式化', 'TOML 格式化', 'JSON 对比', 'Base64 编解码', '哈希'];

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
  await page.locator('.seg button', { hasText: 'EN' }).click();
  await expect(page.locator('.nav-item.on')).toContainText('Timestamp');
  await page.locator('.seg button', { hasText: 'Dark' }).click();
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
  await expect(page.locator('.list-item')).toHaveCount(2);
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

test('no request leaves the page (works offline)', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', (r) => {
    if (new URL(r.request().url()).hostname !== 'localhost') { external.push(r.request().url()); return r.abort(); }
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
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      const count = width < 800 ? await page.locator('.chip').count() : await page.locator('.nav-item').count();
      expect(count).toBe(8);
      for (let i = 0; i < count; i++) {
        await (width < 800 ? page.locator('.chip').nth(i) : page.locator('.nav-item').nth(i)).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      }
    });
    test('a long message stays fully on screen', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await (width < 800 ? page.locator('.chip').nth(3) : page.locator('.nav-item').nth(3)).click();
      await page.locator('textarea[data-autofocus]').fill('{"a_very_long_key_name_that_goes_on_and_on":{"another_long_key_for_the_path":[1,null]}}');
      await page.locator('button', { hasText: /转为 TOML|To TOML/ }).click();
      const box = (await page.locator('.toast').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  });
}
