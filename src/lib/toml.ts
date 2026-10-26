// TOML (1.1) concrete syntax tree that keeps comments and every value as written,
// so formatting only ever changes whitespace. smol-toml is the reference parser:
// it validates the document and every value we build is cross-checked against it.
import * as TOML from 'smol-toml';
import { ConvertError, DateTime, MAX_DEPTH, Num, canon, cleanNum, cp, dateKey, hasOwn, isObj, numKey, own, setKey, type Obj } from './data';

export class TomlSyntaxError extends SyntaxError {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

/** Our tree disagrees with the reference parser — refuse rather than risk changing data. */
export class TomlMismatch extends Error {
  constructor(readonly path: string) {
    super('Parser mismatch at ' + path);
  }
}

/** Formatted output didn't re-parse to the identical document. */
export class VerifyError extends Error {
  constructor(readonly path: string) {
    super('Verification failed at ' + path);
  }
}

interface Key { raw: string; k: string }
type TVal =
  | { t: 'scalar'; raw: string; v: unknown }
  | { t: 'arr' | 'itab'; items: Part[]; end: string[]; ml: boolean };
/** Array element or inline-table entry with the comments around it. */
interface Part { key?: Key[]; v: TVal; before: string[]; after?: string }
type Item =
  | { t: 'blank' }
  | { t: 'comment'; text: string }
  | { t: 'table'; aot: boolean; key: Key[]; comment?: string }
  | { t: 'kv'; key: Key[]; v: TVal; comment?: string };

export interface TomlDoc {
  items: Item[];
  value: Obj;
  /** Source text of every scalar by path. */
  raw: Map<string, string>;
  /** Source text of every key by path (where it is first written). */
  keys: Map<string, string>;
  comments: string[];
  bom: boolean;
}

/** Reference parse (validation, error positions); integers as bigint. */
export const smolParse = (s: string) => TOML.parse(s.replace(/^﻿/, ''), { integersAsBigInt: true }) as Obj;

const DT = /\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/y;
const TM = /\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/y;
const NUM = /[+-]?(?:0x[0-9A-Fa-f_]+|0o[0-7_]+|0b[01_]+|inf|nan|[0-9_]+(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)/y;

function parseCst(s: string): { items: Item[]; bom: boolean } {
  const bom = s.charCodeAt(0) === 0xfeff;
  let i = bom ? 1 : 0;
  const n = s.length;
  const fail = (msg = 'Unexpected character'): never => { throw new TomlSyntaxError(msg, i); };
  const sp = () => { while (s[i] === ' ' || s[i] === '\t') i++; };
  const isNl = () => s[i] === '\n' || (s[i] === '\r' && s[i + 1] === '\n');
  const nl = () => {
    if (s[i] === '\n') { i++; return true; }
    if (s[i] === '\r' && s[i + 1] === '\n') { i += 2; return true; }
    return false;
  };
  const comment = () => {
    const st = i;
    while (i < n && !isNl()) i++;
    return s.slice(st, i).trimEnd();
  };
  const hex = (len: number) => {
    const h = s.slice(i, i + len);
    if (!new RegExp('^[0-9A-Fa-f]{' + len + '}$').test(h)) fail('Bad escape');
    i += len;
    const c = parseInt(h, 16);
    if (c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) fail('Bad Unicode escape');
    return String.fromCodePoint(c);
  };
  const escape = (): string => {
    const e = s[i++];
    switch (e) {
      case 'b': return '\b';
      case 't': return '\t';
      case 'n': return '\n';
      case 'f': return '\f';
      case 'r': return '\r';
      case 'e': return '\x1b';
      case '"': return '"';
      case '\\': return '\\';
      case 'x': return hex(2);
      case 'u': return hex(4);
      case 'U': return hex(8);
    }
    i--;
    return fail('Bad escape');
  };
  const basicStr = () => {
    i++;
    let out = '';
    for (;;) {
      if (i >= n || isNl()) fail('Unterminated string');
      const c = s[i];
      if (c === '"') { i++; return out; }
      if (c === '\\') { i++; out += escape(); continue; }
      out += c;
      i++;
    }
  };
  const literalStr = () => {
    const st = ++i;
    while (i < n && s[i] !== "'" && !isNl()) i++;
    if (s[i] !== "'") fail('Unterminated string');
    return s.slice(st, i++);
  };
  /** Closing delimiter of a multi-line string; up to two extra quotes belong to the content. */
  const closeMl = (q: string) => {
    let c = 3;
    while (s[i + c] === q) c++;
    if (c > 5) fail('Too many quotes');
    i += c;
    return q.repeat(c - 3);
  };
  const mlBasic = () => {
    i += 3;
    nl();
    let out = '';
    for (;;) {
      if (i >= n) fail('Unterminated string');
      if (s.startsWith('"""', i)) return out + closeMl('"');
      if (s[i] === '\\') {
        // Line-ending backslash: drop it and all whitespace / newlines that follow.
        let j = i + 1;
        while (s[j] === ' ' || s[j] === '\t') j++;
        if (s[j] === '\n' || (s[j] === '\r' && s[j + 1] === '\n')) {
          i = j;
          while (i < n && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
          continue;
        }
        i++;
        out += escape();
        continue;
      }
      out += s[i++];
    }
  };
  const mlLiteral = () => {
    i += 3;
    nl();
    const st = i;
    for (;;) {
      if (i >= n) fail('Unterminated string');
      if (s.startsWith("'''", i)) {
        const body = s.slice(st, i);
        return body + closeMl("'");
      }
      i++;
    }
  };
  const simpleKey = (): Key => {
    const st = i;
    if (s[i] === '"') { const k = basicStr(); return { raw: s.slice(st, i), k }; }
    if (s[i] === "'") { const k = literalStr(); return { raw: s.slice(st, i), k }; }
    while (i < n && /[A-Za-z0-9_-]/.test(s[i])) i++;
    if (i === st) fail('Expected a key');
    return { raw: s.slice(st, i), k: s.slice(st, i) };
  };
  const key = (): Key[] => {
    const ks = [simpleKey()];
    for (;;) {
      const save = i;
      sp();
      if (s[i] !== '.') { i = save; return ks; }
      if (ks.length >= MAX_DEPTH) fail('Nesting deeper than ' + MAX_DEPTH + ' levels is not supported');
      i++;
      sp();
      ks.push(simpleKey());
    }
  };
  const delim = () => i >= n || /[ \t,\]}#\r\n]/.test(s[i]);
  const token = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return null;
    const save = i;
    i += m[0].length;
    if (!delim()) { i = save; return null; }
    return m[0];
  };
  const value = (depth: number): TVal => {
    const st = i, c = s[i];
    if (c === '"' || c === "'") {
      const tri = s.startsWith(c.repeat(3), i);
      const v = c === '"' ? (tri ? mlBasic() : basicStr()) : tri ? mlLiteral() : literalStr();
      return { t: 'scalar', raw: s.slice(st, i), v };
    }
    if (c === '[' || c === '{') {
      if (depth >= MAX_DEPTH) fail('Nesting deeper than ' + MAX_DEPTH + ' levels is not supported');
      return list(c === '[' ? 'arr' : 'itab', depth);
    }
    for (const w of ['true', 'false']) {
      if (s.startsWith(w, i)) {
        i += w.length;
        if (delim()) return { t: 'scalar', raw: w, v: w === 'true' };
        i = st;
      }
    }
    const d = token(DT) ?? token(TM);
    if (d) return { t: 'scalar', raw: d, v: new DateTime(d) };
    const num = token(NUM);
    if (num) {
      const kind = /^[+-]?0[xob]/.test(num) ? 'int' : /[.eE]|inf|nan/.test(num) ? 'float' : 'int';
      return { t: 'scalar', raw: num, v: new Num(num, kind, 'toml') };
    }
    return fail('Expected a value');
  };
  /** Array or inline table, keeping comments and whether it spanned lines. */
  const list = (t: 'arr' | 'itab', depth: number): TVal => {
    const close = t === 'arr' ? ']' : '}';
    i++;
    const items: Part[] = [];
    let before: string[] = [], last: Part | null = null, ml = false, sameLine = false, needComma = false;
    for (;;) {
      sp();
      if (i >= n) fail('Unterminated ' + (t === 'arr' ? 'array' : 'inline table'));
      if (nl()) { ml = true; sameLine = false; continue; }
      if (s[i] === '#') {
        const c = comment();
        if (last && sameLine && last.after === undefined) last.after = c;
        else before.push(c);
        continue;
      }
      if (s[i] === close) { i++; return { t, items, end: before, ml }; }
      if (s[i] === ',') {
        if (!needComma) fail();
        i++;
        needComma = false;
        continue;
      }
      if (needComma) fail('Expected , or ' + close);
      let k: Key[] | undefined;
      if (t === 'itab') {
        k = key();
        sp();
        if (s[i] !== '=') fail('Expected =');
        i++;
        sp();
      }
      last = { key: k, v: value(depth + 1), before };
      before = [];
      items.push(last);
      sameLine = true;
      needComma = true;
    }
  };

  const items: Item[] = [];
  while (i < n) {
    sp();
    if (nl()) { items.push({ t: 'blank' }); continue; }
    if (i >= n) break;
    if (s[i] === '#') items.push({ t: 'comment', text: comment() });
    else if (s[i] === '[') {
      const aot = s[i + 1] === '[';
      i += aot ? 2 : 1;
      sp();
      const k = key();
      sp();
      if (aot ? !s.startsWith(']]', i) : s[i] !== ']') fail('Expected ]');
      i += aot ? 2 : 1;
      sp();
      const it: Item = { t: 'table', aot, key: k };
      if (s[i] === '#') it.comment = comment();
      items.push(it);
    } else {
      const k = key();
      sp();
      if (s[i] !== '=') fail('Expected =');
      i++;
      sp();
      const it: Item = { t: 'kv', key: k, v: value(0) };
      sp();
      if (s[i] === '#') it.comment = comment();
      items.push(it);
    }
    sp();
    if (i < n && !nl()) fail('Expected end of line');
  }
  return { items, bom };
}

/** Build the value model (and raw-text map) the way a TOML parser would. */
function build(items: Item[]): { value: Obj; raw: Map<string, string>; keys: Map<string, string> } {
  const root: Obj = {};
  const raw = new Map<string, string>(), keys = new Map<string, string>();
  const keyAt = (p: string, k: Key) => { if (!keys.has(p)) keys.set(p, k.raw); };
  const descend = (t: Obj, path: string, k: Key): [Obj, string] => {
    const p = cp(path, k.k, false);
    keyAt(p, k);
    const c = own(t, k.k);
    if (c === undefined) {
      const o: Obj = {};
      setKey(t, k.k, o);
      return [o, p];
    }
    // Under an array of tables, keys refer to its last element.
    if (Array.isArray(c)) return [c[c.length - 1] as Obj, cp(p, c.length - 1, true)];
    return [c as Obj, p];
  };
  const toVal = (v: TVal, path: string): unknown => {
    if (v.t === 'scalar') { raw.set(path, v.raw); return v.v; }
    if (v.t === 'arr') return v.items.map((p, i) => toVal(p.v, cp(path, i, true)));
    const o: Obj = {};
    v.items.forEach((p) => assign(o, path, p.key!, p.v));
    return o;
  };
  const assign = (t: Obj, path: string, key: Key[], v: TVal) => {
    let tt = t, pp = path;
    for (const k of key.slice(0, -1)) [tt, pp] = descend(tt, pp, k);
    const last = key[key.length - 1];
    const lp = cp(pp, last.k, false);
    keyAt(lp, last);
    setKey(tt, last.k, toVal(v, lp));
  };
  let cur = root, curPath = '$';
  for (const it of items) {
    if (it.t === 'kv') assign(cur, curPath, it.key, it.v);
    else if (it.t === 'table') {
      let t = root, p = '$';
      for (const k of it.key.slice(0, -1)) [t, p] = descend(t, p, k);
      const last = it.key[it.key.length - 1];
      if (it.aot) {
        keyAt(cp(p, last.k, false), last);
        let arr = own(t, last.k) as Obj[] | undefined;
        if (!arr) { arr = []; setKey(t, last.k, arr); }
        const el: Obj = {};
        arr.push(el);
        cur = el;
        curPath = cp(cp(p, last.k, false), arr.length - 1, true);
      } else [cur, curPath] = descend(t, p, last);
    }
  }
  return { value: root, raw, keys };
}

function collectComments(items: Item[]): string[] {
  const out: string[] = [];
  const val = (v: TVal) => {
    if (v.t === 'scalar') return;
    v.items.forEach((p) => { out.push(...p.before); val(p.v); if (p.after !== undefined) out.push(p.after); });
    out.push(...v.end);
  };
  for (const it of items) {
    if (it.t === 'comment') out.push(it.text);
    else if (it.t === 'table') { if (it.comment !== undefined) out.push(it.comment); }
    else if (it.t === 'kv') { val(it.v); if (it.comment !== undefined) out.push(it.comment); }
  }
  return out;
}

const floatOf = (raw: string) => {
  const r = cleanNum(raw);
  return /inf$/.test(r) ? (r[0] === '-' ? -Infinity : Infinity) : /nan$/.test(r) ? NaN : Number(r);
};

/** Every value we built must equal the reference parser's (dates to its millisecond precision). */
function crossCheck(mine: unknown, ref: unknown, path: string) {
  const bad = () => { throw new TomlMismatch(path); };
  if (mine instanceof Num) {
    if (mine.kind === 'int') {
      if (typeof ref !== 'bigint' || BigInt(cleanNum(mine.raw)) !== ref) bad();
    } else {
      const f = floatOf(mine.raw);
      if (typeof ref !== 'number' || !(Object.is(f, ref) || (Number.isNaN(f) && Number.isNaN(ref)))) bad();
    }
  } else if (mine instanceof DateTime) {
    if (!(ref instanceof Date) || dateKey(mine.raw.replace(/(\.\d{3})\d+/, '$1')) !== dateKey(ref.toISOString())) bad();
  } else if (Array.isArray(mine)) {
    if (!Array.isArray(ref) || ref.length !== mine.length) bad();
    mine.forEach((x, i) => crossCheck(x, (ref as unknown[])[i], cp(path, i, true)));
  } else if (isObj(mine)) {
    if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) bad();
    const r = ref as Obj;
    if (Object.keys(mine).length !== Object.keys(r).length) bad();
    for (const k of Object.keys(mine)) {
      if (!hasOwn(r, k)) bad();
      crossCheck(mine[k], r[k], cp(path, k, false));
    }
  } else if (mine !== ref) bad();
}

