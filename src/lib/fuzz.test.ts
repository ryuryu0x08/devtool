// Randomized property tests: the parsers, the lossless formatters, verification and the diff.
import { describe, expect, it } from 'vitest';
import { ConvertError, DateTime, Num, canon, diffNode, isObj, numKey, wellFormed, type DiffNode, type Obj } from './data';
import { astEqual, jsonValue, parseJsonAst, printJson, sortAst, toJsonText } from './json';
import { VerifyError, formatToml, parseTomlDoc, smolParse, toTomlText, verifyToml } from './toml';

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const picker = (r: () => number) => <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];

// ---------- JSON ----------

const KEYS = ['a', 'b', 'id', 'name', 'x y', 'a.b', '', 'constructor', '__proto__', 'toString', '中文', 'é', '"q"', 'tab\t', '0', '\ud800'];
const RAW_KEYS = [...KEYS.map((k) => JSON.stringify(k)), '"\\u0061"', '"\\/x"', '"\\u4e2d\\u6587"', '"x\\u0020y"', '"\\uD83D\\uDE00"'];
const STRS = ['"\\ud800"', '""', '"hello"', '"line\\nbreak"', '"quote\\"back\\\\slash"', '"\\u00e9"', '"é"', '"\\/"', '"\\uD83D\\uDE00"', '"😀"', '"\\u0000\\u001f"', '"中文"', '"\\u2028"'];
const NUMS = ['0', '-0', '1', '-1', '1.5', '1.50', '1e3', '1E-7', '12345678901234567890', '-9007199254740993', '3.141592653589793238', '1e400', '0.1', '0.10000000000000000555', '42', '100'];

/** Random JSON text with varied whitespace; `dups` allows duplicate keys. */
function genJson(r: () => number, depth = 0, dups = false): string {
  const pick = picker(r);
  const k = r();
  if (depth > 4 || k < 0.45) {
    const t = r();
    return t < 0.3 ? pick(STRS) : t < 0.65 ? pick(NUMS) : t < 0.8 ? pick(['true', 'false']) : 'null';
  }
  const n = Math.floor(r() * 5);
  const ws = () => pick(['', ' ', '\n  ', '\t', '\r\n']);
  if (k < 0.7) return '[' + Array.from({ length: n }, () => ws() + genJson(r, depth + 1, dups)).join(',') + ws() + ']';
  // Keys as raw tokens, including non-canonical escapes ("\u0061" is the key "a").
  let keys = Array.from({ length: n }, () => pick(RAW_KEYS));
  if (!dups) keys = keys.filter((k, i) => keys.findIndex((x) => JSON.parse(x) === JSON.parse(k)) === i);
  return '{' + keys.map((key) => ws() + key + ws() + ':' + genJson(r, depth + 1, dups)).join(',') + '}';
}
const jv = (s: string) => jsonValue(parseJsonAst(s).ast);

/** JSON.parse result in our value model (numbers as text). */
function fromNative(v: unknown): unknown {
  if (typeof v === 'number') return new Num(String(v), 'float', 'json');
  if (Array.isArray(v)) return v.map(fromNative);
  if (v && typeof v === 'object') {
    const o: Obj = {};
    for (const k of Object.keys(v)) Object.defineProperty(o, k, { value: fromNative((v as Obj)[k]), enumerable: true });
    return o;
  }
  return v;
}

