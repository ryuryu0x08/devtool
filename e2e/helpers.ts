import { expect, test as base, type Locator, type Page } from '@playwright/test';

/**
 * Every test fails on a page error / console error, and on text that should never reach the
 * screen: an unfilled placeholder like "{n}", "undefined", "NaN" or "[object Object]".
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await use(page);
    expect(errors, 'page errors').toEqual([]);
    const text = await page.evaluate(() => {
      const editors = new Set(document.querySelectorAll('textarea, input'));
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode as Text;
        if (n.parentElement && ![...editors].some((e) => e.contains(n))) out.push(n.data);
      }
      return out.join('\n');
    });
    // Text that is data (formatted output, tree rows) can legitimately contain "{n}" etc.;
    // UI chrome is checked by looking outside .code / pre / tree rows.
    const chrome = await page.evaluate(() => {
      const skip = (el: Element | null) => !!el?.closest('.code, pre, .trow, textarea, .hero, .kv, [data-data]');
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) { const n = walker.currentNode as Text; if (!skip(n.parentElement)) out.push(n.data); }
      return out.join('\n');
    });
    expect(chrome, 'unfilled placeholder in the UI').not.toMatch(/\{[a-zA-Z]\w*\}/);
    expect(text, 'broken value on screen').not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]/);
  },
});
export { expect };

/** Fresh app (empty storage), optionally on a tool. */
export async function open(page: Page, tool?: string) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.app');
  if (tool) await nav(page, tool);
}

export async function nav(page: Page, tool: string) {
  const side = page.locator('.nav-item', { hasText: tool });
  if (await side.count()) await side.click();
  else await page.locator('.chip', { hasText: tool }).click();
}

/** Set a textarea / input value like a user paste (works for multi-MB text). */
export async function setValue(el: Locator, text: string) {
  await el.evaluate((node, t) => {
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, t);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

export const editor = (page: Page) => page.locator('textarea[data-autofocus]');
/** Status line of the formatter's output panel. */
export const status = (page: Page) => page.locator('.card-head').nth(1).locator('span').first();
export const toast = (page: Page) => page.locator('.toast');
export const textView = async (page: Page) => {
  await page.locator('.seg button', { hasText: /^(文本|Text)$/ }).click();
  return (await page.locator('pre').first().textContent()) ?? '';
};
export const treeView = (page: Page) => page.locator('.seg button', { hasText: /^(结构|Tree)$/ }).click();
export const rows = async (page: Page) => (await page.locator('.trow .body').allInnerTexts()).map((s) => s.replace(/\n/g, ''));

export interface FileSpec { name: string; type?: string; bytes: number[] | string }

/** Drop files on the window (as the browser does for a drag from the desktop). */
export async function drop(page: Page, files: FileSpec[]) {
  await page.evaluate((fs) => {
    const dt = new DataTransfer();
    for (const f of fs) dt.items.add(new File([typeof f.bytes === 'string' ? f.bytes : new Uint8Array(f.bytes)], f.name, { type: f.type ?? '' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
}

/** Paste on a blank part of the page, with text and / or an image on the clipboard. */
export async function pasteOnBlank(page: Page, data: { text?: string; image?: boolean }) {
  await page.locator('.content').click({ position: { x: 2, y: 2 } });
  await page.evaluate(({ text, image }) => {
    const dt = new DataTransfer();
    if (text !== undefined) dt.setData('text/plain', text);
    if (image) dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'x.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

export const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
export const activeTool = async (page: Page) => (await page.locator('.nav-item.on').innerText()).replace(/\s+/g, ' ').trim();
