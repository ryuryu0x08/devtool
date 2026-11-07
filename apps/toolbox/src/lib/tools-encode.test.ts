// Encoding tools, checked against reference implementations: the JS engine, Buffer, zlib, bash.
import { spawnSync } from 'node:child_process';
import { gunzipSync, gzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { UrlError, looksPercent, parseUrl, urlDecode, urlEncode, withParams } from './url';
import { UniError, charTable, escapeUnicode, looksUniEscaped, unescapeUnicode } from './unicode';
import { decodeHtml, encodeHtml, looksHtmlEscaped } from './htmlent';
import { HexError, bytesToHex, hexToBytes, looksHex } from './hex';
import { NumError, readInt, widths, writeInt } from './numbase';
import { ZTooBig, compress, decompress, sniffZ } from './gzip';
import { EscError, escapeStr, unescapeStr, type EscLang } from './escape';
import { JwtError, decodeJwt, looksJwt, times, verifyJwt } from './jwt';

const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
/** Random text with ASCII, controls, CJK, emoji, quotes and backslashes. */
const randText = (r: () => number, n: number) => {
  const pool = ['a', 'Z', '0', ' ', '\n', '\t', '\r', '"', "'", '\\', '$', '`', '/', '%', '+', '&', '<', '中', 'é', '😀', ' ', '\x01', '\x7f', '#', '?', '=', '!', '*'];
  return Array.from({ length: n }, () => pool[Math.floor(r() * pool.length)]).join('');
};

describe('URL encoding', () => {
  it('encodes like the platform', () => {
    const r = rng(1);
    for (let i = 0; i < 300; i++) {
      const s = randText(r, i % 30);
      expect(urlEncode(s, 'component')).toBe(encodeURIComponent(s));
      expect(urlEncode(s, 'uri')).toBe(encodeURI(s));
      expect(new URLSearchParams('a=' + urlEncode(s, 'form')).get('a')).toBe(s);
      expect(urlDecode(urlEncode(s, 'component')!, false).text).toBe(s);
      expect(urlDecode(urlEncode(s, 'form')!, true).text).toBe(s);
    }
    expect(urlEncode('a b&c', 'form')).toBe('a+b%26c');
    expect(urlEncode('\ud800', 'component')).toBeNull();
  });
  it('decodes strictly, with the position of a bad %', () => {
    expect(urlDecode('%E4%B8%AD%E6%96%87', false)).toEqual({ text: '中文', plus: 0 });
    expect(urlDecode('a+b', false)).toEqual({ text: 'a+b', plus: 1 });
    expect(urlDecode('a+b', true)).toEqual({ text: 'a b', plus: 1 });
    const err = (s: string) => { try { urlDecode(s, false); return null; } catch (e) { return [(e as UrlError).code, (e as UrlError).pos]; } };
    expect(err('100%')).toEqual(['pct', 3]);
    expect(err('a%zz')).toEqual(['pct', 1]);
    // GBK bytes: not UTF-8, decoded as GB18030 and labelled.
    expect(urlDecode('%D6%D0%CE%C4', false)).toEqual({ text: '中文', enc: 'GB18030', plus: 0 });
    expect(err('ok%FF%FF')).toEqual(['utf8', 2]);
  });
  it('recognises percent-encoded text', () => {
    expect(looksPercent('%E4%B8%AD')).toBe(true);
    expect(looksPercent('100% sure')).toBe(false);
    expect(looksPercent('hello')).toBe(false);
  });
});

describe('large input stays fast', () => {
  const text = 'héllo wörld 中文 😀 a+b;'.repeat(150000); // about 4 MB
  it('URL decoding a few MB (it took seconds, one character at a time)', () => {
    const t0 = performance.now();
    expect(urlDecode(encodeURIComponent(text), false).text).toBe(text);
    expect(urlDecode(text + '%20', true).text).toBe(text.replace(/\+/g, ' ') + ' ');
    expect(performance.now() - t0).toBeLessThan(2500);
  }, 30000);
  it('hex of a 10 MB file and back', () => {
    const b = Uint8Array.from({ length: 10e6 }, (_, i) => (i * 7) & 255);
    const t0 = performance.now();
    const h = bytesToHex(b, ' ', true, '');
    expect(h.length).toBe(30e6 - 1);
    expect(Buffer.from(hexToBytes(h)!).equals(Buffer.from(b))).toBe(true);
    expect(performance.now() - t0).toBeLessThan(5000);
  }, 30000);
});

describe('URL parsing', () => {
  it('splits a URL; keeps duplicate and empty parameters in order', () => {
    const p = parseUrl('https://user:pw@例子.com:8443/a%20b/c?x=1&y=%E4%B8%AD&x=2&empty=&flag#frag')!;
    expect(p.url.hostname).toBe('xn--fsqu00a.com');
    expect(p.url.port).toBe('8443');
    expect(p.url.username).toBe('user');
    expect(p.params).toEqual([['x', '1'], ['y', '中'], ['x', '2'], ['empty', ''], ['flag', '']]);
    expect(p.url.hash).toBe('#frag');
    expect(p.normalized).toBe('https://user:pw@xn--fsqu00a.com:8443/a%20b/c?x=1&y=%E4%B8%AD&x=2&empty=&flag#frag');
  });
  it('no scheme: read as https and said so; non-URLs are null', () => {
    expect(parseUrl('example.com/a?b=1')!.assumed).toBe(true);
    expect(parseUrl('hello world')).toBeNull();
    expect(parseUrl('')).toBeNull();
  });
  it('rebuilds the query from edited parameters', () => {
    const p = parseUrl('https://a.com/p?x=1&y=2#h')!;
    expect(withParams(p.url, [['x', '1 2'], ['z', '中']])).toBe('https://a.com/p?x=1+2&z=%E4%B8%AD#h');
  });
});

describe('Unicode escapes', () => {
  it('round trip in every format, including astral characters', () => {
    const r = rng(2);
    for (let i = 0; i < 200; i++) {
      const s = randText(r, i % 25).replace(/\\/g, '');
      for (const fmt of ['u4', 'ubrace', 'html'] as const) {
        expect(unescapeUnicode(escapeUnicode(s, fmt, false)).text).toBe(s);
        expect(unescapeUnicode(escapeUnicode(s, fmt, true)).text).toBe(s);
      }
    }
    expect(escapeUnicode('中😀a', 'u4', false)).toBe('\\u4E2D\\uD83D\\uDE00a');
    expect(escapeUnicode('😀', 'ubrace', false)).toBe('\\u{1F600}');
    expect(escapeUnicode('中a', 'cp', true)).toBe('U+4E2D U+0061');
    // The JS engine agrees.
    expect(new Function('return "' + escapeUnicode('中😀\n', 'u4', true) + '"')()).toBe('中😀\n');
  });
  it('reads U+ lists, \\U, &#…; and leaves escaped backslashes alone', () => {
    expect(unescapeUnicode('U+4E2D U+6587').text).toBe('中文');
    expect(unescapeUnicode('\\U0001F600 &#20013;&#x6587;').text).toBe('😀 中文');
    expect(unescapeUnicode('a\\\\u0041').text).toBe('a\\\\u0041');
    expect(() => unescapeUnicode('x\\u12G4')).toThrow(UniError);
    expect(looksUniEscaped('\\u4e2d')).toBe(true);
    expect(looksUniEscaped('plain')).toBe(false);
  });
  it('character table', () => {
    expect(charTable('中😀')).toEqual([{ ch: '中', cp: 'U+4E2D', utf8: 'E4 B8 AD', utf16: '4E2D' }, { ch: '😀', cp: 'U+1F600', utf8: 'F0 9F 98 80', utf16: 'D83D DE00' }]);
  });
});

describe('HTML entities', () => {
  it('encode / decode', () => {
    expect(encodeHtml(`<a href="x">Tom & 'Jerry'</a>`, 'min')).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
    expect(encodeHtml('中 & ©', 'nonascii')).toBe('&#x4e2d; &amp; &copy;');
    expect(decodeHtml('&lt;b&gt; &amp;amp; &#x4e2d;&#25991; &copy; &nbsp;').text).toBe('<b> &amp; 中文 ©  ');
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const s = randText(r, i % 25);
      for (const m of ['min', 'nonascii', 'named'] as const) expect(decodeHtml(encodeHtml(s, m)).text).toBe(s);
    }
  });
  it('legacy entities without ";" are left as written and counted', () => {
    expect(decodeHtml('a &amp b &copy; c')).toEqual({ text: 'a &amp b © c', legacy: 1, n: 1 });
    expect(looksHtmlEscaped('Tom &amp; Jerry')).toBe(true);
    expect(looksHtmlEscaped('<b>&amp;</b>')).toBe(false);
  });
});