describe('fuzz: JSON', () => {
  it('accepts / rejects exactly what JSON.parse does', () => {
    const r = rng(1);
    const CH = ['{', '}', '[', ']', ',', ':', '"', '\\', '-', '.', 'e', '0', '1', ' ', 'n', 't', 'u', '\u0001', '\n'];
    for (let n = 0; n < 5000; n++) {
      let s = genJson(r, 0, r() < 0.3);
      const edits = Math.floor(r() * 3);
      for (let e = 0; e < edits; e++) {
        const p = Math.floor(r() * (s.length + 1));
        const op = r();
        if (op < 0.4) s = s.slice(0, p) + s.slice(p + 1);
        else if (op < 0.8) s = s.slice(0, p) + CH[Math.floor(r() * CH.length)] + s.slice(p);
        else s = s.slice(0, p) + s.slice(p + 1, p + 2) + s.slice(p, p + 1) + s.slice(p + 2);
      }
      let native = true, ours = true;
      try { JSON.parse(s); } catch { native = false; }
      try { parseJsonAst(s); } catch { ours = false; }
      if (native !== ours) throw new Error('disagree on ' + JSON.stringify(s) + ' native=' + native);
    }
  });

  it('values agree with JSON.parse wherever a double is exact', () => {
    const r = rng(2);
    for (let n = 0; n < 2000; n++) {
      const s = genJson(r);
      if (/12345678901234567890|9007199254740993|3\.141592653589793238|1e400|0\.10000000000000000555/.test(s)) continue;
      expect(canon(jv(s).v)).toBe(canon(fromNative(JSON.parse(s))));
    }
  });

  it('formatting changes whitespace only (tokens identical), also with duplicates and sorting', () => {
    const r = rng(3);
    for (let n = 0; n < 2000; n++) {
      const { ast } = parseJsonAst(genJson(r, 0, r() < 0.3));
      for (const sort of [false, true]) {
        const want = sort ? sortAst(ast) : ast;
        for (const ind of ['', 2, 4, '\t'] as const) {
          const text = printJson(want, ind);
          const back = parseJsonAst(text).ast;
          expect(astEqual(back, want)).toBe(true);
          expect(printJson(back, ind)).toBe(text);
        }
      }
    }
  });
});

// ---------- diff ----------

function rebuild(nd: DiffNode, side: 'a' | 'b'): unknown {
  const skip = side === 'a' ? 'add' : 'del';
  if (nd.ch) {
    const ch = nd.ch.filter((c) => c.st !== skip);
    if (nd.kind === 'arr') return ch.map((c) => rebuild(c, side));
    const o: Obj = {};
    ch.forEach((c) => Object.defineProperty(o, String(c.key), { value: rebuild(c, side), enumerable: true }));
    return o;
  }
  return side === 'a' ? nd.a : nd.b;
}

function mutate(v: unknown, r: () => number): unknown {
  if (Array.isArray(v)) {
    const out = v.map((x) => (r() < 0.3 ? mutate(x, r) : x));
    const ops = Math.floor(r() * 3);
    for (let k = 0; k < ops; k++) {
      const p = Math.floor(r() * (out.length + 1)), op = r();
      if (op < 0.4) out.splice(p, 0, jv(genJson(r, 3)).v);
      else if (op < 0.8) out.splice(p, 1);
      else if (out.length) out[p % out.length] = jv(genJson(r, 3)).v;
    }
    return out;
  }
  if (isObj(v)) {
    const o: Obj = {};
    for (const k of Object.keys(v)) {
      const t = r();
      if (t < 0.1) continue;
      Object.defineProperty(o, k, { value: t < 0.4 ? mutate(v[k], r) : v[k], enumerable: true, writable: true, configurable: true });
    }
    if (r() < 0.3) Object.defineProperty(o, KEYS[Math.floor(r() * KEYS.length)], { value: jv(genJson(r, 3)).v, enumerable: true, writable: true, configurable: true });
    return o;
  }
  return r() < 0.2 ? jv(genJson(r, 4)).v : v;
}

/** Resolve a `$.a[0]["x y"]` path. */
function at(root: unknown, path: string): unknown {
  let v = root;
  const re = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/g;
  let m: RegExpExecArray | null;
  let used = 1;
  while ((m = re.exec(path))) {
    used += m[0].length;
    const k = m[1] ?? (m[2] !== undefined ? +m[2] : JSON.parse(m[3]));
    v = Array.isArray(v) ? v[Number(k)] : Object.prototype.hasOwnProperty.call(v, k) ? (v as Obj)[String(k)] : undefined;
  }
  if (used !== path.length) throw new Error('bad path ' + path);
  return v;
}

