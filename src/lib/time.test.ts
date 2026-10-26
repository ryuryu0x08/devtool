import { describe, expect, it } from 'vitest';
import { exactUnits, fmtISO, fmtWall, parseTime, parseTs, resolveWall, wallToMs } from './time';

const SH = 'Asia/Shanghai';
const NOW = Date.UTC(2026, 9, 26, 6, 0, 0); // 2026-10-26 14:00 in Shanghai

describe('parseTs', () => {
  it('detects units by digit count', () => {
    expect(parseTs('1793000000', 'auto')).toMatchObject({ u: 's', ms: 1793000000000 });
    expect(parseTs('1793000000123', 'auto')).toMatchObject({ u: 'ms', ms: 1793000000123 });
    expect(parseTs('1793000000123456', 'auto')).toMatchObject({ u: 'us', ms: 1793000000123 });
    expect(parseTs('1793000000123456789', 'auto')).toMatchObject({ u: 'ns', ms: 1793000000123 });
  });
  it('rejects non-numeric input', () => {
    expect(parseTs('abc', 'auto')).toEqual({ err: 'tsErr' });
    expect(parseTs('', 'auto')).toBeNull();
  });
  it('converts fractional timestamps exactly', () => {
    expect(parseTs('1700000000.001', 'auto')).toMatchObject({ ms: 1700000000001 });
    expect(parseTs('1.005', 's')).toMatchObject({ ms: 1005 });
    expect(parseTs('-1.5', 's')).toMatchObject({ ms: -1500 });
    expect(parseTs('-0.0001', 's')).toMatchObject({ ms: -1 });
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
  it('honours explicit offsets, including short ones', () => {
    const ms = (s: string) => { const r = parseTime(s, SH, NOW); return r && 'ms' in r ? r.ms : null; };
    expect(ms('2026-10-26T00:00:00Z')).toBe(Date.UTC(2026, 9, 26));
    expect(ms('2026-10-26 14:30+08')).toBe(Date.UTC(2026, 9, 26, 6, 30));
    expect(ms('2026-10-26T14:30:00.123456Z')).toBe(Date.UTC(2026, 9, 26, 14, 30, 0, 123));
  });
  it('rejects garbage and impossible dates', () => {
    expect(at('hello')).toBe('err');
    expect(at('2026-02-31')).toBe('err');
    expect(at('2026-02-29')).toBe('err');
    expect(at('2024-02-29')).toBe('2024-02-29 00:00:00');
    expect(at('10/32')).toBe('err');
    expect(at('13/01')).toBe('err');
  });
  it('reads zone-less English dates in the selected zone', () => {
    expect(at('Oct 26 2026 14:30')).toBe('2026-10-26 14:30:00');
    const g = parseTime('Mon, 26 Oct 2026 14:30:00 GMT', SH, NOW);
    expect(g && 'ms' in g && g.ms).toBe(Date.UTC(2026, 9, 26, 14, 30));
  });
  it('handles years before 100 and BCE', () => {
    expect(at('0050-03-01 12:00')).toBe('0050-03-01 12:00:00');
    expect(fmtISO(Date.UTC(-100, 0, 1), 'UTC')).toBe('-000100-01-01T00:00:00.000+00:00');
  });
});

describe('wallToMs', () => {
  it('handles DST zones', () => {
    expect(wallToMs(2026, 7, 1, 12, 0, 0, 0, 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 16));
  });
});

describe('precision finer than a millisecond is kept', () => {
  it('µs / ns timestamps keep their extra digits', () => {
    expect(parseTs('1793000000123456789', 'auto')).toMatchObject({ ms: 1793000000123, sub: '456789' });
    expect(parseTs('1793000000123456', 'auto')).toMatchObject({ ms: 1793000000123, sub: '456' });
    expect(parseTs('1700000000.123456', 'auto')).toMatchObject({ ms: 1700000000123, sub: '456' });
    expect(parseTs('1700000000.5', 'auto')).toMatchObject({ ms: 1700000000500, sub: '' });
  });
  it('negative timestamps: floor + positive remainder, still exact', () => {
    const r = parseTs('-1.0005', 's') as { ms: number; sub: string };
    expect(r).toMatchObject({ ms: -1001, sub: '5' });
    expect(exactUnits(r.ms, r.sub, 3)).toBe('-1.0005');
  });
  it('exact unit conversion', () => {
    expect(exactUnits(1793000000123, '456789', 3)).toBe('1793000000.123456789');
    expect(exactUnits(1793000000123, '456789', 0)).toBe('1793000000123.456789');
    expect(exactUnits(1793000000000, '', 3)).toBe('1793000000');
    expect(exactUnits(-500, '', 3)).toBe('-0.5');
  });
  it('shown in formatted dates', () => {
    expect(fmtISO(1793000000123, 'UTC', '456789')).toBe('2026-10-26T07:33:20.123456789+00:00');
    expect(fmtWall(1793000000000, 'UTC', true, '000001')).toBe('2026-10-26 07:33:20.000000001');
    expect(fmtWall(1793000000000, 'UTC', true, '')).toBe('2026-10-26 07:33:20');
  });
  it('date input with µs keeps them', () => {
    const r = parseTime('2026-10-26T14:30:00.123456Z', SH, NOW) as { ms: number; sub: string };
    expect(exactUnits(r.ms, r.sub, 3)).toBe(String(Date.UTC(2026, 9, 26, 14, 30) / 1000) + '.123456');
  });
});

describe('DST: ambiguous and non-existent local times are reported', () => {
  const NY = 'America/New_York';
  it('fall back: 01:30 happens twice', () => {
    const w = resolveWall(2026, 11, 1, 1, 30, 0, 0, NY);
    expect(w.ms).toBe(Date.UTC(2026, 10, 1, 5, 30)); // EDT, first
    expect(w.alt).toBe(Date.UTC(2026, 10, 1, 6, 30)); // EST, second
    const r = parseTime('2026-11-01 01:30', NY, NOW) as { alt?: number };
    expect(r.alt).toBe(Date.UTC(2026, 10, 1, 6, 30));
  });
  it('spring forward: 02:30 does not exist', () => {
    const w = resolveWall(2026, 3, 8, 2, 30, 0, 0, NY);
    expect(w.gap).toBe(true);
    expect(fmtWall(w.ms, NY)).toBe('2026-03-08 03:30:00');
  });
  it('ordinary times are unambiguous', () => {
    expect(resolveWall(2026, 7, 1, 12, 0, 0, 0, NY)).toEqual({ ms: Date.UTC(2026, 6, 1, 16) });
    expect(resolveWall(2026, 10, 26, 14, 30, 0, 0, SH)).toEqual({ ms: Date.UTC(2026, 9, 26, 6, 30) });
  });
});

describe('lenient parsing never guesses', () => {
  const at = (s: string) => {
    const r = parseTime(s, SH, NOW);
    return r && 'ms' in r ? fmtWall(r.ms, SH) : 'err';
  };
  it.each(['hello 2020', 'foo 1', 'Oct 32 2026', 'Feb 30 2026', '2026-10-26T10:00+25:00', '2026-10-26T10:00+08:60', 'abc'])('%s → not recognised', (s) => {
    expect(at(s)).toBe('err');
  });
  it('real English dates still work', () => {
    expect(at('26 Oct 2026 14:30')).toBe('2026-10-26 14:30:00');
    expect(at('October 26, 2026')).toBe('2026-10-26 00:00:00');
  });
});

describe('English dates are parsed without the browser zone', () => {
  const ms = (s: string, tz = SH) => { const r = parseTime(s, tz, NOW); return r && 'ms' in r ? r.ms : null; };
  it('zone-less text is read in the selected zone, whatever the system zone', () => {
    // 02:30 on 8 Mar 2026 does not exist in New York; it does in Shanghai.
    expect(ms('Mar 8 2026 02:30')).toBe(Date.UTC(2026, 2, 7, 18, 30));
    expect(ms('March 8th, 2026 at 2:30 am')).toBe(Date.UTC(2026, 2, 7, 18, 30));
  });
  it('formats with zones', () => {
    expect(ms('Mon Oct 26 2026 14:30:00 GMT+0800 (China Standard Time)')).toBe(Date.UTC(2026, 9, 26, 6, 30));
    expect(ms('Mon, 26 Oct 2026 14:30:00 GMT')).toBe(Date.UTC(2026, 9, 26, 14, 30));
    expect(ms('Mon, 26 Oct 2026 14:30:00 EST')).toBe(Date.UTC(2026, 9, 26, 19, 30));
    expect(ms('26 Oct 2026 14:30 +05:30')).toBe(Date.UTC(2026, 9, 26, 9, 0));
  });
  it.each(['Octopus 26 2026', 'Oct 26', '31 Sep 2026', 'Oct 26 2026 25:00', 'Oct 26 2026 14:30 GMT+2500'])('%s → not recognised', (s) => {
    expect(ms(s)).toBeNull();
  });
});