/** Parse and validate a TOML document (throws smol-toml errors, TomlSyntaxError or TomlMismatch). */
export function parseTomlDoc(s: string): TomlDoc {
  const ref = smolParse(s);
  const { items, bom } = parseCst(s);
  const { value, raw, keys } = build(items);
  crossCheck(value, ref, '$');
  return { items, value, raw, keys, comments: collectComments(items), bom };
}

const keyText = (k: Key[]) => k.map((x) => x.raw).join('.');
const keySort = (k: Key[]) => k.map((x) => x.k).join('\u0000');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Re-print a document. Values, keys and comments are emitted exactly as written; only
 * whitespace changes (one space around `=`, no indentation, single blank lines, a blank
 * line before each table). `sort` orders keys within each blank-line-separated group
 * of a table (with the comments directly above them) and within inline tables.
 */
export function formatToml(doc: TomlDoc, sort = false): string {
  const val = (v: TVal, cur: string): string => {
    if (v.t === 'scalar') return v.raw;
    const parts = sort && v.t === 'itab' ? [...v.items].sort((a, b) => cmp(keySort(a.key!), keySort(b.key!))) : v.items;
    const [o, c] = v.t === 'arr' ? ['[', ']'] : ['{', '}'];
    const one = (p: Part) => (p.key ? keyText(p.key) + ' = ' : '') + val(p.v, cur + '  ');
    const comments = v.end.length > 0 || parts.some((p) => p.before.length || p.after !== undefined);
    if (!v.ml && !comments) {
      if (!parts.length) return o + c;
      return v.t === 'arr' ? '[' + parts.map(one).join(', ') + ']' : '{ ' + parts.map(one).join(', ') + ' }';
    }
    const inner = cur + '  ';
    const out = [o];
    for (const p of parts) {
      p.before.forEach((x) => out.push(inner + x));
      out.push(inner + one(p) + ',' + (p.after !== undefined ? ' ' + p.after : ''));
    }
    v.end.forEach((x) => out.push(inner + x));
    out.push(cur + c);
    return out.join('\n');
  };

  let items = doc.items;
  if (sort) {
    // Sort units (comments directly above + key/value) within runs of consecutive lines.
    const out: Item[] = [];
    let run: Item[][] = [], pending: Item[] = [];
    const flush = () => {
      run.sort((a, b) => cmp(keySort((a[a.length - 1] as { key: Key[] }).key), keySort((b[b.length - 1] as { key: Key[] }).key)));
      run.forEach((u) => out.push(...u));
      out.push(...pending);
      run = [];
      pending = [];
    };
    for (const it of items) {
      if (it.t === 'kv') { run.push([...pending, it]); pending = []; }
      else if (it.t === 'comment') pending.push(it);
      else { flush(); out.push(it); }
    }
    flush();
    items = out;
  }

  // A blank line goes before each table header, or before the comments directly above it.
  const blankBefore = new Set<number>();
  items.forEach((it, x) => {
    if (it.t !== 'table') return;
    let st = x;
    while (st > 0 && items[st - 1].t === 'comment') st--;
    blankBefore.add(st);
  });
  const lines: string[] = [];
  let blank = false;
  items.forEach((it, x) => {
    if (it.t === 'blank') { blank = true; return; }
    if ((blank || blankBefore.has(x)) && lines.length) lines.push('');
    blank = false;
    if (it.t === 'comment') lines.push(it.text);
    else if (it.t === 'table') lines.push((it.aot ? '[[' : '[') + keyText(it.key) + (it.aot ? ']]' : ']') + (it.comment !== undefined ? ' ' + it.comment : ''));
    else lines.push(keyText(it.key) + ' = ' + val(it.v, '') + (it.comment !== undefined ? ' ' + it.comment : ''));
  });
  return lines.length ? lines.join('\n') + '\n' : '';
}