describe('fuzz: diff', () => {
  it('"same" exactly when canonical values match; both sides can be rebuilt; every path resolves', () => {
    const r = rng(4);
    for (let n = 0; n < 3000; n++) {
      const A = jv(genJson(r));
      const b = r() < 0.5 ? mutate(A.v, r) : jv(genJson(r)).v;
      for (const io of [false, true]) {
        const d = diffNode(A.v, b, null, '$', { io });
        expect(d.st === 'same').toBe(canon(A.v, { io }) === canon(b, { io }));
        expect(canon(rebuild(d, 'a'), { io })).toBe(canon(A.v, { io }));
        expect(canon(rebuild(d, 'b'), { io })).toBe(canon(b, { io }));
        const walk = (nd: DiffNode) => {
          if (nd.st !== 'add') expect(canon(at(A.v, nd.path))).toBe(canon(nd.a));
          if (nd.st !== 'del') expect(canon(at(b, nd.pathB ?? nd.path))).toBe(canon(nd.b));
          nd.ch?.forEach(walk);
        };
        walk(d);
      }
    }
  });

  it('reports representation-only differences, and none for identical text', () => {
    const r = rng(7);
    const alt: Record<string, string> = { '1.50': '1.5', '1e3': '1000', '"\\u00e9"': '"é"', '"\\/"': '"/"' };
    let seen = 0;
    for (let n = 0; n < 1500; n++) {
      const s = genJson(r);
      const A = jv(s), A2 = jv(s);
      const same = diffNode(A.v, A2.v, null, '$', { rawA: A.raw, rawB: A2.raw });
      expect(same.st).toBe('same');
      expect(same.hasFmt).toBe(false);
      const from = Object.keys(alt).find((x) => s.includes(x));
      if (!from) continue;
      const B = jv(s.replace(from, alt[from]));
      const d = diffNode(A.v, B.v, null, '$', { rawA: A.raw, rawB: B.raw });
      // Same value written differently: not a change, but always visible.
      expect(d.st).toBe('same');
      expect(d.hasFmt).toBe(true);
      seen++;
    }
    expect(seen).toBeGreaterThan(200);
  });
});

// ---------- TOML ----------

const T_INT = ['42', '+42', '-17', '0x2A', '0xdead_BEEF', '0o52', '0b101010', '1_000', '0', '9223372036854775807', '-9223372036854775808'];
const T_FLOAT = ['1.0', '3.14159265358979323846', '1e3', '6.02E+23', '-0.0', '+0.0', 'inf', '-inf', 'nan', '+nan', '1_000.5', '0.1', '5e-324', '1.7976931348623157e308'];
const T_STR = ['""', '"basic \\u00e9 \\t \\x41 \\e"', "'C:\\path'", "''", '"""\nmulti\nline"""', '"""a \\\n   b"""', "'''\nraw \\n text'''", '"""quote "" inside"""', "'''x''''", '"中文 😀"', '"\\U0001F600"'];
const T_DATE = ['1979-05-27T07:32:00Z', '1979-05-27 07:32:00.999999-07:00', '1979-05-27t07:32:00z', '1979-05-27T07:32:00', '1979-05-27', '07:32:00.123456', '07:32', '1979-05-27T07:32Z'];

