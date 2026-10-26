// QR generation (qrcode-generator) and scanning (BarcodeDetector, falling back to jsQR).
import qrcode from 'qrcode-generator';
import jsQR, { type QRCode } from 'jsqr';
import { wellFormed } from './data';

export type Ec = 'L' | 'M' | 'Q' | 'H';
export interface QrModel { n: number; d: string }

qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/** Build an SVG path for the QR modules; `null` for empty text, `{err}` if it can't be encoded or doesn't fit. */
export function qrModel(text: string, ec: Ec): QrModel | { err: 'bad' | 'long' } | null {
  if (!text) return null;
  // Lone surrogates have no UTF-8 encoding; the library would emit wrong bytes.
  if (!wellFormed(text)) return { err: 'bad' };
  try {
    const qr = qrcode(0, ec);
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (qr.isDark(r, c)) {
          const s = c;
          while (c < n && qr.isDark(r, c)) c++;
          d += 'M' + s + ' ' + r + 'h' + (c - s) + 'v1h' + (s - c) + 'z';
        } else c++;
      }
    }
    return { n, d };
  } catch {
    return { err: 'long' };
  }
}

/** Render a ~1024px PNG-ready canvas with a 4-module quiet zone. */
export function qrCanvas(m: QrModel): HTMLCanvasElement {
  const scale = Math.max(4, Math.floor(1024 / (m.n + 8)));
  const size = (m.n + 8) * scale;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#111';
  ctx.translate(4 * scale, 4 * scale);
  ctx.scale(scale, scale);
  ctx.fill(new Path2D(m.d));
  return cv;
}

/** `enc`: how the bytes were decoded when it wasn't UTF-8 (or 'browser' when BarcodeDetector decoded them). */
export interface FoundCode { text: string; x: number; y: number; w: number; h: number; enc?: string }

/**
 * Text of a decoded code. jsQR assumes UTF-8 and returns '' when that fails, so decode the
 * raw bytes: UTF-8, then GB18030 (GBK, common in Chinese codes), then Shift_JIS, else Latin-1.
 */
export function codeText(c: Pick<QRCode, 'data' | 'binaryData' | 'chunks'>): { text: string; enc?: string } {
  if (c.chunks.some((k) => k.type === 'kanji')) return { text: c.data, enc: 'Shift_JIS' };
  const bytes = new Uint8Array(c.binaryData);
  for (const enc of ['utf-8', 'gb18030', 'shift_jis']) {
    try {
      const text = new TextDecoder(enc, { fatal: true }).decode(bytes);
      return enc === 'utf-8' ? { text } : { text, enc: enc === 'gb18030' ? 'GB18030' : 'Shift_JIS' };
    } catch { /* try the next encoding */ }
  }
  return { text: Array.from(bytes, (b) => String.fromCharCode(b)).join(''), enc: 'ISO-8859-1' };
}

interface BarcodeDetectorLike {
  detect(img: CanvasImageSource): Promise<{ rawValue: string; boundingBox: DOMRectReadOnly }[]>;
}

/**
 * Find codes with jsQR, which decodes one at a time and gives up when it sees the finder
 * patterns of several codes. So: decode the whole image and paint each found code out; then
 * do the same on overlapping square tiles of several sizes to catch codes it couldn't single out.
 */
