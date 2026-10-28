// Input and result: side by side or stacked, resizable, remembered per tool.
import type { Page } from '@playwright/test';
import { expect, nav, open, test } from './helpers';

const layout = (page: Page) => page.locator('.split').getAttribute('data-layout');
const panes = (page: Page) => page.locator('.split-pane');
const box = async (page: Page, i: number) => (await panes(page).nth(i).boundingBox())!;

async function dragBy(page: Page, sel: string, dx: number, dy: number) {
  const b = (await page.locator(sel).boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test('the result is dragged below: both panes take the full width; each tool remembers its own layout', async ({ page }) => {
  await open(page, 'URL 编解码');
  expect(await layout(page)).toBe('row');
  const content = (await page.locator('.content').boundingBox())!;
  await dragBy(page, '.split-grip', 0, 260);
  expect(await layout(page)).toBe('col');
  // After it settles (a short animation), it fills its slot.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  expect(Math.round((await page.locator('.split-float').boundingBox())!.width)).toBe(Math.round((await box(page, 1)).width));
  const a = await box(page, 0), b = await box(page, 1);
  expect(b.y).toBeGreaterThan(a.y + a.height);
  // Stacked panes span the content width (its padding stays as the margin).
  expect(Math.abs(a.width - b.width)).toBeLessThan(1);
  expect(a.width).toBeGreaterThan(content.width - 80);
  await page.reload();
  expect(await layout(page)).toBe('col');
  await nav(page, 'Hex 编解码');
  expect(await layout(page)).toBe('row');
  await nav(page, 'URL 编解码');
  // Carried back up level with the input, on the right; while carried it follows the pointer.
  const g = (await page.locator('.split-grip').boundingBox())!;
  const top = (await box(page, 0)).y;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + 200, top + 20, { steps: 10 });
  expect(await layout(page)).toBe('row');
  const carried = (await page.locator('.split-float').boundingBox())!;
  expect(Math.abs(carried.y - (top + 20 - g.height / 2 + 9 - 8))).toBeLessThan(12);
  await expect(page.locator('.split-pane.holding')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.split-pane.holding')).toHaveCount(0);
  expect(await layout(page)).toBe('row');
});

test('a click on the handle switches; so does Enter on it', async ({ page }) => {
  await open(page, 'YAML 格式化');
  await page.locator('.split-grip').click();
  expect(await layout(page)).toBe('col');
  await page.locator('.split-grip').focus();
  await page.keyboard.press('Enter');
  expect(await layout(page)).toBe('row');
});

test('the gap is dragged to share the width, remembered; a double-click shares it equally', async ({ page }) => {
  await open(page, 'SQL 格式化');
  const before = (await box(page, 0)).width;
  await dragBy(page, '.split-gutter', 180, 0);
  const wider = (await box(page, 0)).width;
  expect(wider).toBeGreaterThan(before + 150);
  await page.reload();
  expect(Math.abs((await box(page, 0)).width - wider)).toBeLessThan(2);
  // Never narrower than 280 px.
  await dragBy(page, '.split-gutter', 2000, 0);
  expect((await box(page, 1)).width).toBeGreaterThanOrEqual(279);
  await page.locator('.split-gutter').dblclick();
  expect(Math.abs((await box(page, 0)).width - (await box(page, 1)).width)).toBeLessThan(2);
});

test('a drag the system cancels lets go cleanly: the layout comes back, nothing keeps following the pointer', async ({ page }) => {
  await open(page, 'URL 编解码');
  const cancel = () => page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
  // Carrying the result below, then cancelled: side by side again.
  const g = (await page.locator('.split-grip').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + 300, { steps: 8 });
  expect(await layout(page)).toBe('col');
  await cancel();
  expect(await layout(page)).toBe('row');
  await expect(page.locator('.split-pane.holding')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.className)).not.toContain('dragging');
  await page.mouse.move(g.x, g.y + 400, { steps: 4 });
  await page.mouse.up();
  expect(await layout(page)).toBe('row');
  // The panes slide back (a short animation); measure widths once they are still.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  // Sharing the width, then cancelled: later moves don't resize.
  const gut = (await page.locator('.split-gutter').boundingBox())!;
  await page.mouse.move(gut.x + gut.width / 2, gut.y + gut.height / 2);
  await page.mouse.down();
  await page.mouse.move(gut.x + 100, gut.y + gut.height / 2, { steps: 4 });
  await cancel();
  const w = (await box(page, 0)).width;
  await page.mouse.move(gut.x + 300, gut.y + gut.height / 2, { steps: 4 });
  expect(Math.abs((await box(page, 0)).width - w)).toBeLessThan(1);
  expect(await page.evaluate(() => document.body.className)).not.toContain('dragging');
  await page.mouse.up();
});

test('the older tools have it too: Base64, hash, JSON, QR code', async ({ page }) => {
  await open(page);
  for (const t of ['Base64 编解码', '哈希', 'JSON 格式化', '生成二维码']) {
    await nav(page, t);
    await page.locator('.split-grip').click();
    expect(await layout(page), t).toBe('col');
  }
});

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  test('always stacked, with no handles', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { localStorage.setItem('tb.tool', '"url"'); localStorage.setItem('tb.prefs', JSON.stringify({ o: { 'lay.url': 'row' } })); });
    await page.reload();
    expect(await layout(page)).toBe('col');
    await expect(page.locator('.split-grip')).toHaveCount(0);
    await expect(page.locator('.split-gutter')).toHaveCount(0);
  });
});

