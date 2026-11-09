import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, expect, test as base, type ElectronApplication, type Locator, type Page, type TestInfo } from '@playwright/test';

/** Host of the stand-in LLM endpoint in e2e/llm.spec.ts. */
export const STAND_IN_API = 'https://api.test.example/';

/**
 * The desktop app's executable (playwright.desktop.config.ts sets it): each test then runs in a
 * fresh launch of the app, with storage of its own, instead of in the browser.
 */
const DESKTOP = process.env.TOOLBOX_APP;

/** The toolbox's first page: the browser's is the config's baseURL, the desktop app's its own origin. */
export const HOME = DESKTOP ? 'app://toolbox/' : '/';

/** In the desktop app (rather than the browser). */
export const IN_DESKTOP = !!DESKTOP;

/** The host the toolbox is served from: a request to any other leaves the page. */
export const OWN_HOST = DESKTOP ? 'toolbox' : 'localhost';

/** What a test sets for the browser's page (config, test.use): the desktop app's window gets the same. */
interface Emulated { viewport: { width: number; height: number } | null; locale?: string; timezoneId?: string; colorScheme?: 'light' | 'dark' | 'no-preference' | null }

/** The desktop app each page is in. */
const APPS = new WeakMap<Page, ElectronApplication>();

/** A launch of the desktop app, its window set up as the browser's page would be. */
async function desktopPage(info: TestInfo, e: Emulated) {
  const app = await _electron.launch({
    executablePath: DESKTOP!,
    args: [`--user-data-dir=${info.outputPath('user-data')}`, `--lang=${e.locale ?? 'zh-CN'}`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    env: { ...process.env, TZ: e.timezoneId ?? 'Asia/Shanghai' },
  });
  const page = await app.firstWindow();
  APPS.set(page, app);
  await page.setViewportSize(e.viewport ?? { width: 1280, height: 900 });
  if (e.colorScheme) await page.emulateMedia({ colorScheme: e.colorScheme });
  await page.waitForSelector('.app');
  return { page, close: () => app.close() };
}

/**
 * Every test fails on a page error / console error, and on text that should never reach the
 * screen: an unfilled placeholder like "{n}", "undefined", "NaN" or "[object Object]".
 */
export const test = base.extend<{ page: Page }>({
  page: DESKTOP
    ? async ({ viewport, locale, timezoneId, colorScheme, isMobile }, use, info) => {
        info.skip(isMobile, 'a phone layout: the desktop app has none (its window is at least 720 px wide)');
        const d = await desktopPage(info, { viewport, locale, timezoneId, colorScheme });
        try {
          await checked(d.page, use);
        } finally {
          await d.close();
        }
      }
    : async ({ page }, use) => checked(page, use),
});

async function checked(page: Page, use: (p: Page) => Promise<void>) {
  {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // The browser logs a failed request as an error; the stand-in API used by the LLM tests fails on purpose.
    page.on('console', (m) => { if (m.type() === 'error' && !m.location().url.startsWith(STAND_IN_API)) errors.push(m.text()); });
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
  }
}
export { expect };

/** Fresh app (empty storage), optionally on a tool. */
export async function open(page: Page, tool?: string) {
  await page.goto(HOME);
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

/**
 * What `click` downloads: its file name and where it was saved. The desktop app asks where to save
 * (the system's dialog); here it is saved in the test's folder instead.
 */
export async function downloaded(page: Page, click: () => Promise<unknown>): Promise<{ name: string; path: string }> {
  const app = APPS.get(page);
  if (!app) {
    const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
    return { name: dl.suggestedFilename(), path: (await dl.path())! };
  }
  // A folder of its own for each download (one picked again later is a new file to the page), with
  // a plain path: Playwright can't pick a file whose path has characters like the "→" of test titles.
  const dir = mkdtempSync(join(tmpdir(), 'toolbox-download-'));
  await app.evaluate(({ session }, dir) => {
    (globalThis as unknown as { next: Promise<unknown> }).next = new Promise((done) =>
      session.defaultSession.once('will-download', (_e, item) => {
        const path = dir + '/' + item.getFilename();
        item.setSavePath(path);
        item.once('done', (_e2, state) => done({ name: item.getFilename(), path, state }));
      }));
  }, dir);
  await click();
  const d = (await app.evaluate(() => (globalThis as unknown as { next: Promise<unknown> }).next)) as { name: string; path: string; state: string };
  expect(d.state, 'download').toBe('completed');
  return { name: d.name, path: d.path };
}