describe('hex', () => {
  it('both ways, every spelling', () => {
    const b = Uint8Array.from([0, 1, 0xab, 0xff]);
    expect(bytesToHex(b, '', false, '')).toBe('0001abff');
    expect(bytesToHex(b, ' ', true, '0x')).toBe('0x00 0x01 0xAB 0xFF');
    expect(bytesToHex(b, '', false, '\\x')).toBe('\\x00\\x01\\xab\\xff');
    for (const s of ['0001abff', '00 01 AB FF', '0x00, 0x01, 0xab, 0xff', '\\x00\\x01\\xab\\xff', '00:01:ab:ff', '0001\nABFF']) {
      expect(Array.from(hexToBytes(s)!)).toEqual([0, 1, 0xab, 0xff]);
    }
  });
  it('refuses odd digit counts and non-hex, with the position', () => {
    const err = (s: string) => { try { hexToBytes(s); return null; } catch (e) { return [(e as HexError).code, (e as HexError).pos]; } };
    expect(err('abc')).toEqual(['odd', 2]);
    expect(err('00 0g')).toEqual(['char', 4]);
    expect(looksHex('48 65 6c 6c 6f')).toBe(true);
    expect(looksHex('cafe')).toBe(true);
    expect(looksHex('hello')).toBe(false);
  });
});