test('text size: the tool area scales as a whole, the sidebar stays; remembered; dragging still follows the pointer', async ({ page }) => {
  await open(page, 'URL 编解码');
  const headH = () => page.evaluate(() => document.querySelector('.card-head span')!.getBoundingClientRect().height);
  const navH = () => page.evaluate(() => document.querySelector('.nav-item')!.getBoundingClientRect().height);
  const [h0, n0] = [await headH(), await navH()];
  await page.getByRole('button', { name: '放大右侧内容' }).click();
  await page.getByRole('button', { name: '放大右侧内容' }).click();
  await expect(page.locator('.zoom-btn.pct')).toHaveText('125%');
  expect((await headH()) / h0).toBeCloseTo(1.25, 1);
  expect(await navH()).toBe(n0);
  await page.reload();
  await expect(page.locator('.zoom-btn.pct')).toHaveText('125%');
  // Carried at 125 %: the result's handle stays under the pointer.
  const g = (await page.locator('.split-grip').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - 40, g.y + g.height / 2 + 50, { steps: 8 });
  const f = (await page.locator('.split-grip').boundingBox())!;
  expect(Math.abs(f.x - (g.x - 40))).toBeLessThan(3);
  expect(Math.abs(f.y - (g.y + 50))).toBeLessThan(3);
  await page.mouse.move(g.x + g.width / 2 - 40, g.y + g.height / 2 + 260, { steps: 8 });
  const f2 = (await page.locator('.split-grip').boundingBox())!;
  expect(Math.abs(f2.y - (g.y + 260))).toBeLessThan(3);
  await page.mouse.up();
  expect(await layout(page)).toBe('col');
  // A click on the percentage goes back to 100 %, the smallest size: A− is disabled there.
  await page.locator('.zoom-btn.pct').click();
  expect(Math.abs((await headH()) - h0)).toBeLessThan(0.5);
  await expect(page.locator('.zoom-btn.pct')).toHaveText('100%');
  await expect(page.getByRole('button', { name: '缩小右侧内容' })).toBeDisabled();
  // A size below 100 % stored earlier is not used.
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('tb.prefs') || '{}'); p.o = { ...p.o, 'ui.zoom': 80 }; localStorage.setItem('tb.prefs', JSON.stringify(p)); });
  await page.reload();
  await expect(page.locator('.zoom-btn.pct')).toHaveText('100%');
  expect(Math.abs((await headH()) - h0)).toBeLessThan(0.5);
});

test.describe('a lower window', () => {
  test.use({ viewport: { width: 1440, height: 600 } });
  test('a short carry switches, a label says where it lands; dropped below, the result is in view', async ({ page }) => {
    await open(page, 'TOML 格式化');
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('tb.prefs') || '{}'); p.o = { ...p.o, 'ui.zoom': 140 }; localStorage.setItem('tb.prefs', JSON.stringify(p)); });
    await page.reload();
    await page.getByRole('button', { name: '示例' }).first().click();
    const hint = page.locator('.split-hint');
    const g = (await page.locator('.split-grip').boundingBox())!;
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 20, y + 90, { steps: 6 });
    expect(await layout(page)).toBe('col');
    await expect(hint).toHaveText('松开 · 放在下方');
    // Back up as far as it came down: beside again (measured from where it switched).
    await page.mouse.move(x - 20, y, { steps: 6 });
    expect(await layout(page)).toBe('row');
    await expect(hint).toHaveText('松开 · 放在右侧');
    await page.mouse.move(x - 20, y + 90, { steps: 6 });
    expect(await layout(page)).toBe('col');
    await page.mouse.up();
    await expect(hint).toHaveCount(0);
    // Stacked: the result's top is on screen, below a shorter input.
    await expect.poll(async () => { const b = await box(page, 1); return b.y > 0 && b.y < 300; }).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    expect((await box(page, 1)).y).toBeLessThan(page.viewportSize()!.height);
  });
});

