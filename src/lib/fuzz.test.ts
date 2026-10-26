// Randomized property tests for the JSON parser, serializers and the semantic diff.
import { describe, expect, it } from 'vitest';
import { canon, diffNode, isObj, stringifyJson, type DiffNode, type Obj } from './data';
import { parseJson } from './json';
import { parseToml, stringifyToml } from './toml';

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ['a', 'b', 'id', 'name', 'x y', 'a.b', '', 'constructor', '__proto__', 'toString', '中文', 'é', '"q"', 'tab\t', '0'];
const STRS = ['', 'hello', 'line\nbreak', 'quote"back\\slash', 'tab\tx', '\u0000\u001f\u007f', '中文', '😀', ' ', 'ünïcode', ' spaced '];
const NUMS = ['0', '-0', '1', '-1', '1.5', '1.50', '1e3', '1E-7', '12345678901234567890', '-9007199254740993', '3.141592653589793238', '1e400', '0.1', '42'];

function genJson(r: () => number, depth = 0): string {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const k = r();
  if (depth > 4 || k < 0.45) {
    const t = r();
    if (t < 0.3) return JSON.stringify(pick(STRS));
    if (t < 0.65) return pick(NUMS);
    if (t < 0.8) return pick(['true', 'false']);
    return 'null';
  }
  const n = Math.floor(r() * 5);
  const ws = () => pick(['', ' ', '\n  ', '\t']);
  if (k < 0.7) return '[' + Array.from({ length: n }, () => ws() + genJson(r, depth + 1)).join(',') + ws() + ']';
  const keys = Array.from({ length: n }, () => pick(KEYS));
  return '{' + [...new Set(keys)].map((key) => ws() + JSON.stringify(key) + ws() + ':' + genJson(r, depth + 1)).join(',') + '}';
}

/** Rebuild one side from a diff tree: proves nothing was lost and order is right. */
function rebuild(nd: DiffNode, side: 'a' | 'b'): unknown {
  const skip = side === 'a' ? 'add' : 'del';
  if (nd.st === 'mod') {
    const ch = nd.ch!.filter((c) => c.st !== skip);
    if (nd.kind === 'arr') return ch.map((c) => rebuild(c, side));
    const o: Obj = {};
    ch.forEach((c) => Object.defineProperty(o, String(c.key), { value: rebuild(c, side), enumerable: true }));
    return o;
  }
  return side === 'a' ? nd.a : nd.b;
}

/** Deep equality that also distinguishes TOML integers (bigint) from floats (number). */
function typedEq(x: unknown, y: unknown): boolean {
  if (typeof x !== typeof y) return false;
  if (typeof x === 'number') return Object.is(x, y) || (Number.isNaN(x) && Number.isNaN(y as number));
  if (Array.isArray(x)) return Array.isArray(y) && x.length === y.length && x.every((v, i) => typedEq(v, y[i]));
  if (x instanceof Date) return y instanceof Date && x.toISOString() === y.toISOString();
  if (isObj(x)) {
    if (!isObj(y)) return false;
    const kx = Object.keys(x).sort(), ky = Object.keys(y).sort();
    return kx.length === ky.length && kx.every((k, i) => k === ky[i] && typedEq(x[k], y[k]));
  }
  return x === y;
}

describe('fuzz: JSON parser', () => {
  it('accepts / rejects exactly what JSON.parse does', () => {
    const r = rng(1);
    const CH = ['{', '}', '[', ']', ',', ':', '"', '\\', '-', '.', 'e', '0', '1', ' ', 'n', 't', 'u', '\u0001', '\n'];
    for (let n = 0; n < 4000; n++) {
      let s = genJson(r);
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
      try { parseJson(s); } catch { ours = false; }
      if (native !== ours) throw new Error('disagree on ' + JSON.stringify(s) + ' native=' + native);
    }
  });

  it('agrees with JSON.parse on values whenever numbers are exactly representable', () => {
    const r = rng(2);
    for (let n = 0; n < 2000; n++) {
      const s = genJson(r);
      if (/12345678901234567890|9007199254740993|3\.141592653589793238|1e400/.test(s)) continue;
      expect(canon(parseJson(s))).toBe(canon(JSON.parse(s)));
    }
  });

  it('formats losslessly and idempotently', () => {
    const r = rng(3);
    for (let n = 0; n < 2000; n++) {
      const v = parseJson(genJson(r));
      for (const ind of ['', 2, '\t'] as const) {
        const text = stringifyJson(v, ind);
        const back = parseJson(text);
        expect(canon(back)).toBe(canon(v));
        expect(stringifyJson(back, ind)).toBe(text);
      }
    }
  });
});

