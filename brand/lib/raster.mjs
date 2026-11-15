// Turning SVG and HTML into PNG with headless Chromium (the Playwright the repo's end-to-end tests install).
import { chromium } from 'playwright';

const PNG_SIGNATURE = '89504e470d0a1a0a';
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

export function pngSize(bytes) {
  if (bytes.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) return null;
  return { width: bytes.readUInt32BE(IHDR_WIDTH_OFFSET), height: bytes.readUInt32BE(IHDR_HEIGHT_OFFSET) };
}

/** Starts Chromium, hands it to `use`, and closes it whatever happens. */
export async function withBrowser(use) {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    throw new Error(`cannot start chromium (${err.message.split('\n')[0]}); install it with: npx playwright install chromium`);
  }
  try {
    return await use(browser);
  } finally {
    await browser.close();
  }
}

/** Draws `svg` on a `size` × `size` canvas and returns the PNG, checked to be that size. */
export async function svgToPng(page, svg, size) {
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  const base64 = await page.evaluate(async ({ source, px }) => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    canvas.getContext('2d').drawImage(image, 0, 0, px, px);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { source: sized, px: size });
  const bytes = Buffer.from(base64, 'base64');
  const got = pngSize(bytes);
  if (!got || got.width !== size || got.height !== size) {
    throw new Error(`rendered png is ${got ? `${got.width}×${got.height}` : 'not a png'}, expected ${size}×${size}`);
  }
  return bytes;
}

/** A full-page screenshot of `html`, `width` CSS pixels wide at `scale` device pixels per CSS pixel. */
export async function htmlToPng(browser, html, { width, scale, colorScheme = 'light' }) {
  const page = await browser.newPage({ viewport: { width, height: 600 }, deviceScaleFactor: scale, colorScheme });
  try {
    await page.setContent(html);
    await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    return await page.screenshot({ fullPage: true });
  } finally {
    await page.close();
  }
}
