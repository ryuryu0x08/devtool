// Lossless JSON parser: numbers that a JS number would alter are kept as JsonNum.
import { JsonNum, setKey, type Obj } from './data';

export class JsonSyntaxError extends SyntaxError {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const LIT: [string, unknown][] = [['true', true], ['false', false], ['null', null]];

function parse(s: string): unknown {
  let i = 0;
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
  const val = (): unknown => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      const o: Obj = {};
      ws();
      if (s[i] === '}') { i++; return o; }
      for (;;) {
        ws();
        if (s[i] !== '"') fail();
        const k = str();
        ws();
        if (s[i] !== ':') fail();
        i++;
        setKey(o, k, val());
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return o; }
        fail();
      }
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      ws();
      if (s[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(val());
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return arr; }
        fail();
      }
    }
    if (c === '"') return str();
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUM.lastIndex = i;
      const m = NUM.exec(s);
      if (!m) { if (c === '-') i++; fail(); }
      const raw = m![0];
      i += raw.length;
      const n = Number(raw);
      return String(n) === raw ? n : new JsonNum(raw);
    }
    for (const [w, v] of LIT) if (s.startsWith(w, i)) { i += w.length; return v; }
    return fail();
  };
  const v = val();
  ws();
  if (i < s.length) fail();
  return v;
}

/** Like JSON.parse, but keeps number text exact and reports the error offset in `pos`. */
export function parseJson(s: string): unknown {
  try {
    return parse(s);
  } catch (e) {
    // Extremely deep nesting can overflow our recursion; the native parser copes.
    if (e instanceof RangeError) return JSON.parse(s);
    throw e;
  }
}
