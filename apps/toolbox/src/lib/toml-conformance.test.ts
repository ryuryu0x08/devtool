// Official TOML 1.1 conformance suite (test/toml-test, from toml-lang/toml-test).
import { describe, expect, it } from 'vitest';
import { DateTime, Num, cleanNum, dateKey, isObj, numKey } from './data';
import { formatToml, parseTomlDoc, verifyToml } from './toml';

const files = import.meta.glob('../../test/toml-test/**/*.{toml,json}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const valid = Object.keys(files).filter((f) => f.includes('/valid/') && f.endsWith('.toml'));
// invalid/encoding/* are byte-level (bad UTF-8); text here is already decoded, so those are
// covered by decodeUtf8's tests instead.
const invalid = Object.keys(files).filter((f) => f.includes('/invalid/') && !f.includes('/invalid/encoding/') && f.endsWith('.toml'));

type Tagged = { type: string; value: string } | Tagged[] | { [k: string]: Tagged };

/** Compare our value model with the suite's tagged JSON; returns the first mismatching path. */
function mismatch(mine: unknown, exp: Tagged, path = '$'): string | null {
  if (Array.isArray(exp)) {
    if (!Array.isArray(mine) || mine.length !== exp.length) return path;
    for (let i = 0; i < exp.length; i++) { const m = mismatch(mine[i], exp[i], path + '[' + i + ']'); if (m) return m; }
    return null;
  }
  if (typeof exp.type === 'string' && typeof exp.value === 'string' && Object.keys(exp).length === 2) {
    const { type, value } = exp as { type: string; value: string };
    switch (type) {
      case 'string': return mine === value ? null : path;
      case 'bool': return String(mine) === value ? null : path;
      case 'integer': return mine instanceof Num && mine.kind === 'int' && BigInt(cleanNum(mine.raw)) === BigInt(value) ? null : path;
      case 'float': {
        if (!(mine instanceof Num) || mine.kind !== 'float') return path;
        if (/nan/.test(value)) return /nan/.test(mine.raw) ? null : path;
        const r = cleanNum(mine.raw);
        // Same double, and the source digits are what we keep.
        return Object.is(Number(r.replace(/^(-?)inf$/, '$1Infinity')), Number(value.replace(/^\+?(-?)inf$/, '$1Infinity'))) ? null : path + ' ' + mine.raw + ' vs ' + value;
      }
      default: {
        if (!(mine instanceof DateTime)) return path;
        const kind = /^\d{4}-\d{2}-\d{2}$/.test(mine.raw) ? 'date-local' : /^\d{2}:/.test(mine.raw) ? 'time-local' : /([Zz]|[+-]\d{2}:\d{2})$/.test(mine.raw) ? 'datetime' : 'datetime-local';
        return kind === type && dateKey(mine.raw) === dateKey(value) ? null : path + ' ' + mine.raw + ' vs ' + value;
      }
    }
  }
  if (!isObj(mine)) return path;
  const ke = Object.keys(exp), km = Object.keys(mine);
  if (ke.length !== km.length) return path + ' keys';
  for (const k of ke) { const m = mismatch(mine[k], (exp as Record<string, Tagged>)[k], path + '.' + k); if (m) return m; }
  return null;
}

describe('toml-test conformance', () => {
  it('has the suite', () => {
    expect(valid.length).toBeGreaterThan(200);
    expect(invalid.length).toBeGreaterThan(400);
  });

  it('parses every valid document to the expected values', () => {
    const bad: string[] = [];
    for (const f of valid) {
      try {
        const doc = parseTomlDoc(files[f]);
        const m = mismatch(doc.value, JSON.parse(files[f.replace(/\.toml$/, '.json')]));
        if (m) bad.push(f + ': ' + m);
      } catch (e) { bad.push(f + ': ' + (e as Error).message); }
    }
    expect(bad).toEqual([]);
  });

  it('formats every valid document without changing a value, a literal or a comment', () => {
    const bad: string[] = [];
    for (const f of valid) {
      const doc = parseTomlDoc(files[f]);
      for (const sort of [false, true]) for (const ind of ['', '  ']) {
        try {
          const out = formatToml(doc, sort, ind);
          verifyToml(doc, out, sort);
          // Formatting is stable.
          expect(formatToml(parseTomlDoc(out), sort, ind)).toBe(out);
        } catch (e) { bad.push(f + (sort ? ' (sorted)' : '') + (ind ? ' (indented)' : '') + ': ' + (e as Error).message); }
      }
    }
    expect(bad).toEqual([]);
  });

  it('rejects every invalid document', () => {
    const accepted: string[] = [];
    for (const f of invalid) {
      try { parseTomlDoc(files[f]); accepted.push(f); } catch { /* expected */ }
    }
    expect(accepted).toEqual([]);
  });

  it('keeps numbers exactly as written', () => {
    const doc = parseTomlDoc('pi = 3.14159265358979323846\nh = 0xDEAD_BEEF\nt = 07:32:00.999999\n');
    expect(formatToml(doc)).toBe('pi = 3.14159265358979323846\nh = 0xDEAD_BEEF\nt = 07:32:00.999999\n');
    expect(numKey(doc.value.pi as Num)).toBe('314159265358979323846e-20');
  });
});
