import { describe, expect, it } from 'vitest';
import { fmtISO, fmtWall, parseTime, parseTs, wallToMs } from './time';

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
