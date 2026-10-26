import { describe, expect, it } from 'vitest';
import { fmtISO, fmtWall, parseTime, parseTs, wallToMs } from './time';
import { ConvertError, canon, diffNode, errInfo, sortDeep, stringifyJson, type DiffNode } from './data';
import { parseJson } from './json';
import { jsonToToml, parseToml, stringifyToml } from './toml';

const SH = 'Asia/Shanghai';
const NOW = Date.UTC(2026, 9, 26, 6, 0, 0); // 2026-10-26 14:00 in Shanghai

describe('parseTs', () => {
  it('detects units by digit count', () => {
    expect(parseTs('1793000000', 'auto')).toMatchObject({ u: 's', ms: 1793000000000 });
    expect(parseTs('1793000000123', 'auto')).toMatchObject({ u: 'ms', ms: 1793000000123 });
    expect(parseTs('1793000000123456', 'auto')).toMatchObject({ u: 'us', ms: 1793000000123 });
    expect(parseTs('1793000000123456789', 'auto')).toMatchObject({ u: 'ns' });
  });
  it('rejects non-numeric input', () => {
    expect(parseTs('abc', 'auto')).toEqual({ err: 'tsErr' });
    expect(parseTs('', 'auto')).toBeNull();
  });
});

describe('parseTime', () => {
  const at = (s: string) => {
    const r = parseTime(s, SH, NOW);
    return r && 'ms' in r ? fmtWall(r.ms, SH) : 'err';
  };
  it('understands common formats', () => {
    expect(at('2026-10-26 14:30')).toBe('2026-10-26 14:30:00');
    expect(at('2026/1/2')).toBe('2026-01-02 00:00:00');
    expect(at('明天 9点')).toBe('2026-10-27 09:00:00');
    expect(at('下午3点半')).toBe('2026-10-26 15:30:00');
    expect(at('14:30')).toBe('2026-10-26 14:30:00');
    expect(at('10/26 9:00')).toBe('2026-10-26 09:00:00');
    expect(at('tomorrow 9:00 pm')).toBe('2026-10-27 21:00:00');
    expect(at('now')).toBe('2026-10-26 14:00:00');
  });
  it('honours explicit offsets', () => {
    const r = parseTime('2026-10-26T00:00:00Z', SH, NOW);
    expect(r && 'ms' in r && r.ms).toBe(Date.UTC(2026, 9, 26));
  });
  it('rejects garbage', () => {
    expect(at('hello')).toBe('err');
  });
});

describe('wallToMs', () => {
  it('handles DST zones', () => {
    const ms = wallToMs(2026, 7, 1, 12, 0, 0, 0, 'America/New_York');
    expect(ms).toBe(Date.UTC(2026, 6, 1, 16));
  });
});

const flat = (d: DiffNode) => {
  const out: string[] = [];
  const walk = (n: DiffNode) => (n.st === 'mod' ? n.ch!.forEach(walk) : n.st !== 'same' && out.push(n.st + ' ' + n.path));
  walk(d);
  return out;
};
const diff = (a: string, b: string, io = false) => diffNode(parseJson(a), parseJson(b), null, '$', io);