describe('number bases', () => {
  it('reads and writes any base exactly, at any size', () => {
    const r = rng(4);
    for (let i = 0; i < 300; i++) {
      const v = BigInt(Math.floor(r() * 2 ** 53)) * BigInt(Math.floor(r() * 2 ** 40)) * (r() < 0.3 ? -1n : 1n);
      for (const b of [2, 8, 10, 16, 36]) {
        expect(readInt(writeInt(v, b), b).v).toBe(v);
        expect(writeInt(v, b)).toBe((v < 0n ? '-' : '') + (v < 0n ? -v : v).toString(b));
      }
    }
    expect(readInt('0xFF', 'auto')).toEqual({ v: 255n, base: 16 });
    expect(readInt('0b1010', 'auto')).toEqual({ v: 10n, base: 2 });
    expect(readInt('0o17', 'auto')).toEqual({ v: 15n, base: 8 });
    expect(readInt('1_000_000', 'auto').v).toBe(1000000n);
    expect(readInt('1,234', 'auto').v).toBe(1234n);
    expect(readInt('-z', 36).v).toBe(-35n);
    expect(writeInt(0xdeadbeefn, 16, true)).toBe('dead beef');
    expect(writeInt(1234567n, 10, true)).toBe('1,234,567');
  });
  it('refuses fractions and wrong digits, with the position', () => {
    const err = (s: string, b: number | 'auto') => { try { readInt(s, b); return null; } catch (e) { return [(e as NumError).code, (e as NumError).pos]; } };
    expect(err('1.5', 'auto')).toEqual(['frac', 1]);
    expect(err('102', 2)).toEqual(['char', 2]);
    expect(err('0x', 'auto')).toEqual(['empty', 2]);
  });
  it('fixed widths: two’s complement both ways', () => {
    const w = (v: bigint) => widths(v).map((x) => [x.bits, x.unsigned, x.signed, x.hex]);
    expect(w(255n)[0]).toEqual([8, 255n, -1n, 'FF']);
    expect(w(-1n)[0]).toEqual([8, 255n, -1n, 'FF']);
    expect(w(-1n)[3]).toEqual([64, 18446744073709551615n, -1n, 'FFFFFFFFFFFFFFFF']);
    expect(w(128n).map((x) => x[0])).toEqual([8, 16, 32, 64, 128]);
    expect(w(-129n).map((x) => x[0])).toEqual([16, 32, 64, 128]);
  });
});

