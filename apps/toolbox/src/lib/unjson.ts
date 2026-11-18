// Escaped JSON back to JSON: what a log, a database column or a message often holds — JSON put in
// a string once or more ({\"a\":1}, "{\"a\":1}", {\\\"a\\\":1}), sometimes with its levels mixed
// (a part escaped once more than the rest). Escaping is taken off a level at a time until it
// reads as JSON; string values that are JSON themselves can be opened up too. Read as a syntax
// tree (lib/json.ts): numbers stay exactly as written (a 19-digit id isn't rounded).
import { parseJsonAst, type JNode } from './json';

export type UnStep =
  /** The whole text was one JSON string ("…"): its content taken. */
  | 'string'
  /** One level of escaping taken off (\" → ", \\ → \, \n → new line…). */
  | 'unescape'
  /** Levels mixed: the backslashes before quotes taken off where the rest of it had none left. */
  | 'quotes';

export type UnResult =
  /** mixed: parts were escaped to different depths (so taken off unevenly): worth a look. */
  | { ok: true; ast: JNode; steps: UnStep[]; nested: number; mixed: boolean }
  | { ok: false; message: string };

/** At most this many levels are taken off. */
const MAX_LEVELS = 8;

const ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * One level of escaping off: as JSON reads the inside of a string, but quotes with no backslash
 * stay as they are (the parts of mixed levels that were escaped less). A backslash before
 * anything else stays.
 */
export function unescapeOnce(s: string): string {
  try {
    // The usual case: the whole text is the inside of a JSON string.
    return JSON.parse('"' + s + '"') as string;
  } catch {
    return s.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (m, c: string) => (c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ESC[c] ?? m));
  }
}

/** The whole text is the inside of a JSON string (escaped evenly: no bare quote, no stray backslash). */
const evenly = (s: string) => {
  try {
    JSON.parse('"' + s + '"');
    return true;
  } catch {
    return false;
  }
};

const parse = (s: string): { ok: true; v: JNode } | { ok: false } => {
  try {
    return { ok: true, v: parseJsonAst(s).ast };
  } catch {
    return { ok: false };
  }
};

/** JSON in a string value: an object or array, read; anything else, nothing. */
function inner(s: string): { ast: JNode; count: number } | undefined {
  const t = s.trim();
  if (!(t.startsWith('{') && t.endsWith('}')) && !(t.startsWith('[') && t.endsWith(']'))) return undefined;
  const r = unescapeJson(t, true);
  return r.ok && (r.ast.t === 'obj' || r.ast.t === 'arr') ? { ast: r.ast, count: r.nested } : undefined;
}

/** String values that are JSON objects or arrays, opened up (as deep as they go); how many. */
export function openNested(n: JNode): { ast: JNode; count: number } {
  let count = 0;
  const walk = (x: JNode): JNode => {
    if (x.t === 'str') {
      const o = inner(x.v);
      if (!o) return x;
      count += 1 + o.count;
      return o.ast;
    }
    if (x.t === 'arr') return { t: 'arr', e: x.e.map(walk) };
    if (x.t === 'obj') return { t: 'obj', e: x.e.map((e) => ({ ...e, v: walk(e.v) })) };
    return x;
  };
  const ast = walk(n);
  return { ast, count };
}

/** `text` as JSON, its escaping taken off level by level; with `nested`, its JSON string values opened up. */
export function unescapeJson(text: string, nested = true): UnResult {
  let s = text.trim();
  if (!s) return { ok: false, message: 'empty' };
  const steps: UnStep[] = [];
  let first: string | null = null;
  let mixed = false;
  for (let level = 0; level <= MAX_LEVELS; level++) {
    const r = parse(s);
    if (r.ok) {
      // A JSON string holding JSON: its content, again.
      if (r.v.t === 'str' && /^\s*[[{"]/.test(r.v.v) && level < MAX_LEVELS) {
        s = r.v.v.trim();
        steps.push('string');
        continue;
      }
      if (r.v.t !== 'obj' && r.v.t !== 'arr') break;
      if (!nested) return { ok: true, ast: r.v, steps, nested: 0, mixed };
      const o = openNested(r.v);
      return { ok: true, ast: o.ast, steps, nested: o.count, mixed };
    }
    if (first === null) first = s;
    if (!evenly(s)) mixed = true;
    const next = unescapeOnce(s);
    if (next === s) {
      // Nothing left to take off evenly: levels mixed. Backslashes before quotes go, wherever they are.
      const q = s.replace(/\\+"/g, '"');
      if (q !== s) {
        s = q;
        mixed = true;
        steps.push('quotes');
        continue;
      }
      break;
    }
    s = next;
    steps.push('unescape');
  }
  // Not JSON at any level: why, as the parser says it of the text as given.
  try {
    parseJsonAst(first ?? s);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  return { ok: false, message: 'not JSON' };
}

/** Text that looks like escaped JSON: an object or array (maybe in quotes) with \" in it, that isn't JSON as it is. */
export function looksEscapedJson(text: string): boolean {
  const t = text.trim();
  if (!/^"?\s*[[{]/.test(t) || !/\\+"/.test(t)) return false;
  const p = parse(t);
  if (p.ok && (p.v.t === 'obj' || p.v.t === 'arr')) return false;
  return unescapeJson(t, false).ok;
}