/** Random valid TOML text in many styles; comments are numbered so their order is checked. */
function genToml(r: () => number): string {
  const pick = picker(r);
  let cn = 0;
  const com = () => '# c' + cn++ + pick(['', ' tail', ' 中文']);
  const ind = () => pick(['', '', '  ', '\t']);
  const eq = () => pick([' = ', '=', '  =  ', '\t= ']);
  const value = (d: number): string => {
    const t = r();
    if (t < 0.6 || d > 2) return pick([pick(T_INT), pick(T_FLOAT), pick(T_STR), pick(T_DATE), pick(['true', 'false'])]);
    if (t < 0.82) {
      const items = Array.from({ length: Math.floor(r() * 4) }, () => value(d + 1));
      if (r() < 0.4) {
        // Multi-line array with comments.
        return '[' + (r() < 0.3 ? ' ' + com() : '') + '\n'
          + items.map((v) => (r() < 0.3 ? '  ' + com() + '\n' : '') + '  ' + v + ',' + (r() < 0.3 ? ' ' + com() : '')).join('\n')
          + (r() < 0.3 ? '\n  ' + com() : '') + '\n]';
      }
      return '[' + items.join(pick([', ', ',', ' , '])) + (items.length && r() < 0.2 ? ',' : '') + ']';
    }
    const n = Math.floor(r() * 3);
    const ents = Array.from({ length: n }, (_, j) => (r() < 0.3 ? 'e' + j + '.x' : pick(['k', '"q k"', "'l.k'"]).replace(/k|q k|l\.k/, (m) => m + j)) + ' = ' + value(d + 1));
    if (n && r() < 0.3) return '{\n' + ents.map((e) => '  ' + e + ',' + (r() < 0.4 ? ' ' + com() : '')).join('\n') + '\n}';
    return n ? '{ ' + ents.join(', ') + ' }' : '{}';
  };
  const kvs = (prefix: string) => {
    const out: string[] = [];
    const n = Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      if (r() < 0.25) out.push(ind() + com());
      if (r() < 0.15) out.push('');
      const key = r() < 0.2 ? prefix + 'd' + i + '.x.y' : pick([prefix + 'k' + i, '"' + prefix + ' q' + i + '"', "'" + prefix + '.l' + i + "'"]);
      out.push(ind() + key + eq() + value(0) + (r() < 0.3 ? ' ' + com() : ''));
    }
    return out;
  };
  const lines: string[] = [];
  if (r() < 0.3) lines.push(com(), '');
  lines.push(...kvs(''));
  const nt = Math.floor(r() * 3);
  for (let t = 0; t < nt; t++) {
    if (r() < 0.5) lines.push('');
    lines.push(ind() + '[t' + t + ']' + (r() < 0.3 ? ' ' + com() : ''), ...kvs('t'));
    if (r() < 0.4) lines.push('[ t' + t + ' . sub ]', ...kvs('s'));
  }
  const na = Math.floor(r() * 3);
  for (let a = 0; a < na; a++) {
    lines.push('[[arr]]' + (r() < 0.3 ? ' ' + com() : ''), ...kvs('a'));
    if (r() < 0.4) lines.push('[arr.child]', ...kvs('c'));
  }
  if (r() < 0.3) lines.push(com());
  return lines.join(pick(['\n', '\r\n'])) + (r() < 0.7 ? '\n' : '');
}