describe('diffNode', () => {
  it('ignores key order', () => {
    expect(diff('{"a":1,"b":2}', '{"b":2,"a":1}').st).toBe('same');
  });
  it('reports adds, removes and changes with paths', () => {
    expect(flat(diff('{"a":1,"x":[1,2]}', '{"a":2,"y":true,"x":[1]}'))).toEqual(['chg $.a', 'del $.x[1]', 'add $.y']);
  });
  it('aligns arrays instead of comparing by position', () => {
    expect(flat(diff('[1,2,3]', '[0,1,2,3]'))).toEqual(['add $[0]']);
    expect(flat(diff('[1,2,3,4]', '[1,3,4]'))).toEqual(['del $[1]']);
    expect(flat(diff('[{"id":1,"v":1},{"id":2}]', '[{"id":1,"v":2},{"id":2},{"id":3}]'))).toEqual(['chg $[0].v', 'add $[2]']);
  });
  it('can ignore array order, including nested arrays and duplicates', () => {
    expect(diff('["a","b"]', '["b","a"]', true).st).toBe('same');
    expect(diff('["a","b"]', '["b","a"]', false).st).toBe('mod');
    expect(diff('[[1,2],[3]]', '[[3],[2,1]]', true).st).toBe('same');
    expect(flat(diff('[1,1]', '[1]', true))).toEqual(['del $[1]']);
  });
  it('compares numbers by value, keeps types distinct', () => {
    expect(diff('{"a":1.0,"b":1e2}', '{"a":1,"b":100}').st).toBe('same');
    expect(diff('[12345678901234567890]', '[12345678901234567891]').st).toBe('mod');
    expect(diff('{"a":1}', '{"a":"1"}').st).toBe('mod');
    expect(canon(parseToml('a = 1.0\nb = 2')) === canon(parseJson('{"b":2,"a":1}'))).toBe(true);
  });
  it('treats inherited names like constructor as ordinary keys', () => {
    expect(flat(diff('{}', '{"constructor":1}'))).toEqual(['add $.constructor']);
    expect(flat(diff('{"toString":1}', '{}'))).toEqual(['del $.toString']);
    expect(flat(diff('{"__proto__":{"x":1}}', '{"__proto__":{"x":2}}'))).toEqual(['chg $.__proto__.x']);
  });
});

describe('parseJson / stringifyJson', () => {
  it('formats without changing any number', () => {
    const src = '{"id":1234567890123456789,"f":1.50,"e":1E400,"z":-0,"n":-12.5e-3,"i":42}';
    expect(stringifyJson(parseJson(src))).toBe(src);
  });
  it('matches JSON.stringify layout', () => {
    const v = { a: [1, { b: 'x\n"' }], c: {}, d: [] };
    expect(stringifyJson(parseJson(JSON.stringify(v)), 2)).toBe(JSON.stringify(v, null, 2));
    expect(stringifyJson(parseJson(JSON.stringify(v)), '\t')).toBe(JSON.stringify(v, null, '\t'));
  });
  it('keeps __proto__ as data, also when sorting', () => {
    const v = sortDeep(parseJson('{"b":1,"__proto__":{"x":1}}'));
    expect(stringifyJson(v)).toBe('{"__proto__":{"x":1},"b":1}');
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
  });
  it('reports error positions', () => {
    const at = (s: string) => {
      try { parseJson(s); return null; } catch (e) { const i = errInfo(e, s, 'json'); return [i.line, i.col]; }
    };
    expect(at('{\n  "a": 1,\n  "b": }')).toEqual([3, 8]);
    expect(at('{"a":1,}')).toEqual([1, 8]);
    expect(at('[1 2]')).toEqual([1, 4]);
    expect(at('[01]')).toEqual([1, 3]);
    expect(at('"\\x"')).toEqual([1, 3]);
    expect(at('{"a":')).toEqual([1, 6]);
    expect(at('{"a":1}')).toBeNull();
  });
});

describe('TOML', () => {
  const rt = (s: string) => stringifyToml(parseToml(s));
  it('keeps floats as floats and big integers exact', () => {
    expect(rt('a = 1.0\nb = 1\nc = 9223372036854775807\nd = -0.0\ne = 1e3\nf = inf')).toBe(
      'a = 1.0\nb = 1\nc = 9223372036854775807\nd = -0.0\ne = 1000.0\nf = inf\n');
  });
  it('round-trips nested tables and arrays of tables', () => {
    const src = 'title = "t"\nmix = [1, { b = 2 }]\n[a]\nx = 1\n[a.b]\ny = 2\n[[o]]\nid = 1\n[o.meta]\nr = "x"\n[[o]]\nid = 2\n[[o.c]]\nz = 1\n["k.y"]\n"" = 3\n[e]\n';
    const out = rt(src);
    expect(canon(parseToml(out))).toBe(canon(parseToml(src)));
    expect(out).toContain('[o.meta]');
    expect(out).toContain('[[o.c]]');
  });
  it('escapes strings validly', () => {
    const v = parseToml('s = "tab\\tq\\"\\\\ \\u007f é 😀"');
    expect(canon(parseToml(stringifyToml(v)))).toBe(canon(v));
  });
  it('keeps dates as written', () => {
    expect(rt('a = 2026-10-26T14:30:00+08:00\nb = 1979-05-27\nc = 07:32:00')).toBe('a = 2026-10-26T14:30:00+08:00\nb = 1979-05-27\nc = 07:32:00\n');
  });
  it('converts JSON with ints as ints and refuses null', () => {
    expect(stringifyToml(jsonToToml(parseJson('{"a":1,"b":1.5,"c":12345678901234567890,"d":[1,2]}')) as Record<string, unknown>))
      .toBe('a = 1\nb = 1.5\nc = 12345678901234567890.0\nd = [1, 2]\n');
    expect(() => jsonToToml(parseJson('{"a":{"b":null}}'))).toThrow(ConvertError);
  });
  it('refuses nan / inf when converting to JSON', () => {
    expect(() => stringifyJson(parseToml('a = nan'))).toThrow(ConvertError);
  });
});

