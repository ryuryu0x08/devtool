// Value model shared by the formatter, converters and the semantic diff.
// Scalars keep their source text so nothing is ever rounded or rewritten.

export type Obj = Record<string, unknown>;

/** A number exactly as written (JSON or TOML syntax). Never converted to a JS number for storage. */
export class Num {
  constructor(readonly raw: string, readonly kind: 'int' | 'float', readonly src: 'json' | 'toml') {}
}

/** A TOML date / time literal exactly as written. */
export class DateTime {
  constructor(readonly raw: string) {}
}

export type CvCode = 'null' | 'nanInf' | 'badString' | 'intRange' | 'floatRange' | 'floatPrecision' | 'dupKey' | 'notObject';

/** Thrown when a value can't be represented exactly in the target format. */
export class ConvertError extends Error {
  constructor(readonly code: CvCode, readonly path: string, readonly detail = '') {
    super(code + ' at ' + path + (detail ? ': ' + detail : ''));
  }
}

/** Nesting beyond this is refused (the recursive tree / diff code would overflow the stack). */
export const MAX_DEPTH = 512;

/** Plain objects only — not arrays or value classes. */
export const isObj = (v: unknown): v is Obj => {
  if (v === null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};
export const isCont = (v: unknown): v is Obj | unknown[] => Array.isArray(v) || isObj(v);

/** Assign an own property, including `__proto__`, without touching the prototype. */
export function setKey(o: Obj, k: string, v: unknown) {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  else o[k] = v;
}

export const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
export const own = (o: Obj, k: string) => (hasOwn(o, k) ? o[k] : undefined);

export function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) {
    const o: Obj = {};
    Object.keys(v).sort().forEach((k) => setKey(o, k, sortDeep(v[k])));
    return o;
  }
  return v;
}

/** Number text without TOML's `_` separators and leading `+`. */
export const cleanNum = (raw: string) => raw.replace(/_/g, '').replace(/^\+/, '');

/** Exact canonical decimal of a number, so 1, 1.0, 1e0, +1, 0x1 and 1_0e-1 all compare equal. */
export function numKey(n: Num | string): string {
  let r = cleanNum(typeof n === 'string' ? n : n.raw);
  if (/^-?(inf|nan)$/.test(r)) return r.endsWith('nan') ? 'nan' : r[0] === '-' ? '-inf' : 'inf';
  if (/^0[xob]/.test(r)) r = BigInt(r).toString();
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(r);
  if (!m) return r;
  const frac = m[3] || '';
  let digits = ((m[2] || '') + frac).replace(/^0+/, '');
  if (!digits) return '0';
  let exp = (m[4] ? parseInt(m[4], 10) : 0) - frac.length;
  const t = /0*$/.exec(digits)![0].length;
  if (t) { digits = digits.slice(0, -t); exp += t; }
  return (m[1] ? '-' : '') + digits + 'e' + exp;
}

/** Canonical date / time: `T` separator, upper case, seconds present, no trailing fraction zeros, +00:00 → Z. */
export function dateKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/^(\d{4}-\d{2}-\d{2})[T ](?=\d)/, '$1T')
    .replace(/(^|T)(\d{2}:\d{2})(?!:)/, '$1$2:00')
    .replace(/\.(\d*?)0+(?=$|[Z+-])/, (_m, d: string) => (d ? '.' + d : ''))
    .replace(/\+00:00$/, 'Z');
}

export interface CmpOpts {
  /** Ignore array element order. */
  io?: boolean;
  /** Distinguish integers from floats (both sides TOML). */
  typed?: boolean;
}

/**
 * Canonical string of a value: object key order never matters; with `io` array
 * element order doesn't either. Types stay distinct ("1" ≠ 1).
 */
export function canon(v: unknown, o: CmpOpts = {}): string {
  if (v === null) return 'null';
  if (v instanceof Num) return 'n' + numKey(v) + (o.typed ? (v.kind === 'int' ? 'i' : 'f') : '');
  if (v instanceof DateTime) return 'd' + dateKey(v.raw);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const p = v.map((x) => canon(x, o));
    if (o.io) p.sort();
    return '[' + p.join(',') + ']';
  }
  if (isObj(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k], o)).join(',') + '}';
  return 'u' + String(v);
}