test('the bar between stacked panes sets the input height: remembered per tool; never below 120 px; a double-click restores it', async ({ page }) => {
  await open(page, 'TOML 格式化');
  await page.locator('.split-grip').click();
  expect(await layout(page)).toBe('col');
  const h0 = (await box(page, 0)).height;
  // Grabbed beside the result's handle, which sits on the middle of the bar.
  const bar = async () => { const b = (await page.locator('.split-hgutter:not(.end)').boundingBox())!; return { x: b.x + 60, y: b.y + b.height / 2 }; };
  let p = await bar();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y + 140, { steps: 6 });
  await page.mouse.up();
  expect(await layout(page)).toBe('col');
  const h1 = (await box(page, 0)).height;
  expect(Math.abs(h1 - (h0 + 140))).toBeLessThan(2);
  await page.reload();
  expect(Math.abs((await box(page, 0)).height - h1)).toBeLessThan(2);
  await nav(page, 'YAML 格式化');
  await page.locator('.split-grip').click();
  expect(Math.abs((await box(page, 0)).height - h1)).toBeGreaterThan(20);
  await nav(page, 'TOML 格式化');
  p = await bar();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, 5, { steps: 8 });
  await page.mouse.up();
  expect(Math.abs((await box(page, 0)).height - 120)).toBeLessThan(2);
  await page.reload();
  expect(Math.abs((await box(page, 0)).height - 120)).toBeLessThan(2);
  p = await bar();
  await page.mouse.dblclick(p.x, p.y);
  expect(Math.abs((await box(page, 0)).height - h0)).toBeLessThan(2);
});

test('the bar below the result sets its height: its content fills it, remembered; a double-click restores it', async ({ page }) => {
  await open(page, 'TOML 格式化');
  await page.getByRole('button', { name: '示例' }).first().click();
  await page.locator('.split-grip').click();
  expect(await layout(page)).toBe('col');
  const h0 = (await box(page, 1)).height;
  const scroller = () => page.locator('.split-pane.result .pane-scroll').boundingBox().then((b) => b!.height);
  const bar = async () => {
    await page.locator('.split-hgutter.end').scrollIntoViewIfNeeded();
    const b = (await page.locator('.split-hgutter.end').boundingBox())!;
    return { x: b.x + 60, y: b.y + b.height / 2 };
  };
  // Taller than the content's usual cap: the scrolling area grows with it.
  const s0 = await scroller();
  let p = await bar();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y - 200, { steps: 6 });
  await page.mouse.up();
  const h1 = (await box(page, 1)).height;
  expect(Math.abs(h1 - (h0 - 200))).toBeLessThan(2);
  expect(await scroller()).toBeLessThan(s0 - 150);
  await page.reload();
  expect(Math.abs((await box(page, 1)).height - h1)).toBeLessThan(2);
  p = await bar();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y + 500, { steps: 6 });
  await page.mouse.up();
  expect(Math.abs((await box(page, 1)).height - (h1 + 500))).toBeLessThan(2);
  // The scrolling area takes all of it (the card's header stays the same).
  expect(Math.abs((await box(page, 1)).height - (await scroller()) - (h0 - s0))).toBeLessThan(2);
  p = await bar();
  await page.mouse.dblclick(p.x, p.y);
  expect(Math.abs((await box(page, 1)).height - h0)).toBeLessThan(2);
});

test('the carried result takes the width of the slot it would land in, and stays within the tool area', async ({ page }) => {
  await open(page, 'Base64 编解码');
  const content = (await page.locator('.split').boundingBox())!;
  const g = (await page.locator('.split-grip').boundingBox())!;
  const x = g.x + g.width / 2, y = g.y + g.height / 2;
  const sizes = async () => {
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const f = (await page.locator('.split-float').boundingBox())!, s = (await box(page, 1));
    return { f, s };
  };
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Below: as wide as the tool area, moving only up and down even when pulled sideways.
  await page.mouse.move(x + 150, y + 120, { steps: 8 });
  expect(await layout(page)).toBe('col');
  let { f, s } = await sizes();
  expect(Math.abs(f.width - s.width)).toBeLessThan(1);
  expect(Math.abs(f.height - s.height)).toBeLessThan(1);
  expect(Math.abs(f.x - content.x)).toBeLessThan(1);
  // Beside again: half the width, and pushed right it stops at the edge.
  await page.mouse.move(x + 400, y + 20, { steps: 8 });
  expect(await layout(page)).toBe('row');
  ({ f, s } = await sizes());
  expect(Math.abs(f.width - s.width)).toBeLessThan(1);
  expect(f.x + f.width).toBeLessThanOrEqual(content.x + content.width + 1);
  await page.mouse.up();
});

