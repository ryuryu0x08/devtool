// JSON syntax tree that keeps every token as written (numbers, string escapes,
// duplicate keys), so formatting only ever changes whitespace.
import { ConvertError, DateTime, MAX_DEPTH, Num, cp, isObj, setKey, type Obj } from './data';

export type JNode =
  | { t: 'obj'; e: JEntry[] }
  | { t: 'arr'; e: JNode[] }
  | { t: 'str'; raw: string; v: string }
  | { t: 'num'; raw: string }
  | { t: 'lit'; raw: 'true' | 'false' | 'null' };
export interface JEntry { k: string; kRaw: string; v: JNode }

export class JsonSyntaxError extends SyntaxError {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const LIT = ['true', 'false', 'null'] as const;

export interface JsonDoc { ast: JNode; bom: boolean }

/** Parse JSON (RFC 8259) into a syntax tree; errors carry the offset in `pos`. */
export function parseJsonAst(s: string): JsonDoc {
  // A leading BOM (common in files saved on Windows) is not part of the document.
  const bom = s.charCodeAt(0) === 0xfeff;
  let i = bom ? 1 : 0;
  const fail = (msg?: string): never => {
    throw new JsonSyntaxError(msg ?? (i >= s.length ? 'Unexpected end of JSON input' : 'Unexpected token ' + JSON.stringify(s[i])), i);
  };
  const ws = () => {
    for (;;) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else return;
    }
  };
  const str = (): string => {
    i++;
    let out = '', st = i;
    for (;;) {
      if (i >= s.length) fail('Unterminated string');
      const c = s.charCodeAt(i);
      if (c === 34) { out += s.slice(st, i); i++; return out; }
      if (c < 32) fail('Bad control character in string');
      if (c === 92) {
        out += s.slice(st, i);
        i++;
        const e = s[i];
        if (e === 'u') {
          const h = s.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('Bad Unicode escape');
          out += String.fromCharCode(parseInt(h, 16));
          i += 5;
        } else if (e !== undefined && Object.prototype.hasOwnProperty.call(ESC, e)) {
          out += ESC[e];
          i++;
        } else fail('Bad escaped character');
        st = i;
        continue;
      }
      i++;
    }
  };
  const val = (depth: number): JNode => {
    ws();
    const c = s[i];
    if (c === '{' || c === '[') {
      if (depth >= MAX_DEPTH) fail('Nesting deeper than ' + MAX_DEPTH + ' levels is not supported');
      i++;
      ws();
      if (c === '{') {
        const e: JEntry[] = [];
        if (s[i] === '}') { i++; return { t: 'obj', e }; }
        for (;;) {
          ws();
          if (s[i] !== '"') fail();
          const st = i;
          const k = str();
          const kRaw = s.slice(st, i);
          ws();
          if (s[i] !== ':') fail();
          i++;
          e.push({ k, kRaw, v: val(depth + 1) });
          ws();
          if (s[i] === ',') { i++; continue; }
          if (s[i] === '}') { i++; return { t: 'obj', e }; }
          fail();
        }
      }
      const e: JNode[] = [];
      if (s[i] === ']') { i++; return { t: 'arr', e }; }
      for (;;) {
        e.push(val(depth + 1));
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return { t: 'arr', e }; }
        fail();
      }
    }
    if (c === '"') {
      const st = i;
      const v = str();
      return { t: 'str', raw: s.slice(st, i), v };
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUM.lastIndex = i;
      const m = NUM.exec(s);
      if (!m) { if (c === '-') i++; fail(); }
      i += m![0].length;
      return { t: 'num', raw: m![0] };
    }
    for (const w of LIT) if (s.startsWith(w, i)) { i += w.length; return { t: 'lit', raw: w }; }
    return fail();
  };
  const ast = val(0);
  ws();
  if (i < s.length) fail();
  return { ast, bom };
}

const byKey = (a: JEntry, b: JEntry) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);

/** Sort object entries by key, recursively (stable, so duplicate keys keep their order). */
export function sortAst(n: JNode): JNode {
  if (n.t === 'obj') return { t: 'obj', e: n.e.map((x) => ({ ...x, v: sortAst(x.v) })).sort(byKey) };
  if (n.t === 'arr') return { t: 'arr', e: n.e.map(sortAst) };
  return n;
}

/** Print a syntax tree. Every token is emitted exactly as parsed; only whitespace is chosen here. */
export function printJson(n: JNode, indent: string | number = ''): string {
  const gap = typeof indent === 'number' ? ' '.repeat(indent) : indent;
  const out = (x: JNode, cur: string): string => {
    if (x.t !== 'obj' && x.t !== 'arr') return x.raw;
    const o = x.t === 'obj' ? '{' : '[', c = x.t === 'obj' ? '}' : ']';
    if (!x.e.length) return o + c;
    const inner = cur + gap;
    const items = x.t === 'obj'
      ? x.e.map((e) => e.kRaw + (gap ? ': ' : ':') + out(e.v, inner))
      : x.e.map((e) => out(e, inner));
    return gap ? o + '\n' + inner + items.join(',\n' + inner) + '\n' + cur + c : o + items.join(',') + c;
  };
  return out(n, '');
}