/** Append a key or index to a JSONPath-like path (`$.a[0]["x y"]`). */
export function cp(path: string, k: string | number, arr: boolean): string {
  if (arr) return path + '[' + k + ']';
  const s = String(k);
  return /^[A-Za-z_$][\w$]*$/.test(s) ? path + '.' + s : path + '[' + JSON.stringify(s) + ']';
}

/** Display text and color for a scalar (source text for numbers and dates). */
export function prim(v: unknown): [string, string] {
  if (v === null) return ['null', 'var(--faint)'];
  if (v instanceof Num) return [v.raw, 'var(--num)'];
  if (v instanceof DateTime) return [v.raw, 'var(--date)'];
  switch (typeof v) {
    case 'string': return [JSON.stringify(v), 'var(--str)'];
    case 'boolean': return [String(v), 'var(--bool)'];
    default: return [String(v), 'var(--ink)'];
  }
}

/** Compact one-line display of any value (numbers and dates as written). */
export function preview(v: unknown): string {
  const out = (x: unknown): string => {
    if (Array.isArray(x)) return '[' + x.map(out).join(',') + ']';
    if (isObj(x)) return '{' + Object.keys(x).map((k) => JSON.stringify(k) + ':' + out(x[k])).join(',') + '}';
    return prim(x)[0];
  };
  const s = out(v);
  return s.length > 90 ? s.slice(0, 88) + '…' : s;
}

export function stats(v: unknown): { n: number; d: number } {
  let n = 0, d = 0;
  const w = (x: unknown, dep: number) => {
    n++;
    if (dep > d) d = dep;
    if (isCont(x)) (Array.isArray(x) ? x : Object.values(x)).forEach((y) => w(y, dep + 1));
  };
  w(v, 0);
  return { n, d };
}

export const bytesLabel = (n: number) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');

export const byteLen = (s: string) => new TextEncoder().encode(s).length;

/** Strict UTF-8 decode (keeps a BOM so it can be reported); null if the bytes aren't valid UTF-8. */
export function decodeUtf8(bytes: ArrayBuffer | Uint8Array): string | null {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return null; }
}

export interface ErrInfo { msg: string; line: number | null; col: number | null; lineText: string; caret: string }

/** Extract line / column from parser errors and build a caret marker. */
export function errInfo(e: unknown, src: string): ErrInfo {
  let line: number | null = null, col: number | null = null;
  const err = e as { message?: string; line?: number; column?: number; pos?: number };
  const msg = String((err && err.message) || e);
  if (typeof err?.pos === 'number') {
    const pre = src.slice(0, err.pos);
    line = pre.split('\n').length;
    col = err.pos - pre.lastIndexOf('\n');
  } else if (err?.line) {
    line = err.line;
    col = err.column || null;
  }
  let lineText = '', caret = '';
  if (line) {
    // Tabs become single spaces so the caret lines up.
    const Ln = (src.split('\n')[line - 1] || '').replace(/[\t\r]/g, ' ');
    const c = Math.max(1, col || 1);
    const st = c > 60 ? c - 40 : 0;
    lineText = (st ? '…' : '') + Ln.slice(st, st + 110);
    caret = ' '.repeat(Math.max(0, c - 1 - st + (st ? 1 : 0))) + '^';
  }
  return { msg: msg.split('\n')[0], line, col, lineText, caret };
}

export type DiffSt = 'same' | 'add' | 'del' | 'chg' | 'mod';
export interface DiffNode {
  /** Key / index and path in A (in B for added nodes). */
  key: string | number | null;
  path: string;
  /** The same in B, which differs from A for array elements after insertions / removals. */
  keyB?: string | number | null;
  pathB?: string;
  st: DiffSt;
  a?: unknown;
  b?: unknown;
  kind?: 'obj' | 'arr';
  ch?: DiffNode[];
  /** Equal values written differently (e.g. 1.0 vs 1, 0xFF vs 255): source text of A and B. */
  fmt?: [string, string];
  /** This node or a descendant has `fmt`. */
  hasFmt?: boolean;
}

export interface DiffOpts extends CmpOpts {
  /** Source text of scalars by path, to report representation-only differences. */
  rawA?: Map<string, string>;
  rawB?: Map<string, string>;
}