function sameMap(a: Map<string, string>, b: Map<string, string>): string | null {
  for (const [k, v] of a) if (b.get(k) !== v) return k;
  for (const k of b.keys()) if (!a.has(k)) return k;
  return null;
}

/**
 * Check that `out` re-parses to the same document: identical values and types, every
 * scalar's source text unchanged, all comments kept (in order unless sorted).
 */
export function verifyToml(src: TomlDoc, out: string, sorted: boolean) {
  let d: TomlDoc;
  try { d = parseTomlDoc(out); } catch { throw new VerifyError('$'); }
  if (canon(src.value, { typed: true }) !== canon(d.value, { typed: true })) throw new VerifyError('$');
  const p = sameMap(src.raw, d.raw);
  if (p) throw new VerifyError(p);
  const ca = sorted ? [...src.comments].sort() : src.comments, cb = sorted ? [...d.comments].sort() : d.comments;
  if (ca.length !== cb.length || ca.some((c, i) => c !== cb[i])) throw new VerifyError('#');
}

/** TOML basic string. */
export function tomlStr(s: string, path = '$'): string {
  let o = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34) o += '\\"';
    else if (c === 92) o += '\\\\';
    else if (c === 8) o += '\\b';
    else if (c === 9) o += '\\t';
    else if (c === 10) o += '\\n';
    else if (c === 12) o += '\\f';
    else if (c === 13) o += '\\r';
    else if (c < 32 || c === 127) o += '\\u' + c.toString(16).padStart(4, '0');
    else if (c >= 0xd800 && c <= 0xdfff) {
      // Only well-formed surrogate pairs are representable.
      const d = s.charCodeAt(i + 1);
      if (c > 0xdbff || !(d >= 0xdc00 && d <= 0xdfff)) throw new ConvertError('badString', path);
      o += s[i] + s[i + 1];
      i++;
    } else o += s[i];
  }
  return o + '"';
}

