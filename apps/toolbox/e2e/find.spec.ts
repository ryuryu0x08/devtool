// The find bar (⌘F / Ctrl+F): it finds in the tool's text boxes and its results, counts, marks,
// goes from match to match, and leaves the match selected in its box when closed.
import type { Page } from '@playwright/test';
import { expect, open, test } from './helpers';

const bar = (page: Page) => page.locator('.find-bar');
const marked = (page: Page) => page.evaluate(() => {
  const h = (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights;
  return { all: h.get('tb-find')?.size ?? 0, cur: h.get('tb-find-cur')?.size ?? 0 };
});

test('⌘F finds in the input box and in the formatted result, in page order, and goes round', async ({ page }) => {
  await open(page, 'JSON 格式化');
  const box = page.locator('textarea.area').first();
  await box.fill('{"name":"a","list":[{"name":"b"}]}');
  await expect(page.locator('.content')).toContainText('2 个键');
  await box.press('ControlOrMeta+f');
  await expect(bar(page)).toBeVisible();
  await expect(page.locator('.find-q')).toBeFocused();
  await page.locator('.find-q').fill('name');
  // Two in the box, then those in the result (the tree or the text, as shown).
  const n = Number((await page.locator('.find-n').innerText()).split('/')[1]);
  // Each counted once: the box's text isn't counted again as text of the page.
  expect(n).toBe(4);
  await expect(page.locator('.find-n')).toHaveText(`1/${n}`);
  // In the box: marked by the copy over it, the first one the current.
  await expect(page.locator('.find-mirror mark')).toHaveCount(2);
  await expect(page.locator('.find-mirror mark.cur')).toHaveText('name');
  expect((await marked(page)).all).toBe(n - 2);
  // Enter: the second (still in the box); then the result's.
  await page.locator('.find-q').press('Enter');
  await expect(page.locator('.find-n')).toHaveText(`2/${n}`);
  await page.locator('.find-q').press('Enter');
  await expect(page.locator('.find-n')).toHaveText(`3/${n}`);
  await expect(page.locator('.find-mirror mark.cur')).toHaveCount(0);
  expect((await marked(page)).cur).toBe(1);
  // Shift+Enter back, past the start: the last.
  for (let i = 0; i < 3; i++) await page.locator('.find-q').press('Shift+Enter');
  await expect(page.locator('.find-n')).toHaveText(`${n}/${n}`);
  // Case: none matches "NAME" as typed.
  await page.locator('.find-q').fill('NAME');
  await expect(page.locator('.find-n')).toHaveText(`1/${n}`);
  await page.locator('.find-btn', { hasText: 'Aa' }).click();
  await expect(page.locator('.find-n')).toHaveText('无结果');
  await page.locator('.find-btn', { hasText: 'Aa' }).click();
  // Esc on the second match (in the box): closed, nothing left marked, the match selected in the box.
  await page.locator('.find-q').press('Enter');
  await page.locator('.find-q').press('Escape');
  await expect(bar(page)).toBeHidden();
  await expect(page.locator('.find-mirror')).toHaveCount(0);
  expect(await marked(page)).toEqual({ all: 0, cur: 0 });
  await expect(box).toBeFocused();
  expect(await box.evaluate((b: HTMLTextAreaElement) => [b.selectionStart, b.selectionEnd])).toEqual([22, 26]);
});

test('the selected text is what it looks for; the matches follow the text as it changes', async ({ page }) => {
  await open(page, 'JSON 格式化');
  const box = page.locator('textarea.area').first();
  await box.fill('{"alpha":1,"beta":2}');
  // The result shown first (it holds matches too).
  await expect(page.locator('.content')).toContainText('2 个键');
  await box.evaluate((b: HTMLTextAreaElement) => { b.focus(); b.setSelectionRange(2, 7); });
  await box.press('ControlOrMeta+f');
  await expect(page.locator('.find-q')).toHaveValue('alpha');
  const total = async () => Number((await page.locator('.find-n').innerText()).split('/')[1] || 0);
  // Once in the box, once in the result.
  await expect.poll(total).toBe(2);
  // More text with it: more matches, without asking again.
  await box.evaluate((b: HTMLTextAreaElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(b, '{"alpha":1,"beta":2,"alpha2":3}');
    b.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(total).toBe(4);
  // The copy over the box lies where the box is.
  const [a, m] = await Promise.all([box.boundingBox(), page.locator('.find-mirror').boundingBox()]);
  expect(Math.abs(a!.x - m!.x)).toBeLessThan(3);
  expect(Math.abs(a!.y - m!.y)).toBeLessThan(3);
});