/** Index pairs of equal elements (longest common subsequence after trimming shared ends). */
function lcsPairs(ka: string[], kb: string[]): [number, number][] {
  const n = ka.length, m = kb.length;
  let p = 0;
  while (p < n && p < m && ka[p] === kb[p]) p++;
  let q = 0;
  while (q < n - p && q < m - p && ka[n - 1 - q] === kb[m - 1 - q]) q++;
  const pairs: [number, number][] = [];
  for (let k = 0; k < p; k++) pairs.push([k, k]);
  const na = n - p - q, nb = m - p - q;
  // Large unaligned middles fall back to positional pairing.
  if (na && nb && na * nb <= 4e6) {
    const W = nb + 1;
    const L = new Int32Array((na + 1) * W);
    for (let i = na - 1; i >= 0; i--)
      for (let j = nb - 1; j >= 0; j--)
        L[i * W + j] = ka[p + i] === kb[p + j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < na && j < nb) {
      if (ka[p + i] === kb[p + j]) { pairs.push([p + i, p + j]); i++; j++; }
      else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < q; k++) pairs.push([n - q + k, m - q + k]);
  return pairs;
}

/**
 * Semantic diff. Object key order is ignored and numbers compare by exact value.
 * Arrays are aligned on equal elements (so an insertion doesn't mark everything after
 * it as changed); unmatched elements in between are compared pairwise. With `io`
 * array elements are matched as a multiset instead. Equal scalars whose source text
 * differs are flagged with `fmt` when raw maps are given.
 * Every node carries its location in A (`key`, `path`) and in B (`keyB`, `pathB`).
 */
export function diffNode(
  a: unknown, b: unknown, key: string | number | null, path: string, o: DiffOpts = {},
  keyB: string | number | null = key, pathB = path,
): DiffNode {
  if (a === undefined) return { key: keyB, path: pathB, keyB, pathB, st: 'add', b };
  if (b === undefined) return { key, path, keyB: key, pathB: path, st: 'del', a };
  const at = { key, path, keyB, pathB, a, b };
  const done = (n: DiffNode): DiffNode => {
    n.hasFmt = !!n.fmt || !!n.ch?.some((c) => c.hasFmt);
    return n;
  };
  if (isObj(a) && isObj(b)) {
    const ks = Object.keys(a);
    Object.keys(b).forEach((k) => { if (!hasOwn(a, k)) ks.push(k); });
    const ch = ks.map((k) => diffNode(own(a, k), own(b, k), k, cp(path, k, false), o, k, cp(pathB, k, false)));
    return done({ ...at, kind: 'obj', ch, st: ch.every((c) => c.st === 'same') ? 'same' : 'mod' });
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ch: DiffNode[] = [];
    const sub = (i: number | undefined, j: number | undefined) => {
      const ia = (i ?? j)!, jb = (j ?? i)!;
      ch.push(diffNode(i !== undefined ? a[i] : undefined, j !== undefined ? b[j] : undefined, ia, cp(path, ia, true), o, jb, cp(pathB, jb, true)));
    };
    const ka = a.map((x) => canon(x, o)), kb = b.map((x) => canon(x, o));
    if (o.io) {
      const pool = new Map<string, number[]>();
      kb.forEach((k, j) => { const l = pool.get(k); if (l) l.push(j); else pool.set(k, [j]); });
      const match = ka.map((k) => pool.get(k)?.shift());
      const used = new Set(match.filter((j) => j !== undefined));
      const free = b.map((_, j) => j).filter((j) => !used.has(j));
      let fi = 0;
      a.forEach((_, i) => sub(i, match[i] !== undefined ? match[i] : free[fi++]));
      for (; fi < free.length; fi++) sub(undefined, free[fi]);
    } else {
      let pi = 0, pj = 0;
      const gap = (ei: number, ej: number) => {
        for (let k = 0; k < Math.max(ei - pi, ej - pj); k++) sub(pi + k < ei ? pi + k : undefined, pj + k < ej ? pj + k : undefined);
      };
      for (const [i, j] of lcsPairs(ka, kb)) {
        gap(i, j);
        sub(i, j);
        pi = i + 1;
        pj = j + 1;
      }
      gap(a.length, b.length);
    }
    return done({ ...at, kind: 'arr', ch, st: ch.every((c) => c.st === 'same') ? 'same' : 'mod' });
  }
  const n: DiffNode = { ...at, st: canon(a, o) === canon(b, o) ? 'same' : 'chg' };
  if (n.st === 'same' && o.rawA && o.rawB) {
    const ra = o.rawA.get(path), rb = o.rawB.get(pathB);
    if (ra !== undefined && rb !== undefined && ra !== rb) n.fmt = [ra, rb];
  }
  return done(n);
}