export const bareKey = (k: string, path = '$') => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlStr(k, path));
export const isAoT = (x: unknown): x is Obj[] => Array.isArray(x) && x.length > 0 && x.every(isObj);

const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;

/**
 * Inline TOML text of a value. With `raw`, scalars are shown exactly as written in the
 * source; otherwise (JSON → TOML) numbers TOML can't hold exactly are refused.
 */
export function tomlValue(x: unknown, path = '$', raw?: Map<string, string>): string {
  const r = raw?.get(path);
  if (r !== undefined) return r;
  if (x === null || x === undefined) throw new ConvertError('null', path);
  if (typeof x === 'string') return tomlStr(x, path);
  if (typeof x === 'boolean') return String(x);
  if (x instanceof DateTime) return x.raw;
  if (x instanceof Num) {
    if (x.src === 'toml') return x.raw;
    if (x.kind === 'int') {
      const b = BigInt(x.raw);
      if (b < I64_MIN || b > I64_MAX) throw new ConvertError('intRange', path, x.raw);
      return x.raw;
    }
    // TOML floats are IEEE 754 doubles: refuse digits a double can't hold.
    const f = Number(x.raw);
    if (!isFinite(f)) throw new ConvertError('floatRange', path, x.raw);
    if (numKey(String(f)) !== numKey(x)) throw new ConvertError('floatPrecision', path, x.raw + ' → ' + String(f));
    return x.raw;
  }
  if (Array.isArray(x)) return '[' + x.map((y, i) => tomlValue(y, cp(path, i, true), raw)).join(', ') + ']';
  if (isObj(x)) {
    const e = Object.keys(x);
    return e.length ? '{ ' + e.map((k) => bareKey(k, cp(path, k, false)) + ' = ' + tomlValue(x[k], cp(path, k, false), raw)).join(', ') + ' }' : '{}';
  }
  throw new ConvertError('null', path);
}