describe('fuzz: TOML', () => {
  it('generated documents are valid TOML (generator sanity)', () => {
    const r = rng(10);
    for (let n = 0; n < 300; n++) {
      const s = genToml(r);
      try { smolParse(s); } catch (e) { throw new Error('generator produced invalid TOML:\n' + s + '\n' + (e as Error).message); }
    }
  });

  it('formatting keeps every value, literal and comment; output is stable', () => {
    const r = rng(11);
    for (let n = 0; n < 2000; n++) {
      const s = genToml(r);
      const doc = parseTomlDoc(s);
      for (const sort of [false, true]) {
        const out = formatToml(doc, sort);
        try { verifyToml(doc, out, sort); } catch (e) { throw new Error('verify failed (sort=' + sort + '):\n' + s + '\n---\n' + out + '\n' + (e as Error).message); }
        expect(formatToml(parseTomlDoc(out), sort)).toBe(out);
      }
    }
  });

  it('verification catches any rewritten literal or dropped comment', () => {
    const r = rng(12);
    const rewrites: [RegExp, string][] = [
      [/0x2A/, '42'], [/(?<![\d.])1\.0(?![\d_eE])/, '1'], [/3\.14159265358979323846/, '3.141592653589793'], [/07:32:00\.123456/, '07:32:00.123'],
      [/'C:\\path'/, '"C:\\\\path"'], [/1979-05-27 07:32/, '1979-05-27T07:32'], [/# c\d+[^\n]*/, ''], [/\+42/, '42'], [/1_000(?![._\d])/, '1000'],
    ];
    let caught = 0;
    for (let n = 0; n < 1500; n++) {
      const doc = parseTomlDoc(genToml(r));
      const out = formatToml(doc);
      for (const [from, to] of rewrites) {
        const bad = out.replace(from, to);
        if (bad === out) continue;
        expect(() => verifyToml(doc, bad, false)).toThrow(VerifyError);
        caught++;
      }
    }
    expect(caught).toBeGreaterThan(1000);
  });

  it('diff of a document against its formatted output: identical, nothing written differently', () => {
    const r = rng(13);
    for (let n = 0; n < 500; n++) {
      const A = parseTomlDoc(genToml(r));
      const B = parseTomlDoc(formatToml(A));
      const d = diffNode(A.value, B.value, null, '$', { typed: true, rawA: A.raw, rawB: B.raw });
      expect(d.st).toBe('same');
      expect(d.hasFmt).toBe(false);
    }
  });
});

// ---------- conversion ----------

/** Date-times as the strings JSON gets. */
const datesToStrings = (v: unknown): unknown =>
  v instanceof DateTime ? v.raw : Array.isArray(v) ? v.map(datesToStrings)
    : isObj(v) ? Object.fromEntries(Object.keys(v).map((k) => [k, datesToStrings(v[k])])) : v;

/** Last key of a path, for errors about a key rather than a value. */
const lastKey = (path: string) => { const m = /(?:\.([A-Za-z_$][\w$]*)|\[("(?:[^"\\]|\\.)*")\])$/.exec(path); return m ? m[1] ?? JSON.parse(m[2]) : ''; };

describe('fuzz: conversion', () => {
  it('JSON → TOML: the result parses back to exactly the same data, or is refused for a reason that holds', () => {
    const r = rng(20);
    let ok = 0, refused = 0;
    for (let n = 0; n < 4000; n++) {
      const v = jv(genJson(r)).v;
      if (!isObj(v)) continue;
      let text: string;
      try { text = toTomlText(v); } catch (e) {
        if (!(e instanceof ConvertError)) throw e;
        const x = at(v, e.path);
        const reason: Record<string, () => boolean> = {
          null: () => x === null,
          intRange: () => x instanceof Num && x.kind === 'int' && (BigInt(x.raw) >= 2n ** 63n || BigInt(x.raw) < -(2n ** 63n)),
          floatRange: () => x instanceof Num && x.kind === 'float' && !isFinite(Number(x.raw)),
          floatPrecision: () => x instanceof Num && x.kind === 'float' && numKey(String(Number(x.raw))) !== numKey(x),
          badString: () => (typeof x === 'string' && !wellFormed(x)) || !wellFormed(lastKey(e.path)),
        };
        if (!reason[e.code]?.()) throw new Error(e.code + ' at ' + e.path + ' does not hold');
        refused++;
        continue;
      }
      expect(canon(parseTomlDoc(text).value)).toBe(canon(v));
      ok++;
    }
    expect(ok).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(200);
  });

  it('TOML → JSON: the result parses back to the same data (dates as strings, all reported), or nan/inf is refused', () => {
    const r = rng(21);
    let ok = 0, refused = 0;
    for (let n = 0; n < 2000; n++) {
      const doc = parseTomlDoc(genToml(r));
      const dates: string[] = [];
      let text: string;
      try { text = toJsonText(doc.value, 2, dates); } catch (e) {
        if (!(e instanceof ConvertError) || e.code !== 'nanInf') throw e;
        const x = at(doc.value, e.path);
        expect(x instanceof Num && /inf|nan/.test(x.raw)).toBe(true);
        refused++;
        continue;
      }
      expect(canon(jv(text).v)).toBe(canon(datesToStrings(doc.value)));
      // Every date-time that became a string was reported.
      let count = 0;
      const walk = (x: unknown) => { if (x instanceof DateTime) count++; else if (Array.isArray(x)) x.forEach(walk); else if (isObj(x)) Object.values(x).forEach(walk); };
      walk(doc.value);
      expect(dates.length).toBe(count);
      ok++;
    }
    expect(ok).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(50);
  });
});