describe('fuzz: semantic diff', () => {
  it('a diff can rebuild both sides, and is "same" exactly when canon matches', () => {
    const r = rng(4);
    for (let n = 0; n < 3000; n++) {
      const a = parseJson(genJson(r)), b = r() < 0.15 ? parseJson(stringifyJson(a)) : parseJson(genJson(r));
      for (const io of [false, true]) {
        const d = diffNode(a, b, null, '$', io);
        expect(d.st === 'same').toBe(canon(a, io) === canon(b, io));
        expect(canon(rebuild(d, 'a'), io)).toBe(canon(a, io));
        expect(canon(rebuild(d, 'b'), io)).toBe(canon(b, io));
      }
    }
  });
});

/** Random edits: insert / delete / replace array elements, add / drop / change keys. */
function mutate(v: unknown, r: () => number): unknown {
  if (Array.isArray(v)) {
    const out = v.map((x) => (r() < 0.3 ? mutate(x, r) : x));
    const ops = Math.floor(r() * 3);
    for (let k = 0; k < ops; k++) {
      const p = Math.floor(r() * (out.length + 1)), op = r();
      if (op < 0.4) out.splice(p, 0, parseJson(genJson(r, 3)));
      else if (op < 0.8) out.splice(p, 1);
      else if (out.length) out[p % out.length] = parseJson(genJson(r, 3));
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
    if (r() < 0.3) Object.defineProperty(o, KEYS[Math.floor(r() * KEYS.length)], { value: parseJson(genJson(r, 3)), enumerable: true, writable: true, configurable: true });
    return o;
  }
  return r() < 0.2 ? parseJson(genJson(r, 4)) : v;
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

describe('fuzz: diff of edited documents', () => {
  it('rebuilds both sides and every path points at the reported value', () => {
    const r = rng(6);
    for (let n = 0; n < 3000; n++) {
      const a = parseJson(genJson(r));
      const b = mutate(a, r);
      for (const io of [false, true]) {
        const d = diffNode(a, b, null, '$', io);
        expect(canon(rebuild(d, 'a'), io)).toBe(canon(a, io));
        expect(canon(rebuild(d, 'b'), io)).toBe(canon(b, io));
        const walk = (nd: DiffNode) => {
          if (nd.st !== 'add') expect(canon(at(a, nd.path))).toBe(canon(nd.a));
          if (nd.st !== 'del') expect(canon(at(b, nd.pathB ?? nd.path))).toBe(canon(nd.b));
          nd.ch?.forEach(walk);
        };
        walk(d);
      }
    }
  });
});

describe('fuzz: TOML', () => {
  const TK = ['a', 'b', 'k-1', 'x y', 'a.b', '', '中文', '"q"', 'constructor'];
  function genToml(r: () => number, depth = 0): Obj {
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const val = (d: number): unknown => {
      const t = r();
      if (t < 0.15) return pick(STRS);
      if (t < 0.3) return BigInt(pick(['0', '-1', '42', '9223372036854775807', '-9223372036854775808']));
      if (t < 0.45) return pick([0.5, -0.0, 1, 1e21, 1e-7, 3.25, NaN, Infinity, -Infinity, 100]);
      if (t < 0.55) return r() < 0.5;
      if (t < 0.7 && d < 3) return Array.from({ length: Math.floor(r() * 3) }, () => val(d + 1));
      if (t < 0.85 && d < 3) return genToml(r, d + 1);
      if (t < 0.95 && d < 3) return Array.from({ length: 1 + Math.floor(r() * 2) }, () => genToml(r, d + 1));
      return pick(STRS);
    };
    const o: Obj = {};
    const n = Math.floor(r() * 4);
    for (let i = 0; i < n; i++) o[pick(TK)] = val(depth);
    return o;
  }

  it('round-trips with integer / float types intact', () => {
    const r = rng(5);
    for (let n = 0; n < 2000; n++) {
      const v = genToml(r);
      const text = stringifyToml(v);
      let back: Obj;
      try { back = parseToml(text); } catch (e) { throw new Error('unparseable output:\n' + text + '\n' + (e as Error).message); }
      if (!typedEq(back, v)) throw new Error('round-trip changed value:\n' + text);
      expect(stringifyToml(back)).toBe(text);
    }
  });
});