/**
 * Walk a value the way TOML is written: plain keys first, then `[table]` and
 * `[[array.of.tables]]` sections. `onHeader` returns false to skip a section's body.
 */
export function walkToml(
  v: Obj,
  onKey: (k: string, y: unknown, path: string, depth: number) => void,
  onHeader: (label: string, obj: Obj, path: string, depth: number) => boolean,
) {
  const table = (obj: Obj, path: string, depth: number, names: string[]) => {
    const ks = Object.keys(obj);
    ks.filter((k) => !isObj(obj[k]) && !isAoT(obj[k])).forEach((k) => onKey(k, obj[k], cp(path, k, false), depth));
    ks.filter((k) => isObj(obj[k]) || isAoT(obj[k])).forEach((k) => {
      const y = obj[k];
      const p = cp(path, k, false);
      const nm = [...names, bareKey(k, p)];
      if (isObj(y)) {
        if (onHeader('[' + nm.join('.') + ']', y, p, depth)) table(y, p, depth + 1, nm);
      } else {
        (y as Obj[]).forEach((el, i) => {
          const ep = cp(p, i, true);
          if (onHeader('[[' + nm.join('.') + ']]', el, ep, depth)) table(el, ep, depth + 1, nm);
        });
      }
    });
  };
  table(v, '$', 0, []);
}

/** Value model (from JSON) → TOML text; refuses anything TOML can't represent exactly. */
export function toTomlText(v: Obj): string {
  const lines: string[] = [];
  walkToml(
    v,
    (k, y, path) => lines.push(bareKey(k, path) + ' = ' + tomlValue(y, path)),
    (label) => {
      if (lines.length) lines.push('');
      lines.push(label);
      return true;
    },
  );
  return lines.length ? lines.join('\n') + '\n' : '';
}
