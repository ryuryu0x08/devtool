import { describe, expect, it } from 'vitest';
import { fmtWall, parseTime, parseTs, wallToMs } from './time';
import { diffNode, errInfo } from './data';

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

describe('diffNode', () => {
  it('ignores key order', () => {
    expect(diffNode({ a: 1, b: 2 }, { b: 2, a: 1 }, null, '$', false).st).toBe('same');
  });
  it('reports adds, removes and changes with paths', () => {
    const d = diffNode({ a: 1, x: [1, 2] }, { a: 2, y: true, x: [1] }, null, '$', false);
    const flat: string[] = [];
    const walk = (n: typeof d) => (n.st === 'mod' ? n.ch!.forEach(walk) : n.st !== 'same' && flat.push(n.st + ' ' + n.path));
    walk(d);
    expect(flat).toEqual(['chg $.a', 'del $.x[1]', 'add $.y']);
  });
  it('can ignore array order', () => {
    expect(diffNode(['a', 'b'], ['b', 'a'], null, '$', true).st).toBe('same');
    expect(diffNode(['a', 'b'], ['b', 'a'], null, '$', false).st).toBe('mod');
  });
});

describe('errInfo', () => {
  it('locates JSON errors', () => {
    const src = '{\n  "a": 1,\n  "b": }';
    let e: unknown;
    try { JSON.parse(src); } catch (x) { e = x; }
    const info = errInfo(e, src, 'json');
    expect(info.line).toBe(3);
  });
});

describe('jsonErrorPos', () => {
  it('agrees with JSON.parse on valid input', async () => {
    const { jsonErrorPos } = await import('./data');
    expect(jsonErrorPos('{"a":[1,-2.5e3,true,null,"x\\u00e9"],"b":{}}')).toBeNull();
    expect(jsonErrorPos('{"a":1,}')).toBe(7);
    expect(jsonErrorPos('[1 2]')).toBe(3);
  });
});
