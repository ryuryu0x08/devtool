// Helpers for structured data: paths, previews, stats, parse errors and the semantic diff.

export type Obj = Record<string, unknown>;

/** A JSON number kept as its source text because a JS number would change it (big ints, `1.50`, `1e400`). */
export class JsonNum {
  constructor(readonly raw: string) {}
}

/** Thrown when a value can't be represented in the target format. */
export class ConvertError extends Error {
  constructor(readonly code: 'null' | 'nonFinite' | 'badString', readonly path: string) {
    super(code + ' at ' + path);
  }
}

/** Plain objects only — not arrays, dates (incl. TOML dates) or JsonNum. */
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

const own = (o: Obj, k: string) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

export function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) {
    const o: Obj = {};
    Object.keys(v).sort().forEach((k) => setKey(o, k, sortDeep(v[k])));
    return o;
  }
  return v;
}

/** Date text without a redundant `.000`. */
export const dateText = (d: Date) => d.toISOString().replace(/\.000(?=$|[Z+-])/, '');

const isNum = (v: unknown): v is number | bigint | JsonNum =>
  typeof v === 'number' || typeof v === 'bigint' || v instanceof JsonNum;

/** Exact canonical form of a numeric value, so 1, 1.0, 1e0 and 1n compare equal. */
export function numKey(x: number | bigint | JsonNum): string {
  if (typeof x === 'number' && !isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf';
  const raw = x instanceof JsonNum ? x.raw : String(x);
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m) return raw;
  const frac = m[3] || '';
  let digits = ((m[2] || '') + frac).replace(/^0+/, '');
  if (!digits) return '0';
  let exp = (m[4] ? parseInt(m[4], 10) : 0) - frac.length;
  const t = /0*$/.exec(digits)![0].length;
  if (t) { digits = digits.slice(0, -t); exp += t; }
  return (m[1] === '-' ? '-' : '') + digits + 'e' + exp;
}

/**
 * Canonical string of a value: object key order never matters; with `io` (ignore
 * order) array element order doesn't either. Types stay distinct ("1" ≠ 1).
 */
export function canon(v: unknown, io = false): string {
  if (v === null) return 'null';
  if (isNum(v)) return 'n' + numKey(v);
  if (v instanceof Date) return 'd' + dateText(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const p = v.map((x) => canon(x, io));
    if (io) p.sort();
    return '[' + p.join(',') + ']';
  }
  if (isObj(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k], io)).join(',') + '}';
  return 'u' + String(v);
}

/** Append a key or index to a JSONPath-like path (`$.a[0]["x y"]`). */
export function cp(path: string, k: string | number, arr: boolean): string {
  if (arr) return path + '[' + k + ']';
  const s = String(k);
  return /^[A-Za-z_$][\w$]*$/.test(s) ? path + '.' + s : path + '[' + JSON.stringify(s) + ']';
}

/** Text and color for a primitive value. */
export function prim(v: unknown): [string, string] {
  if (v === null) return ['null', 'var(--faint)'];
  if (v instanceof JsonNum) return [v.raw, 'var(--num)'];
  if (v instanceof Date) return [dateText(v), 'var(--date)'];
  switch (typeof v) {
    case 'string': return [JSON.stringify(v), 'var(--str)'];
    case 'number': case 'bigint': return [String(v), 'var(--num)'];
    case 'boolean': return [String(v), 'var(--bool)'];
    default: return [String(v), 'var(--ink)'];
  }
}

/** Serialize to JSON text. Numbers keep their source text; bigints are written as digits. */
export function stringifyJson(v: unknown, indent: string | number = '', lenient = false): string {
  const gap = typeof indent === 'number' ? ' '.repeat(Math.min(10, indent)) : indent;
  const out = (x: unknown, cur: string, path: string): string => {
    if (x === null || x === undefined) return 'null';
    if (x instanceof JsonNum) return x.raw;
    if (x instanceof Date) return JSON.stringify(dateText(x));
    switch (typeof x) {
      case 'string': return JSON.stringify(x);
      case 'boolean': case 'bigint': return String(x);
      case 'number':
        if (isFinite(x)) return String(x);
        if (lenient) return numKey(x);
        throw new ConvertError('nonFinite', path);
    }
    const inner = cur + gap;
    const wrap = (o: string, c: string, items: string[]) =>
      !items.length ? o + c : gap ? o + '\n' + inner + items.join(',\n' + inner) + '\n' + cur + c : o + items.join(',') + c;
    if (Array.isArray(x)) return wrap('[', ']', x.map((y, i) => out(y, inner, cp(path, i, true))));
    if (isObj(x)) return wrap('{', '}', Object.keys(x).map((k) => JSON.stringify(k) + (gap ? ': ' : ':') + out(x[k], inner, cp(path, k, false))));
    return JSON.stringify(String(x));
  };
  return out(v, '', '$');
}

