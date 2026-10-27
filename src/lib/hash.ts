// MD5, SHA-1 and SHA-256, fed in chunks (files are read piece by piece, never whole).
// Own code rather than crypto.subtle: that has no MD5, and is missing on pages not served over HTTPS.
import { b64decode, b64encode } from './b64';

export type Algo = 'md5' | 'sha1' | 'sha256';
export const ALGOS: Algo[] = ['md5', 'sha1', 'sha256'];
export const ALGO_NAME: Record<Algo, string> = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256' };
export type Digests = Record<Algo, Uint8Array>;

/** Bit length of `n` bytes as [high, low] 32-bit words (n × 8 overflows 32 bits from 512 MB on). */
export function bitLen(n: number): [number, number] {
  return [Math.floor(n / 0x20000000) >>> 0, ((n % 0x20000000) * 8) >>> 0];
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** Block buffering and padding shared by the three (Merkle–Damgård, 64-byte blocks). */
abstract class Hasher {
  private buf = new Uint8Array(64);
  private fill = 0;
  private len = 0;
  private done = false;
  /** MD5 writes the length (and its result) little-endian; the SHAs big-endian. */
  protected abstract readonly le: boolean;
  protected abstract readonly h: Int32Array;
  protected abstract block(b: Uint8Array, o: number): void;

  update(d: Uint8Array): this {
    if (this.done) throw new Error('update() after digest()');
    this.len += d.length;
    let i = 0;
    if (this.fill) {
      i = Math.min(64 - this.fill, d.length);
      this.buf.set(d.subarray(0, i), this.fill);
      this.fill += i;
      if (this.fill < 64) return this;
      this.block(this.buf, 0);
      this.fill = 0;
    }
    for (; i + 64 <= d.length; i += 64) this.block(d, i);
    if (i < d.length) { this.buf.set(d.subarray(i)); this.fill = d.length - i; }
    return this;
  }

  digest(): Uint8Array {
    if (!this.done) {
      const [hi, lo] = bitLen(this.len);
      const pad = new Uint8Array((this.fill < 56 ? 56 : 120) - this.fill + 8);
      pad[0] = 0x80;
      const v = new DataView(pad.buffer);
      if (this.le) { v.setUint32(pad.length - 8, lo, true); v.setUint32(pad.length - 4, hi, true); }
      else { v.setUint32(pad.length - 8, hi); v.setUint32(pad.length - 4, lo); }
      this.update(pad);
      this.done = true;
    }
    const out = new Uint8Array(this.h.length * 4), v = new DataView(out.buffer);
    this.h.forEach((x, i) => v.setInt32(i * 4, x, this.le));
    return out;
  }
}

const MD5_K = Int32Array.from([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

class MD5 extends Hasher {
  protected readonly le = true;
  protected readonly h = Int32Array.from([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private m = new Int32Array(16);
  protected block(b: Uint8Array, o: number) {
    const m = this.m, h = this.h;
    for (let i = 0; i < 16; i++, o += 4) m[i] = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
    let a = h[0], B = h[1], c = h[2], d = h[3];
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (B & c) | (~B & d); g = i; }
      else if (i < 32) { f = (d & B) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = B ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (B | ~d); g = (7 * i) & 15; }
      const t = d;
      d = c;
      c = B;
      B = (B + rotl((a + f + MD5_K[i] + m[g]) | 0, MD5_S[(i >> 4) * 4 + (i & 3)])) | 0;
      a = t;
    }
    h[0] += a; h[1] += B; h[2] += c; h[3] += d;
  }
}

class SHA1 extends Hasher {
  protected readonly le = false;
  protected readonly h = Int32Array.from([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private w = new Int32Array(80);
  protected block(b: Uint8Array, o: number) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++, o += 4) w[i] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h[0], B = h[1], c = h[2], d = h[3], e = h[4];
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (B & c) | (~B & d) : i < 40 ? B ^ c ^ d : i < 60 ? (B & c) | (B & d) | (c & d) : B ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(B, 30);
      B = a;
      a = t;
    }
    h[0] += a; h[1] += B; h[2] += c; h[3] += d; h[4] += e;
  }
}

const SHA256_K = Int32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class SHA256 extends Hasher {
  protected readonly le = false;
  protected readonly h = Int32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Int32Array(64);
  protected block(b: Uint8Array, o: number) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++, o += 4) w[i] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))) | 0;
    }
    let a = h[0], B = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], H = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (H + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & B) ^ (a & c) ^ (B & c))) | 0;
      H = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = B;
      B = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += B; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += H;
  }
}