test('both layouts start at the same height; the carried result is the size of where it would land', async ({ page }) => {
  await open(page, 'Gzip 压缩解压');
  const [a0, b0] = [await box(page, 0), await box(page, 1)];
  expect(Math.abs(a0.height - b0.height)).toBeLessThan(1);
  const g = (await page.locator('.split-grip').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y + 120, { steps: 8 });
  expect(await layout(page)).toBe('col');
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const f = (await page.locator('.split-float').boundingBox())!, s = await box(page, 1);
  expect(Math.abs(f.height - s.height)).toBeLessThan(1);
  await page.mouse.up();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  // Stacked: the input keeps the height it had beside; the result below is as tall.
  const [a1, b1] = [await box(page, 0), await box(page, 1)];
  expect(Math.abs(a1.height - a0.height)).toBeLessThan(1);
  expect(Math.abs(b1.height - a1.height)).toBeLessThan(1);
});

test('side by side, the bar below sets the height of both: the content fills it, remembered; a double-click restores it; one height in both layouts', async ({ page }) => {
  await open(page, 'TOML 格式化');
  await page.getByRole('button', { name: '示例' }).first().click();
  const h0 = (await box(page, 0)).height;
  const scroller = () => page.locator('.split-pane.result .pane-scroll').boundingBox().then((b) => b!.height);
  const s0 = await scroller();
  const bar = async () => { const b = (await page.locator('.split-hgutter.end').boundingBox())!; return { x: b.x + 60, y: b.y + b.height / 2 }; };
  let p = await bar();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y - 200, { steps: 6 });
  await page.mouse.up();
  const [a, b] = [await box(page, 0), await box(page, 1)];
  expect(Math.abs(a.height - (h0 - 200))).toBeLessThan(2);
  expect(Math.abs(b.height - a.height)).toBeLessThan(1);
  expect(await scroller()).toBeLessThan(s0 - 150);
  await page.reload();
  expect(Math.abs((await box(page, 1)).height - a.height)).toBeLessThan(2);
  p = await bar();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y + 400, { steps: 6 });
  await page.mouse.up();
  expect(Math.abs((await box(page, 1)).height - (a.height + 400))).toBeLessThan(2);
  // The scrolling area takes all of it (the card's header stays the same).
  expect(Math.abs((await box(page, 1)).height - (await scroller()) - (h0 - s0))).toBeLessThan(2);
  // Switching layout keeps the input's height, and back.
  const set = (await box(page, 0)).height;
  await page.locator('.split-grip').click();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  expect(await layout(page)).toBe('col');
  expect(Math.abs((await box(page, 0)).height - set)).toBeLessThan(2);
  await page.locator('.split-grip').click();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  expect(Math.abs((await box(page, 0)).height - set)).toBeLessThan(2);
  p = await bar();
  await page.mouse.dblclick(p.x, p.y);
  expect(Math.abs((await box(page, 0)).height - h0)).toBeLessThan(2);
});

test('what the result says never changes the size of the panes: minified, long or empty', async ({ page }) => {
  await open(page, 'JSON 格式化');
  const long = JSON.stringify(Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['key' + i, i])));
  const sizes = async () => [(await box(page, 0)).height, (await box(page, 1)).height].map(Math.round);
  for (const lay of ['row', 'col']) {
    if ((await layout(page)) !== lay) { await page.locator('.split-grip').click(); await page.waitForFunction(() => document.getAnimations().length === 0); }
    await page.locator('textarea').first().fill(long);
    await page.locator('.seg button', { hasText: '2 空格' }).click();
    const s0 = await sizes();
    expect(s0[0], lay).toBe(s0[1]);
    await page.locator('.seg button', { hasText: '压缩' }).click();
    expect(await sizes(), lay).toEqual(s0);
    await page.locator('.seg button', { hasText: '4 空格' }).click();
    expect(await sizes(), lay).toEqual(s0);
    await page.locator('textarea').first().fill('1');
    expect(await sizes(), lay).toEqual(s0);
  }
});