describe('review round 2', () => {
  it('reports both A and B locations for moved array elements', () => {
    const d = diff('[1,{"x":1}]', '[0,1,{"x":2}]');
    const chg = d.ch!.find((c) => c.st === 'mod')!.ch![0];
    expect(d.ch!.map((c) => c.st)).toEqual(['add', 'same', 'mod']);
    expect([chg.st, chg.path, chg.pathB]).toEqual(['chg', '$[1].x', '$[2].x']);
  });
  it('lists duplicate JSON keys and accepts a BOM', () => {
    const dupes: string[] = [];
    expect(stringifyJson(parseJson('﻿{"a":1,"a":2,"b":[{"c":1,"c":2}]}', dupes))).toBe('{"a":2,"b":[{"c":2}]}');
    expect(dupes).toEqual(['$.a', '$.b[0].c']);
  });
  it('rejects impossible dates', () => {
    const ok = (s: string) => { const r = parseTime(s, SH, NOW); return !!r && 'ms' in r; };
    expect(ok('2026-02-31')).toBe(false);
    expect(ok('2026-02-29')).toBe(false);
    expect(ok('2024-02-29')).toBe(true);
    expect(ok('10/32')).toBe(false);
    expect(ok('13/01')).toBe(false);
  });
  it('accepts long fractions, short offsets, years before 100', () => {
    const ms = (s: string) => { const r = parseTime(s, SH, NOW); return r && 'ms' in r ? r.ms : null; };
    expect(ms('2026-10-26T14:30:00.123456Z')).toBe(Date.UTC(2026, 9, 26, 14, 30, 0, 123));
    expect(ms('2026-10-26 14:30+08')).toBe(Date.UTC(2026, 9, 26, 6, 30));
    expect(fmtWall(ms('0050-03-01 12:00')!, SH)).toBe('0050-03-01 12:00:00');
  });
  it('reads zone-less English dates in the selected zone', () => {
    const r = parseTime('Oct 26 2026 14:30', SH, NOW);
    expect(r && 'ms' in r && fmtWall(r.ms, SH)).toBe('2026-10-26 14:30:00');
    const g = parseTime('Mon, 26 Oct 2026 14:30:00 GMT', SH, NOW);
    expect(g && 'ms' in g && g.ms).toBe(Date.UTC(2026, 9, 26, 14, 30));
  });
  it('converts fractional timestamps exactly', () => {
    expect(parseTs('1700000000.001', 'auto')).toMatchObject({ ms: 1700000000001 });
    expect(parseTs('1.005', 's')).toMatchObject({ ms: 1005 });
    expect(parseTs('-1.5', 's')).toMatchObject({ ms: -1500 });
    expect(parseTs('-0.0001', 's')).toMatchObject({ ms: -1 });
    expect(parseTs('1793000000123456789', 'auto')).toMatchObject({ u: 'ns', ms: 1793000000123 });
  });
  it('formats BCE years with a sign', () => {
    expect(fmtISO(Date.UTC(-100, 0, 1), 'UTC')).toBe('-000100-01-01T00:00:00.000+00:00');
  });
});
