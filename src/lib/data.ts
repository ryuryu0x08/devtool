// Helpers for structured data: paths, previews, stats, parse errors and the semantic diff.

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
export const isCont = (v: unknown): v is Obj | unknown[] => Array.isArray(v) || isObj(v);

export function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObj(v)) {
    const o: Obj = {};
    Object.keys(v).sort().forEach((k) => (o[k] = sortDeep(v[k])));
    return o;
  }
  return v;
}

export const canon = (v: unknown) => JSON.stringify(sortDeep(v));

/** Append a key or index to a JSONPath-like path (`$.a[0]["x y"]`). */
export function cp(path: string, k: string | number, arr: boolean): string {
  if (arr) return path + '[' + k + ']';
  const s = String(k);
  return /^[A-Za-z_$][\w$]*$/.test(s) ? path + '.' + s : path + '[' + JSON.stringify(s) + ']';
}

/** Text and color for a primitive value. */
export function prim(v: unknown): [string, string] {
  if (v === null) return ['null', 'var(--faint)'];
  if (v instanceof Date) return [typeof v.toISOString === 'function' ? v.toISOString() : String(v), 'var(--date)'];
  switch (typeof v) {
    case 'string': return [JSON.stringify(v), 'var(--str)'];
    case 'number': case 'bigint': return [String(v), 'var(--num)'];
    case 'boolean': return [String(v), 'var(--bool)'];
    default: return [String(v), 'var(--ink)'];
  }
}

export function preview(v: unknown): string {
  let s: string | undefined;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
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

/** Index of the first JSON syntax error in `s`, or null if it parses. */
export function jsonErrorPos(s: string): number | null {
  let i = 0;
  const NUM = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
  const fail = (): never => { throw i; };
  const ws = () => { while (i < s.length && ' \t\n\r'.includes(s[i])) i++; };
  const str = () => {
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '"') { i++; return; }
      if (c < ' ') fail();
      if (c === '\\') {
        i++;
        if (s[i] === 'u') {
          for (let k = 1; k <= 4; k++) if (!/[0-9a-f]/i.test(s[i + k] || '')) { i += k; fail(); }
          i += 5;
        } else if (s[i] && '"\\/bfnrt'.includes(s[i])) i++;
        else fail();
        continue;
      }
      i++;
    }
    fail();
  };
  const val = (): void => {
    ws();
    const c = s[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      ws();
      if (s[i] === close) { i++; return; }
      for (;;) {
        ws();
        if (c === '{') {
          if (s[i] !== '"') fail();
          str();
          ws();
          if (s[i] !== ':') fail();
          i++;
        }
        val();
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === close) { i++; return; }
        fail();
      }
    }
    if (c === '"') { str(); return; }
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUM.lastIndex = i;
      const m = NUM.exec(s);
      if (!m || m[0] === '-') fail();
      i += m![0].length;
      return;
    }
    for (const w of ['true', 'false', 'null']) if (s.startsWith(w, i)) { i += w.length; return; }
    fail();
  };
  try {
    val();
    ws();
    if (i < s.length) fail();
    return null;
  } catch (p) {
    return typeof p === 'number' ? p : null;
  }
}

export interface ErrInfo { msg: string; line: number | null; col: number | null; lineText: string; caret: string }

/** Extract line / column from JSON.parse or smol-toml errors and build a caret marker. */
export function errInfo(e: unknown, src: string, lang: 'json' | 'toml'): ErrInfo {
  let line: number | null = null, col: number | null = null;
  const err = e as { message?: string; line?: number; column?: number };
  const msg = String((err && err.message) || e);
  if (lang === 'toml') {
    line = err?.line || null;
    col = err?.column || null;
    if (!line) {
      const m = msg.match(/line (\d+)\D+(\d+)/i);
      if (m) { line = +m[1]; col = +m[2]; }
    }
  } else {
    let m = msg.match(/line (\d+) column (\d+)/i);
    if (m) { line = +m[1]; col = +m[2]; }
    else {
      m = msg.match(/position (\d+)/i);
      // Newer V8 messages often omit the position, so locate the error ourselves.
      const pos = m ? +m[1] : /end of/i.test(msg) ? src.length : jsonErrorPos(src);
      if (pos != null) {
        const pre = src.slice(0, pos);
        line = pre.split('\n').length;
        col = pos - pre.lastIndexOf('\n');
      }
    }
  }
  let lineText = '', caret = '';
  if (line) {
    const Ln = src.split('\n')[line - 1] || '';
    const c = Math.max(1, col || 1);
    const st = c > 60 ? c - 40 : 0;
    lineText = (st ? '…' : '') + Ln.slice(st, st + 110);
    caret = ' '.repeat(Math.max(0, c - 1 - st + (st ? 1 : 0))) + '^';
  }
  return { msg: msg.split('\n')[0], line, col, lineText, caret };
}

export type DiffSt = 'same' | 'add' | 'del' | 'chg' | 'mod';
export interface DiffNode {
  key: string | number | null;
  path: string;
  st: DiffSt;
  a?: unknown;
  b?: unknown;
  kind?: 'obj' | 'arr';
  ch?: DiffNode[];
}

/**
 * Semantic diff: key order is ignored; with `io` (ignore order) array items are
 * matched by canonical value before positional comparison.
 */
export function diffNode(a: unknown, b: unknown, key: string | number | null, path: string, io: boolean): DiffNode {
  if (a === undefined) return { key, path, st: 'add', b };
  if (b === undefined) return { key, path, st: 'del', a };
  if (isObj(a) && isObj(b)) {
    const ks = Object.keys(a);
    Object.keys(b).forEach((k) => { if (!(k in a)) ks.push(k); });
    const ch = ks.map((k) => diffNode(a[k], b[k], k, cp(path, k, false), io));
    return { key, path, a, b, kind: 'obj', ch, st: ch.every((c) => c.st === 'same') ? 'same' : 'mod' };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ch: DiffNode[] = [];
    if (io) {
      const used = b.map(() => false), bc = b.map(canon), left: number[] = [];
      a.forEach((x, i) => {
        const c = canon(x);
        const j = bc.findIndex((y, j) => !used[j] && y === c);
        if (j >= 0) {
          used[j] = true;
          ch.push({ key: i, path: cp(path, i, true), st: 'same', a: x, b: b[j] });
        } else left.push(i);
      });
      const bl = b.map((_, j) => j).filter((j) => !used[j]);
      for (let k = 0; k < Math.max(left.length, bl.length); k++) {
        const i = left[k], j = bl[k];
        const idx = i !== undefined ? i : j;
        ch.push(diffNode(i !== undefined ? a[i] : undefined, j !== undefined ? b[j] : undefined, idx, cp(path, idx, true), io));
      }
    } else {
      for (let i = 0; i < Math.max(a.length, b.length); i++)
        ch.push(diffNode(i < a.length ? a[i] : undefined, i < b.length ? b[i] : undefined, i, cp(path, i, true), io));
    }
    return { key, path, a, b, kind: 'arr', ch, st: ch.every((c) => c.st === 'same') ? 'same' : 'mod' };
  }
  if (canon(a) === canon(b)) return { key, path, st: 'same', a, b };
  return { key, path, st: 'chg', a, b };
}
