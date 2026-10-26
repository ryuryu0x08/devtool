// Hashes and Base64 checked against Node's own implementations (node:crypto, Buffer).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALGOS, bitLen, checkHash, digestAll, fmtDigest, hashers, toHex, type Algo } from './hash';
import { B64Error, b64decode, b64encode, hexDump, sniff } from './b64';
import { bytesLabel, normEol, textBytes } from './data';

const NODE: Record<Algo, string> = { md5: 'md5', sha1: 'sha1', sha256: 'sha256' };
const ref = (a: Algo, b: Uint8Array) => createHash(NODE[a]).update(b).digest('hex');
const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const bytesOf = (r: () => number, n: number) => Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('MD5 / SHA-1 / SHA-256', () => {
  it('published test vectors', () => {
    const v = (s: string) => { const d = digestAll(utf8(s)); return [toHex(d.md5), toHex(d.sha1), toHex(d.sha256)]; };
    expect(v('')).toEqual(['d41d8cd98f00b204e9800998ecf8427e', 'da39a3ee5e6b4b0d3255bfef95601890afd80709', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']);
    expect(v('abc')).toEqual(['900150983cd24fb0d6963f7d28e17f72', 'a9993e364706816aba3e25717850c26c9cd0d89d', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad']);
    // RFC 1321 suite.
    expect(toHex(digestAll(utf8('message digest')).md5)).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(toHex(digestAll(utf8('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).md5)).toBe('57edf4a22be3c955ac49da2e2107b67a');
    // FIPS 180 two-block message and one million "a".
    const two = digestAll(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'));
    expect(toHex(two.sha1)).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
    expect(toHex(two.sha256)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    const million = digestAll(new Uint8Array(1_000_000).fill(97));
    expect(toHex(million.sha1)).toBe('34aa973cd4c4daa4f61eeb2bdbad27316534016f');
    expect(toHex(million.sha256)).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    expect(toHex(million.md5)).toBe('7707d6ae4e027c70eea2a935c2296f21');
  });

  it('agree with node:crypto for every length around the block boundaries, and random data', () => {
    const r = rng(1);
    const lens = [...Array.from({ length: 200 }, (_, i) => i), 511, 512, 513, 1000, 4095, 4096, 65537, 300_000];
    for (const n of lens) {
      const b = bytesOf(r, n), d = digestAll(b);
      for (const a of ALGOS) expect(toHex(d[a]), a + ' ' + n).toBe(ref(a, b));
    }
  });

  it('chunked input gives the same result however it is split', () => {
    const r = rng(2);
    for (let t = 0; t < 300; t++) {
      const b = bytesOf(r, Math.floor(r() * 700));
      const h = hashers();
      for (let p = 0; p < b.length;) { const k = Math.floor(r() * 130); h.update(b.subarray(p, p + k)); p += k; }
      const d = h.digest();
      for (const a of ALGOS) expect(toHex(d[a])).toBe(ref(a, b));
    }
  });

  it('length words for files over 512 MB (n × 8 overflows 32 bits)', () => {
    expect(bitLen(0)).toEqual([0, 0]);
    expect(bitLen(2 ** 29 - 1)).toEqual([0, 0xfffffff8]);
    expect(bitLen(2 ** 29)).toEqual([1, 0]);
    expect(bitLen(5 * 2 ** 30 + 3)).toEqual([10, 24]);
  });

  it('digest is stable; feeding after it is an error', () => {
    const h = hashers();
    h.update(utf8('x'));
    expect(toHex(h.digest().sha256)).toBe(toHex(h.digest().sha256));
    expect(() => h.update(utf8('y'))).toThrow();
  });

  it('output formats', () => {
    const d = digestAll(utf8('abc')).md5;
    expect(fmtDigest(d, 'hex')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(fmtDigest(d, 'HEX')).toBe('900150983CD24FB0D6963F7D28E17F72');
    expect(fmtDigest(d, 'b64')).toBe(Buffer.from(d).toString('base64'));
  });
});

describe('checking a pasted hash', () => {
  const d = digestAll(utf8('abc'));
  const sha = toHex(d.sha256), md5 = toHex(d.md5), sha1 = toHex(d.sha1);
  it.each([
    [sha, { ok: true, algo: 'sha256', form: 'hex' }],
    [sha.toUpperCase(), { ok: true, algo: 'sha256', form: 'hex' }],
    ['  ' + md5 + '\n', { ok: true, algo: 'md5', form: 'hex' }],
    [sha1.replace(/(.{8})/g, '$1 '), { ok: true, algo: 'sha1', form: 'hex' }],
    ['sha256:' + sha, { ok: true, algo: 'sha256', form: 'hex' }],
    ['MD5=' + md5, { ok: true, algo: 'md5', form: 'hex' }],
    ['sha256-' + Buffer.from(d.sha256).toString('base64'), { ok: true, algo: 'sha256', form: 'b64' }],
    [Buffer.from(d.md5).toString('base64url'), { ok: true, algo: 'md5', form: 'b64' }],
    [sha + '  file name.iso', { ok: true, algo: 'sha256', form: 'hex' }],
    [md5 + ' *setup.exe', { ok: true, algo: 'md5', form: 'hex' }],
    ['SHA256 (a b.txt) = ' + sha, { ok: true, algo: 'sha256', form: 'hex' }],
    [sha.slice(0, -1) + (sha.endsWith('0') ? '1' : '0'), { ok: false, algo: 'sha256', form: 'hex' }],
    [md5.replace(/./, (c) => (c === 'f' ? 'e' : 'f')), { ok: false, algo: 'md5', form: 'hex' }],
    [sha.slice(0, 63), { unknown: true, hexLen: 63 }],
    [sha.slice(0, 62), { unknown: true, hexLen: 62 }],
    ['hello', { unknown: true }],
  ])('%s', (input, want) => {
    expect(checkHash(input, d)).toEqual(want);
  });
  it('empty input is no check', () => {
    expect(checkHash('   ', d)).toBeNull();
  });
});

describe('Base64', () => {
  it('encodes like Buffer: both alphabets, with and without padding', () => {
    const r = rng(3);
    for (let n = 0; n < 400; n++) {
      const b = bytesOf(r, n % 50 === 0 ? n * 37 : n % 40);
      expect(b64encode(b)).toBe(Buffer.from(b).toString('base64'));
      expect(b64encode(b, true, false)).toBe(Buffer.from(b).toString('base64url'));
      expect(b64encode(b, false, false)).toBe(Buffer.from(b).toString('base64').replace(/=+$/, ''));
      expect(b64encode(b, true, true)).toBe(Buffer.from(b).toString('base64url') + '='.repeat((4 - (Buffer.from(b).toString('base64url').length % 4)) % 4));
    }
  });

  it('decodes every encoding back to the same bytes; canonical input has no notes', () => {
    const r = rng(4);
    for (let n = 0; n < 400; n++) {
      const b = bytesOf(r, n % 40);
      const back = (s: string) => Array.from(b64decode(s)?.bytes ?? []);
      expect(back(b64encode(b))).toEqual(Array.from(b));
      if (b.length) expect(b64decode(b64encode(b))!.notes).toEqual([]);
      expect(back(b64encode(b, true, false))).toEqual(Array.from(b));
      expect(back(b64encode(b, false, true).replace(/(.{4})/g, '$1\n'))).toEqual(Array.from(b));
    }
  });

  it('reports what it tolerated', () => {
    const notes = (s: string) => b64decode(s)!.notes;
    expect(notes('aGVsbG8')).toEqual([{ k: 'noPad' }]);
    expect(notes('-_-_')).toEqual([{ k: 'url' }]);
    expect(notes('aGVs\r\nbG8=')).toEqual([{ k: 'ws', n: 2 }]);
    expect(notes('  aGVsbG8=\n')).toEqual([]);
    expect(notes('data:image/png;base64,iVBORw==')).toEqual([{ k: 'dataUrl', mime: 'image/png' }]);
    expect(notes('data:;base64,QQ==')).toEqual([{ k: 'dataUrl', mime: '' }]);
    // "QR==" decodes like "QQ==" but has non-zero bits after the last byte.
    expect(notes('QR==')).toEqual([{ k: 'bits' }]);
    expect(Array.from(b64decode('QR==')!.bytes)).toEqual([65]);
    expect(notes('QUJ=')).toEqual([{ k: 'bits' }]);
    expect(b64decode(' \n ')).toBeNull();
  });

  it('refuses what it cannot read, with the position', () => {
    const err = (s: string) => { try { b64decode(s); return null; } catch (e) { const x = e as B64Error; return [x.code, x.pos, x.ch]; } };
    expect(err('aGV*bG8=')).toEqual(['char', 3, '*']);
    expect(err('aGVs bG8=')).toEqual(['char', 4, ' ']);
    expect(err('aGVs😀')).toEqual(['char', 4, '😀']);
    expect(err('ab+/ab-_')).toEqual(['mixed', 6, '']);
    expect(err('ab-_ab+/')).toEqual(['mixed', 6, '']);
    expect(err('QQ==QQ==')).toEqual(['pad', 2, '']);
    // "=" in the middle even where the total count would fit.
    expect(err('QQ=Q')).toEqual(['pad', 2, '']);
    expect(err('QUI=QUI=')).toEqual(['pad', 3, '']);
    expect(err('QQ=')).toEqual(['pad', 2, '']);
    expect(err('QUJD=')).toEqual(['pad', 4, '']);
    expect(err('QQ===')).toEqual(['pad', 2, '']);
    expect(err('aGVsb')).toEqual(['len', 4, '']);
    expect(err('data:text/plain,hello')).toEqual(['char', 4, ':']);
  });

  it('agrees with Buffer on random text that is valid Base64', () => {
    const r = rng(5), A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let t = 0; t < 2000; t++) {
      let s = Array.from({ length: Math.floor(r() * 30) }, () => A[Math.floor(r() * 64)]).join('');
      if (s.length % 4 === 1) s = s.slice(1);
      const ours = b64decode(s);
      expect(Array.from(ours?.bytes ?? [])).toEqual(Array.from(Buffer.from(s, 'base64')));
    }
  });

  it('recognises common file types and dumps bytes', () => {
    expect(sniff(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0]))?.ext).toBe('png');
    expect(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg');
    expect(sniff(utf8('GIF89a...'))?.ext).toBe('gif');
    expect(sniff(utf8('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp');
    expect(sniff(utf8('%PDF-1.7'))?.ext).toBe('pdf');
    expect(sniff(utf8('hello'))).toBeNull();
    expect(hexDump(Uint8Array.from([...utf8('Hello, world!\n\0\x7f'), 0x80]))).toBe('00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a 00 7f  |Hello, world!...|\n00000010  80                                                |.|');
    expect(hexDump(new Uint8Array(100), 32).split('\n')).toHaveLength(2);
  });
});

describe('text → bytes', () => {
  it('UTF-8, with the line ending asked for; lone surrogates refused (never U+FFFD)', () => {
    expect(Array.from(textBytes('é\n', 'lf')!)).toEqual([0xc3, 0xa9, 10]);
    expect(Array.from(textBytes('a\nb\n', 'crlf')!)).toEqual([97, 13, 10, 98, 13, 10]);
    expect(textBytes('a\ud800', 'lf')).toBeNull();
    expect(textBytes('\udc00', 'crlf')).toBeNull();
    expect(Array.from(textBytes('😀', 'lf')!)).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });
  it('pasted CRLF / CR become LF, and that is reported', () => {
    expect(normEol('a\r\nb\rc\n')).toEqual({ text: 'a\nb\nc\n', cr: true });
    expect(normEol('a\nb')).toEqual({ text: 'a\nb', cr: false });
  });
  it('sizes', () => {
    expect(bytesLabel(1023)).toBe('1023 B');
    expect(bytesLabel(1536)).toBe('1.5 KB');
    expect(bytesLabel(25 * 1024 * 1024)).toBe('25.0 MB');
    expect(bytesLabel(3 * 1024 ** 3)).toBe('3.00 GB');
  });
});