describe('gzip / deflate', () => {
  it('a result over the limit stops with its own error; a run no longer wanted stops', async () => {
    const bomb = gzipSync(Buffer.alloc(5_000_000));
    await expect(decompress(bomb, 'gzip', undefined, 1_000_000)).rejects.toBeInstanceOf(ZTooBig);
    expect((await decompress(bomb, 'gzip')).length).toBe(5_000_000);
    const stop = new AbortController();
    stop.abort();
    await expect(decompress(bomb, 'gzip', stop.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('agrees with zlib both ways', async () => {
    const r = rng(5);
    for (let i = 0; i < 20; i++) {
      const b = new TextEncoder().encode(randText(r, i * 50));
      expect(Buffer.from(gunzipSync(await compress(b, 'gzip')))).toEqual(Buffer.from(b));
      expect(Buffer.from(inflateSync(await compress(b, 'deflate')))).toEqual(Buffer.from(b));
      expect(Buffer.from(inflateRawSync(await compress(b, 'deflate-raw')))).toEqual(Buffer.from(b));
      expect(Buffer.from(await decompress(gzipSync(b), 'gzip'))).toEqual(Buffer.from(b));
    }
  });
  it('recognises the format; damaged data is an error, not partial output', async () => {
    expect(sniffZ(gzipSync(Buffer.from('x')))).toBe('gzip');
    expect(sniffZ(await compress(new Uint8Array([1]), 'deflate'))).toBe('deflate');
    expect(sniffZ(await compress(new Uint8Array([1]), 'deflate-raw'))).toBe('deflate-raw');
    const g = gzipSync(Buffer.from('hello world hello world'));
    await expect(decompress(g.subarray(0, g.length - 6), 'gzip')).rejects.toThrow();
  });
});

describe('string escaping', () => {
  const langs: EscLang[] = ['json', 'js', 'java', 'c', 'sql', 'shell'];
  it('every language: unescape(escape(s)) = s', () => {
    const r = rng(6);
    for (let i = 0; i < 300; i++) {
      const s = randText(r, i % 30);
      for (const l of langs) expect(unescapeStr(escapeStr(s, l), l).text, l + ' ' + JSON.stringify(s)).toBe(s);
    }
  });
  it('JSON and JavaScript: the engines read the escapes back to the same text', () => {
    const r = rng(7);
    for (let i = 0; i < 200; i++) {
      const s = randText(r, i % 30);
      expect(JSON.parse('"' + escapeStr(s, 'json') + '"')).toBe(s);
      expect(new Function('return "' + escapeStr(s, 'js') + '"')()).toBe(s);
      expect(new Function("return '" + escapeStr(s, 'js') + "'")()).toBe(s);
    }
    // And our reader agrees with JSON.parse on escapes it didn't write.
    expect(unescapeStr('\\u00e9\\/\\b', 'json').text).toBe(JSON.parse('"\\u00e9\\/\\b"'));
    expect(unescapeStr('\\x41\\u{1F600}\\0\\v', 'js').text).toBe('A😀\0\v');
  });
  it('shell: bash prints exactly the original text', () => {
    const r = rng(8);
    for (let i = 0; i < 60; i++) {
      const s = randText(r, 1 + (i % 20)).replace(/\0/g, '');
      const out = spawnSync('bash', ['-c', 'printf %s ' + escapeStr(s, 'shell')], { encoding: 'utf8' });
      expect(out.stdout).toBe(s);
    }
  });
  it('shell: reading words as bash does', () => {
    for (const w of [`'it'\\''s'`, `"a \\"b\\" \\$c"`, `$'tab\\there\\n'`, 'plain\\ word', `"mix"'ed'\\!`]) {
      const bash = spawnSync('bash', ['-c', 'printf %s ' + w], { encoding: 'utf8' }).stdout;
      expect(unescapeStr(w, 'shell').text, w).toBe(bash);
    }
    expect(unescapeStr('a b  c', 'shell')).toEqual({ text: 'a\nb\nc', words: 3 });
    const err = (s: string) => { try { unescapeStr(s, 'shell'); return null; } catch (e) { return [(e as EscError).code, (e as EscError).pos]; } };
    expect(err('"$HOME"')).toEqual(['expand', 1]);
    expect(err('a | b')).toEqual(['op', 2]);
    expect(err("'open")).toEqual(['quote', 0]);
    expect(() => escapeStr('a\0b', 'shell')).toThrow(EscError);
  });
  it('C: octal / hex escapes are bytes, read as UTF-8', () => {
    expect(unescapeStr('\\344\\270\\255\\x41\\a\\?', 'c').text).toBe('中A\x07?');
    expect(escapeStr('\x01\x07\0"??', 'c')).toBe('\\001\\a\\000\\"?\\?');
    expect(() => unescapeStr('\\xff', 'c')).toThrow(EscError);
  });
  it('Java: \\s, octal, \\u; unknown escapes are errors', () => {
    expect(unescapeStr('a\\sb\\101\\u4e2d', 'java').text).toBe('a bA中');
    expect(() => unescapeStr('\\q', 'java')).toThrow(EscError);
    expect(() => unescapeStr('\\v', 'java')).toThrow(EscError);
  });
  it('SQL: quotes doubled; a lone quote is an error', () => {
    expect(escapeStr("it's", 'sql')).toBe("it''s");
    expect(() => unescapeStr("it's", 'sql')).toThrow(EscError);
  });
});

describe('JWT', () => {
  const b64u = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const sign = async (header: object, payload: string, secret: string) => {
    const data = b64u(header) + '.' + b64u(payload);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return data + '.' + Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))).toString('base64url');
  };
  it('decodes header and payload with numbers as written', async () => {
    const t = await sign({ alg: 'HS256', typ: 'JWT' }, '{"sub":"1","id":12345678901234567890,"exp":1793000000}', 's3cret');
    const j = decodeJwt('Bearer ' + t);
    expect(j.alg).toBe('HS256');
    expect(j.payload.text).toBe('{\n  "sub": "1",\n  "id": 12345678901234567890,\n  "exp": 1793000000\n}');
    expect(times(j.payload.obj)).toEqual({ exp: 1793000000000, nbf: undefined, iat: undefined });
    expect(await verifyJwt(j, 's3cret')).toBe('ok');
    expect(await verifyJwt(j, 'wrong')).toBe('bad');
    expect(looksJwt(t)).toBe(true);
  });
  it('RS256 and ES256 with a PEM public key', async () => {
    for (const [alg, gen, signAlg] of [
      ['RS256', { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, 'RSASSA-PKCS1-v1_5'],
      ['ES256', { name: 'ECDSA', namedCurve: 'P-256' }, { name: 'ECDSA', hash: 'SHA-256' }],
    ] as const) {
      const kp = await crypto.subtle.generateKey(gen as RsaHashedKeyGenParams, true, ['sign', 'verify']) as CryptoKeyPair;
      const data = b64u({ alg }) + '.' + b64u({ a: 1 });
      const sig = Buffer.from(await crypto.subtle.sign(signAlg as AlgorithmIdentifier, kp.privateKey, new TextEncoder().encode(data))).toString('base64url');
      const spki = Buffer.from(await crypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
      const pem = '-----BEGIN PUBLIC KEY-----\n' + spki.match(/.{1,64}/g)!.join('\n') + '\n-----END PUBLIC KEY-----';
      const j = decodeJwt(data + '.' + sig);
      expect(await verifyJwt(j, pem), alg).toBe('ok');
      expect(await verifyJwt(decodeJwt(data + '.' + sig.slice(0, -4) + 'AAAA'), pem), alg).toBe('bad');
      expect(await verifyJwt(j, 'not a key'), alg).toBe('key');
    }
  });
  it('says which part is broken; encrypted tokens are recognised', () => {
    const code = (s: string) => { try { decodeJwt(s); return null; } catch (e) { return [(e as JwtError).code, (e as JwtError).part]; } };
    expect(code('a.b')).toEqual(['parts', 0]);
    expect(code('eyJhbGciOiJSU0EtT0FFUCJ9.a.b.c.d')).toEqual(['jwe', 0]);
    expect(code(b64u({ alg: 'none' }) + '.' + b64u('not json') + '.')).toEqual(['json', 1]);
    expect(code(b64u('[1]') + '.' + b64u({}) + '.')).toEqual(['obj', 0]);
  });
});