export interface Multi { update(d: Uint8Array): void; digest(): Digests }

/** All three at once, so a file is read a single time. */
export function hashers(): Multi {
  const hs = { md5: new MD5(), sha1: new SHA1(), sha256: new SHA256() };
  return {
    update: (d) => { hs.md5.update(d); hs.sha1.update(d); hs.sha256.update(d); },
    digest: () => ({ md5: hs.md5.digest(), sha1: hs.sha1.digest(), sha256: hs.sha256.digest() }),
  };
}

export function digestAll(bytes: Uint8Array): Digests {
  const m = hashers();
  m.update(bytes);
  return m.digest();
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export type HashFmt = 'hex' | 'HEX' | 'b64';
export const fmtDigest = (b: Uint8Array, f: HashFmt) => (f === 'b64' ? b64encode(b) : f === 'HEX' ? toHex(b).toUpperCase() : toHex(b));

export type Check =
  | { ok: boolean; algo: Algo; form: 'hex' | 'b64' }
  | { unknown: true; hexLen?: number };

/**
 * Compare a pasted hash with the computed ones. Accepts hex in any case, Base64 (as in SRI
 * "sha256-…"), an "md5:" / "sha256:" style prefix, spaces between groups, and checksum-file
 * lines ("<hash>  <file name>" as md5sum / sha256sum print, "SHA256 (<file>) = <hash>" as BSD
 * tools print). The length says which algorithm.
 */
export function checkHash(input: string, d: Digests): Check | null {
  let s = input.trim();
  const bsd = /^(?:md5|sha-?1|sha-?256)\s*\(.*\)\s*=\s*(\S+)$/i.exec(s);
  s = (bsd ? bsd[1] : s).replace(/^(md5|sha-?1|sha-?256)\s*[:=-]?\s*/i, '');
  if (!s) return null;
  const line = /^([0-9a-f]+)\s+\*?\S/i.exec(s);
  s = line && [32, 40, 64].includes(line[1].length) ? line[1] : s.replace(/\s+/g, '');
  let bytes: Uint8Array | null = null, form: 'hex' | 'b64' = 'hex';
  const isHex = /^[0-9a-f]+$/i.test(s);
  if (isHex && s.length % 2 === 0) bytes = Uint8Array.from(s.match(/../g)!, (x) => parseInt(x, 16));
  else {
    try { bytes = b64decode(s)?.bytes ?? null; form = 'b64'; } catch { /* neither */ }
  }
  const algo = bytes && ALGOS.find((a) => d[a].length === bytes!.length);
  if (!bytes || !algo || (isHex && form === 'b64')) return { unknown: true, hexLen: isHex ? s.length : undefined };
  return { ok: d[algo].every((x, i) => x === bytes![i]), algo, form };
}

/**
 * A pasted line that is a hash to check, not text to hash: 32 / 40 / 64 hex digits (optionally
 * "md5:" / "sha256:" prefixed, or followed by a file name as md5sum / sha256sum print), a BSD
 * checksum line, or an SRI value ("sha256-…").
 */
export function hashLike(s: string): boolean {
  const t = s.trim();
  if (!t || t.includes('\n')) return false;
  return /^(?:(?:md5|sha-?1|sha-?256)\s*[:=]?\s*)?(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})(?:\s+\*?\S.*)?$/i.test(t)
    || /^(?:md5|sha-?1|sha-?256)\s*\(.*\)\s*=\s*[0-9a-f]{32,64}$/i.test(t)
    || /^sha(?:1|256)-[A-Za-z0-9+/]{27,43}={0,2}$/.test(t);
}
