// Base64 (RFC 4648), standard and URL-safe alphabets. Decoding refuses what it can't read, with
// the position, and reports everything it tolerated instead of passing over it silently.

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ENC_STD = Uint8Array.from(STD, (c) => c.charCodeAt(0));
const ENC_URL = Uint8Array.from(STD.slice(0, 62) + '-_', (c) => c.charCodeAt(0));
const DEC = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) DEC[ENC_STD[i]] = i;
DEC[45] = 62; // -
DEC[95] = 63; // _

export function b64encode(bytes: Uint8Array, url = false, pad = true): string {
  const A = url ? ENC_URL : ENC_STD, n = bytes.length, full = n - (n % 3);
  // Written as bytes and decoded once: string concatenation is slow for multi-MB input.
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let o = 0;
  for (let i = 0; i < full; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = A[v >>> 18]; out[o++] = A[(v >>> 12) & 63]; out[o++] = A[(v >>> 6) & 63]; out[o++] = A[v & 63];
  }
  if (n > full) {
    const two = n - full === 2;
    const v = (bytes[full] << 16) | (two ? bytes[full + 1] << 8 : 0);
    out[o++] = A[v >>> 18]; out[o++] = A[(v >>> 12) & 63];
    if (two) out[o++] = A[(v >>> 6) & 63];
    if (pad) { out[o++] = 61; if (!two) out[o++] = 61; }
  }
  return new TextDecoder().decode(out.subarray(0, o));
}

export type B64Note =
  | { k: 'dataUrl'; mime: string }
  | { k: 'url' }
  | { k: 'noPad' }
  | { k: 'ws'; n: number }
  | { k: 'bits' };

/** `pos` is the index in the input (errInfo turns it into line / column and marks it). */
export class B64Error extends Error {
  constructor(readonly code: 'char' | 'mixed' | 'pad' | 'len', readonly pos: number, readonly ch = '', readonly n = 0) {
    super(code + ' at ' + pos);
  }
}

const ws = (c: number) => c === 32 || (c >= 9 && c <= 13);

/** Decode; null for empty input. Throws B64Error. */
export function b64decode(src: string): { bytes: Uint8Array; notes: B64Note[]; mime?: string } | null {
  let i = 0, end = src.length;
  while (i < end && ws(src.charCodeAt(i))) i++;
  while (end > i && ws(src.charCodeAt(end - 1))) end--;
  if (i === end) return null;
  const notes: B64Note[] = [];
  const m = /^data:([^,]*?);base64,/i.exec(src.slice(i, Math.min(end, i + 512)));
  if (m) { notes.push({ k: 'dataUrl', mime: m[1] }); i += m[0].length; }
  const vals = new Uint8Array(end - i);
  let n = 0, pad = 0, padAt = -1, spaces = 0, std = false, url = false, last = i;
  for (let p = i; p < end; p++) {
    const c = src.charCodeAt(p);
    if (ws(c)) { spaces++; continue; }
    if (c === 61) { if (padAt < 0) padAt = p; pad++; continue; }
    const v = c < 128 ? DEC[c] : -1;
    if (v < 0) throw new B64Error('char', p, String.fromCodePoint(src.codePointAt(p)!));
    // Data after "=": the padding is in the middle.
    if (pad) throw new B64Error('pad', padAt);
    if (c === 43 || c === 47) { if (url) throw new B64Error('mixed', p); std = true; }
    else if (c === 45 || c === 95) { if (std) throw new B64Error('mixed', p); url = true; }
    vals[n++] = v;
    last = p;
  }
  if (n % 4 === 1) throw new B64Error('len', last, '', n);
  if (pad && (pad > 2 || (n + pad) % 4)) throw new B64Error('pad', padAt);
  if (!pad && n % 4) notes.push({ k: 'noPad' });
  if (url) notes.push({ k: 'url' });
  if (spaces) notes.push({ k: 'ws', n: spaces });
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0, q = 0;
  for (; q + 4 <= n; q += 4) {
    const v = (vals[q] << 18) | (vals[q + 1] << 12) | (vals[q + 2] << 6) | vals[q + 3];
    out[o++] = v >>> 16; out[o++] = (v >>> 8) & 255; out[o++] = v & 255;
  }
  // The last character carries bits beyond the final byte; an encoder sets them to 0.
  if (n - q === 2) {
    out[o++] = (vals[q] << 2) | (vals[q + 1] >>> 4);
    if (vals[q + 1] & 15) notes.push({ k: 'bits' });
  } else if (n - q === 3) {
    const v = (vals[q] << 10) | (vals[q + 1] << 4) | (vals[q + 2] >>> 2);
    out[o++] = v >>> 8; out[o++] = v & 255;
    if (vals[q + 2] & 3) notes.push({ k: 'bits' });
  }
  return { bytes: out, notes, mime: m ? m[1] : undefined };
}

/** File type from the first bytes, for the image preview and the download's file name. */
export function sniff(b: Uint8Array): { mime: string; ext: string } | null {
  const at = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b[0] === 0x89 && at(1, 'PNG\r\n\x1a\n')) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return { mime: 'image/gif', ext: 'gif' };
  if (at(0, 'RIFF') && at(8, 'WEBP')) return { mime: 'image/webp', ext: 'webp' };
  if (at(0, '\x00\x00\x01\x00') && b.length > 6) return { mime: 'image/x-icon', ext: 'ico' };
  if (at(0, '%PDF-')) return { mime: 'application/pdf', ext: 'pdf' };
  if (at(0, 'PK\x03\x04')) return { mime: 'application/zip', ext: 'zip' };
  if (b[0] === 0x1f && b[1] === 0x8b) return { mime: 'application/gzip', ext: 'gz' };
  return null;
}

/** Classic hex dump: offset, 16 bytes in hex, printable ASCII. */
export function hexDump(b: Uint8Array, max = 4096): string {
  const lines: string[] = [];
  for (let o = 0; o < Math.min(b.length, max); o += 16) {
    const row = b.subarray(o, Math.min(o + 16, b.length, max));
    const hex = Array.from(row, (x) => x.toString(16).padStart(2, '0'));
    const left = hex.slice(0, 8).join(' '), right = hex.slice(8).join(' ');
    lines.push(o.toString(16).padStart(8, '0') + '  ' + (left + '  ' + right).padEnd(49) + ' |' +
      Array.from(row, (x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('') + '|');
  }
  return lines.join('\n');
}