export function preview(v: unknown): string {
  const s = stringifyJson(v, '', true);
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

export interface ErrInfo { msg: string; line: number | null; col: number | null; lineText: string; caret: string }

/** Extract line / column from parser errors and build a caret marker. */
export function errInfo(e: unknown, src: string, lang: 'json' | 'toml'): ErrInfo {
  let line: number | null = null, col: number | null = null;
  const err = e as { message?: string; line?: number; column?: number; pos?: number };
  const msg = String((err && err.message) || e);
  if (lang === 'toml') {
    line = err?.line || null;
    col = err?.column || null;
  } else {
    const m = msg.match(/position (\d+)/i);
    const pos = typeof err?.pos === 'number' ? err.pos : m ? +m[1] : null;
    if (pos != null) {
      const pre = src.slice(0, pos);
      line = pre.split('\n').length;
      col = pos - pre.lastIndexOf('\n');
    }
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
 * Semantic diff. Object key order is ignored and numbers compare by value. Arrays are
 * aligned on equal elements (so an insertion doesn't mark everything after it as
 * changed); unmatched elements in between are compared pairwise. With `io` (ignore
 * order) array elements are matched as a multiset instead.
 * Every node carries its location in A (`key`, `path`) and in B (`keyB`, `pathB`).
 */
export function diffNode(
  a: unknown, b: unknown, key: string | number | null, path: string, io: boolean,
  keyB: string | number | null = key, pathB = path,
): DiffNode {
  if (a === undefined) return { key: keyB, path: pathB, keyB, pathB, st: 'add', b };
  if (b === undefined) return { key, path, keyB: key, pathB: path, st: 'del', a };
  const at = { key, path, keyB, pathB, a, b };
  if (isObj(a) && isObj(b)) {
    const ks = Object.keys(a);
    Object.keys(b).forEach((k) => { if (!Object.prototype.hasOwnProperty.call(a, k)) ks.push(k); });
    const ch = ks.map((k) => diffNode(own(a, k), own(b, k), k, cp(path, k, false), io, k, cp(pathB, k, false)));
    return { ...at, kind: 'obj', ch, st: ch.every((c) => c.st === 'same') ? 'same' : 'mod' };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ch: DiffNode[] = [];
    const sub = (i: number | undefined, j: number | undefined) => {
      const ia = (i ?? j)!, jb = (j ?? i)!;
      ch.push(diffNode(i !== undefined ? a[i] : undefined, j !== undefined ? b[j] : undefined, ia, cp(path, ia, true), io, jb, cp(pathB, jb, true)));
    };
    const same = (i: number, j: number) =>
      ch.push({ key: i, path: cp(path, i, true), keyB: j, pathB: cp(pathB, j, true), st: 'same', a: a[i], b: b[j] });
    const ka = a.map((x) => canon(x, io)), kb = b.map((x) => canon(x, io));
    if (io) {
      const pool = new Map<string, number[]>();
      kb.forEach((k, j) => { const l = pool.get(k); if (l) l.push(j); else pool.set(k, [j]); });
      const match = ka.map((k) => pool.get(k)?.shift());
      const used = new Set(match.filter((j) => j !== undefined));
      const free = b.map((_, j) => j).filter((j) => !used.has(j));
      let fi = 0;
      a.forEach((_, i) => (match[i] !== undefined ? same(i, match[i]!) : sub(i, free[fi++])));
      for (; fi < free.length; fi++) sub(undefined, free[fi]);
    } else {
      let pi = 0, pj = 0;
      const gap = (ei: number, ej: number) => {
        for (let k = 0; k < Math.max(ei - pi, ej - pj); k++) sub(pi + k < ei ? pi + k : undefined, pj + k < ej ? pj + k : undefined);
      };
      for (const [i, j] of lcsPairs(ka, kb)) {
        gap(i, j);
        same(i, j);
        pi = i + 1;
        pj = j + 1;
      }
      gap(a.length, b.length);
    }
    return { ...at, kind: 'arr', ch, st: ch.every((c) => c.st === 'same') ? 'same' : 'mod' };
  }
  return { ...at, st: canon(a, io) === canon(b, io) ? 'same' : 'chg' };
}
