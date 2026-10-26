// TOML parsing (integers as bigint so they stay distinct from floats) and serialization.
import * as TOML from 'smol-toml';
import { ConvertError, JsonNum, cp, dateText, isObj, setKey, type Obj } from './data';

export const parseToml = (s: string) => TOML.parse(s, { integersAsBigInt: true }) as Obj;

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

export const bareKey = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlStr(k));
export const isAoT = (x: unknown): x is Obj[] => Array.isArray(x) && x.length > 0 && x.every(isObj);

/** bigint → integer; number → float (always with a `.`/exponent so it stays a float). */
export function tomlNum(x: number | bigint | JsonNum): string {
  if (x instanceof JsonNum) return x.raw;
  if (typeof x === 'bigint') return String(x);
  if (Number.isNaN(x)) return 'nan';
  if (!isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const s = Object.is(x, -0) ? '-0' : String(x);
  return /^-?\d+$/.test(s) ? s + '.0' : s;
}

/** Inline TOML value. */
export function tomlValue(x: unknown, path = '$'): string {
  if (x === null || x === undefined) throw new ConvertError('null', path);
  if (typeof x === 'string') return tomlStr(x, path);
  if (typeof x === 'boolean') return String(x);
  if (typeof x === 'number' || typeof x === 'bigint' || x instanceof JsonNum) return tomlNum(x);
  if (x instanceof Date) return dateText(x);
  if (Array.isArray(x)) return '[' + x.map((y, i) => tomlValue(y, cp(path, i, true))).join(', ') + ']';
  if (isObj(x)) {
    const e = Object.keys(x);
    return e.length ? '{ ' + e.map((k) => bareKey(k) + ' = ' + tomlValue(x[k], cp(path, k, false))).join(', ') + ' }' : '{}';
  }
  return tomlStr(String(x), path);
}

/**
 * Walk a TOML document the way it is written: plain keys first, then `[table]` and
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
      const nm = [...names, bareKey(k)];
      const p = cp(path, k, false);
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

export function stringifyToml(v: Obj): string {
  const lines: string[] = [];
  walkToml(
    v,
    (k, y, path) => lines.push(bareKey(k) + ' = ' + tomlValue(y, path)),
    (label) => {
      if (lines.length) lines.push('');
      lines.push(label);
      return true;
    },
  );
  return lines.length ? lines.join('\n') + '\n' : '';
}

const I64_MIN = -(2n ** 63n), I64_MAX = 2n ** 63n - 1n;

/** Prepare parsed JSON for TOML: integers → bigint (TOML int), null → error. */
export function jsonToToml(v: unknown, path = '$'): unknown {
  if (v === null || v === undefined) throw new ConvertError('null', path);
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 2 ** 63 ? BigInt(v) : v;
  if (v instanceof JsonNum) {
    if (!/^-?\d+$/.test(v.raw)) return v;
    const b = BigInt(v.raw);
    // Beyond 64 bits TOML only has floats.
    return b >= I64_MIN && b <= I64_MAX ? b : new JsonNum(v.raw + '.0');
  }
  if (Array.isArray(v)) return v.map((y, i) => jsonToToml(y, cp(path, i, true)));
  if (isObj(v)) {
    const o: Obj = {};
    Object.keys(v).forEach((k) => setKey(o, k, jsonToToml(v[k], cp(path, k, false))));
    return o;
  }
  return v;
}