/** Token-for-token equality of two trees (keys, values and order). */
export function astEqual(x: JNode, y: JNode): boolean {
  if (x.t !== y.t) return false;
  if (x.t === 'obj') {
    const ye = (y as typeof x).e;
    return x.e.length === ye.length && x.e.every((e, i) => e.kRaw === ye[i].kRaw && astEqual(e.v, ye[i].v));
  }
  if (x.t === 'arr') {
    const ye = (y as typeof x).e;
    return x.e.length === ye.length && x.e.every((e, i) => astEqual(e, ye[i]));
  }
  return x.raw === (y as typeof x).raw;
}

export function statsAst(n: JNode): { n: number; d: number } {
  let c = 0, d = 0;
  const w = (x: JNode, dep: number) => {
    c++;
    if (dep > d) d = dep;
    if (x.t === 'obj') x.e.forEach((e) => w(e.v, dep + 1));
    else if (x.t === 'arr') x.e.forEach((e) => w(e, dep + 1));
  };
  w(n, 0);
  return { n: c, d };
}

/** Paths of keys that appear more than once in the same object. */
export function dupKeys(n: JNode, path = '$', out: string[] = []): string[] {
  if (n.t === 'obj') {
    const seen = new Set<string>();
    for (const e of n.e) {
      const p = cp(path, e.k, false);
      if (seen.has(e.k)) out.push(p);
      seen.add(e.k);
      dupKeys(e.v, p, out);
    }
  } else if (n.t === 'arr') n.e.forEach((x, i) => dupKeys(x, cp(path, i, true), out));
  return out;
}

export interface JsonValue { v: unknown; raw: Map<string, string> }

/**
 * Value model of a tree, plus the source text of every scalar by path.
 * Refuses duplicate keys: which value they mean is undefined, so comparing or
 * converting them would silently pick one.
 */
export function jsonValue(n: JNode): JsonValue {
  const raw = new Map<string, string>();
  const dup = dupKeys(n);
  if (dup.length) throw new ConvertError('dupKey', dup[0]);
  const w = (x: JNode, path: string): unknown => {
    switch (x.t) {
      case 'obj': {
        const o: Obj = {};
        x.e.forEach((e) => setKey(o, e.k, w(e.v, cp(path, e.k, false))));
        return o;
      }
      case 'arr': return x.e.map((e, i) => w(e, cp(path, i, true)));
      case 'str': raw.set(path, x.raw); return x.v;
      case 'num': raw.set(path, x.raw); return new Num(x.raw, /[.eE]/.test(x.raw) ? 'float' : 'int', 'json');
      case 'lit': raw.set(path, x.raw); return x.raw === 'null' ? null : x.raw === 'true';
    }
  };
  return { v: w(n, '$'), raw };
}

/**
 * Value model → JSON text, for TOML → JSON conversion. Integers are written as exact
 * decimal digits and floats keep their digits; values JSON can't hold are refused.
 * `dates` collects paths of date-times that had to become strings.
 */
export function toJsonText(v: unknown, indent: string | number, dates: string[] = []): string {
  const gap = typeof indent === 'number' ? ' '.repeat(indent) : indent;
  const out = (x: unknown, cur: string, path: string): string => {
    if (x === null) return 'null';
    if (typeof x === 'boolean') return String(x);
    if (typeof x === 'string') return JSON.stringify(x);
    if (x instanceof Num) {
      const r = x.raw.replace(/_/g, '').replace(/^\+/, '');
      if (/^-?(inf|nan)$/.test(r)) throw new ConvertError('nanInf', path, x.raw);
      // TOML hex / octal / binary integers become exact decimal digits.
      return x.kind === 'int' ? BigInt(r).toString() : r;
    }
    if (x instanceof DateTime) {
      // JSON has no date type: the date-time becomes a string with the same text.
      dates.push(path);
      return JSON.stringify(x.raw);
    }
    const inner = cur + gap;
    const wrap = (o: string, c: string, items: string[]) =>
      !items.length ? o + c : gap ? o + '\n' + inner + items.join(',\n' + inner) + '\n' + cur + c : o + items.join(',') + c;
    if (Array.isArray(x)) return wrap('[', ']', x.map((y, i) => out(y, inner, cp(path, i, true))));
    if (isObj(x)) return wrap('{', '}', Object.keys(x).map((k) => JSON.stringify(k) + (gap ? ': ' : ':') + out(x[k], inner, cp(path, k, false))));
    throw new ConvertError('null', path);
  };
  return out(v, '', '$');
}