function jsqrScan(bmp: ImageBitmap, md: number, tiles: boolean): FoundCode[] {
  const W = bmp.width, H = bmp.height;
  const sc = Math.min(1, md / Math.max(W, H));
  const w = Math.max(1, Math.round(W * sc)), h = Math.max(1, Math.round(H * sc));
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const out: FoundCode[] = [];
  /** Decode codes inside a region (canvas pixels), painting each out. */
  const region = (rx: number, ry: number, rw: number, rh: number, both = true) => {
    for (let k = 0; k < 12 && out.length < 40; k++) {
      const c = jsQR(ctx.getImageData(rx, ry, rw, rh).data, rw, rh, { inversionAttempts: both ? 'attemptBoth' : 'dontInvert' });
      if (!c) return;
      const L = c.location;
      const xs = [L.topLeftCorner.x, L.topRightCorner.x, L.bottomLeftCorner.x, L.bottomRightCorner.x].map((x) => x + rx);
      const ys = [L.topLeftCorner.y, L.topRightCorner.y, L.bottomLeftCorner.y, L.bottomRightCorner.y].map((y) => y + ry);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const pd = Math.max(4, (x1 - x0) * 0.1);
      out.push({ ...codeText(c), x: (x0 - pd / 2) / sc, y: (y0 - pd / 2) / sc, w: (x1 - x0 + pd) / sc, h: (y1 - y0 + pd) / sc });
      ctx.fillStyle = '#fff';
      ctx.fillRect(x0 - pd, y0 - pd, x1 - x0 + 2 * pd, y1 - y0 + 2 * pd);
    }
  };
  region(0, 0, w, h);
  if (!tiles) return out;
  // Square tiles, each step half a tile: any code at most half a tile wide lies wholly inside one.
  // Bounded in time: busy photos (jsQR sees finder-like patterns everywhere) would take long.
  const until = performance.now() + 3000;
  for (const f of [1, 0.5, 0.35]) {
    if (performance.now() > until) break;
    const t = Math.round(Math.min(w, h) * f);
    if (t < 60) break;
    const step = Math.max(1, Math.floor(t / 2));
    const starts = (len: number) => { const a: number[] = []; for (let p = 0; p + t < len; p += step) a.push(p); a.push(Math.max(0, len - t)); return a; };
    for (const ty of starts(h)) for (const tx of starts(w)) if (performance.now() < until) region(tx, ty, Math.min(t, w - tx), Math.min(t, h - ty), f >= 0.5);
  }
  region(0, 0, w, h);
  return out;
}

/** All codes in a bitmap via jsQR at a few scales (each size tried once). Runs in a worker. */
export function scanBitmap(bmp: ImageBitmap): FoundCode[] {
  const tried = new Set<number>();
  for (const md of [1600, 900, 2400]) {
    const sc = Math.min(1, md / Math.max(bmp.width, bmp.height));
    if (tried.has(sc)) continue;
    tried.add(sc);
    const codes = jsqrScan(bmp, md, tried.size === 1);
    if (codes.length) return codes;
  }
  return [];
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

let active: { worker: Worker; done: (c: FoundCode[]) => void } | null = null;

/** jsQR in a worker so a large photo never freezes the page; a newer scan cancels the older one. */
function scanInWorker(bmp: ImageBitmap): Promise<FoundCode[]> {
  if (active) { active.worker.terminate(); active.done([]); active = null; }
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./qr.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(scanBitmap(bmp));
      return;
    }
    const done = (c: FoundCode[]) => { worker.terminate(); if (active?.worker === worker) active = null; resolve(c); };
    active = { worker, done };
    worker.onmessage = (e: MessageEvent<FoundCode[]>) => done(e.data);
    worker.onerror = () => done(scanBitmap(bmp));
    worker.postMessage(bmp);
  });
}

/**
 * Find every QR code in the image, sorted in reading order. jsQR goes first because it gives
 * the raw bytes; the browser's BarcodeDetector (text only, encoding unknown) is the fallback.
 */
export async function scanImage(img: HTMLImageElement): Promise<FoundCode[]> {
  let codes = await scanInWorker(await createImageBitmap(img));
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
  if (!codes.length && BD) {
    try {
      const r = await new BD({ formats: ['qr_code'] }).detect(img);
      codes = r.map((x) => ({ text: x.rawValue, enc: 'browser', x: x.boundingBox.x, y: x.boundingBox.y, w: x.boundingBox.width, h: x.boundingBox.height }));
    } catch { /* no detector */ }
  }
  codes.sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x));
  return codes;
}
