// Time zone helpers built on Intl, plus the lenient timestamp / date parsers.

export const pad2 = (n: number) => String(n).padStart(2, '0');

export interface Parts {
  y: number; m: number; d: number; h: number; mi: number; s: number; wd: number; ms: number;
}

/** Date.UTC without its 0–99 → 1900–1999 year mapping; fields may overflow. */
export function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  t.setUTCHours(h, mi, s, ms);
  return t.getTime();
}

export const daysIn = (y: number, mo: number) => new Date(utc(y, mo + 1, 0)).getUTCDate();

/** ISO-style year: 4 digits, or signed 6 digits outside 0000–9999. */
const yearStr = (y: number) => (y >= 0 && y <= 9999 ? String(y).padStart(4, '0') : (y < 0 ? '-' : '+') + String(Math.abs(y)).padStart(6, '0'));

const fmtCache: Record<string, Intl.DateTimeFormat> = {};
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function tzParts(ms: number, tz: string): Parts {
  let F = fmtCache[tz];
  if (!F) {
    F = fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', era: 'short',
    });
  }
  const o: Record<string, string> = {};
  for (const p of F.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    // Intl counts BC years upwards (1 BC, 2 BC…); astronomical years are 0, −1…
    y: o.era === 'BC' || o.era === 'B' ? 1 - +o.year : +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second,
    wd: WD[o.weekday], ms: ((ms % 1000) + 1000) % 1000,
  };
}

export function tzOffset(ms: number, tz: string): number {
  const p = tzParts(ms, tz);
  return utc(p.y, p.m, p.d, p.h, p.mi, p.s) - (ms - p.ms);
}

/** Wall-clock time in `tz` → epoch ms (handles DST transitions). */
export function wallToMs(y: number, mo: number, d: number, h: number, mi: number, s: number, msp: number, tz: string): number {
  const g = utc(y, mo, d, h, mi, s, msp || 0);
  const o1 = tzOffset(g, tz);
  let r = g - o1;
  const o2 = tzOffset(r, tz);
  if (o2 !== o1) r = g - o2;
  return r;
}

export function offLabel(off: number): string {
  const m = Math.round(off / 60000), a = Math.abs(m);
  return 'UTC' + (m < 0 ? '−' : '+') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}

export function fmtWall(ms: number, tz: string, withMs = false): string {
  const p = tzParts(ms, tz);
  let s = yearStr(p.y) + '-' + pad2(p.m) + '-' + pad2(p.d) + ' ' + pad2(p.h) + ':' + pad2(p.mi) + ':' + pad2(p.s);
  if (withMs && p.ms) s += '.' + String(p.ms).padStart(3, '0');
  return s;
}

export function fmtISO(ms: number, tz: string): string {
  const p = tzParts(ms, tz);
  const m = Math.round(tzOffset(ms, tz) / 60000), a = Math.abs(m);
  return yearStr(p.y) + '-' + pad2(p.m) + '-' + pad2(p.d) + 'T' + pad2(p.h) + ':' + pad2(p.mi) + ':' + pad2(p.s) + '.' +
    String(p.ms).padStart(3, '0') + (m < 0 ? '-' : '+') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}

export function relTime(ms: number, now: number, loc: string): string {
  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
  const d = (ms - now) / 1000, a = Math.abs(d);
  const U: [number, Intl.RelativeTimeFormatUnit, number][] = [
    [60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600], [86400 * 30, 'day', 86400],
    [86400 * 365, 'month', 86400 * 30], [Infinity, 'year', 86400 * 365],
  ];
  for (const [lim, u, div] of U) if (a < lim) return rtf.format(Math.round(d / div), u);
  return '';
}

export type TsUnit = 's' | 'ms' | 'us' | 'ns';
export type TsResult = { ms: number; u: TsUnit; dig: number } | { err: 'tsErr' | 'tsRange' } | null;

/** Parse a numeric timestamp; `unit: 'auto'` picks the unit from the digit count. */
export function parseTs(raw: string, unit: TsUnit | 'auto'): TsResult {
  const s = String(raw).trim().replace(/[,_\s]/g, '');
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { err: 'tsErr' };
  const neg = s[0] === '-';
  const [int, frac = ''] = s.replace('-', '').split('.');
  const dig = int.length;
  const u: TsUnit = unit === 'auto' ? (dig <= 11 ? 's' : dig <= 14 ? 'ms' : dig <= 17 ? 'us' : 'ns') : unit;
  // Shift the decimal point in the text (exact; float maths can be 1 ms off), then floor.
  const point = int.length + { s: 3, ms: 0, us: -3, ns: -6 }[u];
  const digits = (int + frac).padEnd(point, '0');
  const whole = point > 0 ? digits.slice(0, point) : '0';
  const rest = point > 0 ? digits.slice(point) : digits;
  let ms = Number(whole);
  if (neg) ms = -ms - (/[1-9]/.test(rest) ? 1 : 0);
  if (!isFinite(ms) || Math.abs(ms) > 8.64e15) return { err: 'tsRange' };
  return { ms: ms || 0, u, dig };
}

/** Parse a clock string such as `14:30`, `9点半`, `下午3点`, `9:00 pm`. */
function parseClock(str: string, strict = false): [number, number, number, number] | null {
  let s = (str || '').trim().toLowerCase();
  if (!s) return strict ? null : [0, 0, 0, 0];
  let pm = 0;
  const ap = s.match(/^(上午|早上|凌晨|中午|下午|晚上|傍晚)\s*/);
  if (ap) {
    pm = /下午|晚上|傍晚/.test(ap[1]) ? 1 : ap[1] === '中午' ? 2 : 0;
    s = s.slice(ap[0].length);
  }
  const tp = s.match(/\s*(am|pm)$/);
  if (tp) {
    pm = tp[1] === 'pm' ? 1 : 3;
    s = s.slice(0, -tp[0].length);
  }
  if (strict && !/[:：点时]/.test(s) && !tp) return null;
  const m = s.match(/^(\d{1,2})(?:[:：点时](?:(\d{1,2}|半)分?)?(?:[:：](\d{1,2})秒?)?(?:[.,](\d+))?)?$/);
  if (!m) return null;
  let h = +m[1];
  const mi = m[2] === '半' ? 30 : +(m[2] || 0), sec = +(m[3] || 0), ms = +(m[4] || '0').slice(0, 3).padEnd(3, '0');
  if (pm === 1 && h < 12) h += 12;
  if (pm === 2 && h < 11) h += 12;
  if (pm === 3 && h === 12) h = 0;
  if (h > 23 || mi > 59 || sec > 59) return null;
  return [h, mi, sec, ms];
}

export type TimeResult = { ms: number; note?: string } | { err: true } | null;

const REL: Record<string, number> = {
  today: 0, '今天': 0, '今日': 0, tomorrow: 1, '明天': 1, '明日': 1,
  yesterday: -1, '昨天': -1, '昨日': -1, '后天': 2, '前天': -2,
};

/** Parse a human-entered date/time in `tz`. */
export function parseTime(raw: string, tz: string, now: number): TimeResult {
  const s = String(raw || '').trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (/^(now|现在|此刻)$/.test(low)) return { ms: now };
  if (/^\d{9,19}$/.test(s)) return { err: true };
  const td = tzParts(now, tz);
  const shift = (n: number) => {
    const t = new Date(utc(td.y, td.m, td.d + n));
    return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  };
  let m = low.match(/^(today|tomorrow|yesterday|今天|今日|明天|明日|昨天|昨日|后天|前天)\s*(.*)$/);
  if (m) {
    const [y, mo, d] = shift(REL[m[1]]);
    const t = parseClock(m[2]);
    if (!t) return { err: true };
    return { ms: wallToMs(y, mo, d, t[0], t[1], t[2], t[3], tz) };
  }
  const tOnly = parseClock(low, true);
  if (tOnly) return { ms: wallToMs(td.y, td.m, td.d, tOnly[0], tOnly[1], tOnly[2], tOnly[3], tz) };
  m = s.match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?(?:[T\s]*(.*))?$/i);
  if (m) {
    let rest = (m[4] || '').trim();
    let off: string | null = null;
    const om = rest.match(/(z|utc|gmt|[+-]\d{2}(?::?\d{2})?)$/i);
    if (om) {
      off = om[1];
      rest = rest.slice(0, -om[1].length).trim();
    }
    const t = parseClock(rest);
    if (!t) return { err: true };
    const y = +m[1], mo = +m[2], d = +m[3];
    // Reject impossible dates instead of rolling 02-31 over into March.
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { err: true };
    if (off) {
      let om2 = 0;
      if (!/^(z|utc|gmt)$/i.test(off)) {
        const sg = off[0] === '-' ? -1 : 1;
        const dg = off.slice(1).replace(':', '');
        om2 = sg * (+dg.slice(0, 2) * 60 + +dg.slice(2));
      }
      return { ms: utc(y, mo, d, t[0], t[1], t[2], t[3]) - om2 * 60000, note: off };
    }
    return { ms: wallToMs(y, mo, d, t[0], t[1], t[2], t[3], tz) };
  }
  m = s.match(/^(\d{1,2})[-/.月](\d{1,2})日?\s*(.*)$/);
  if (m) {
    const t = parseClock(m[3]);
    const mo = +m[1], d = +m[2];
    if (!t || mo < 1 || mo > 12 || d < 1 || d > daysIn(td.y, mo)) return { err: true };
    return { ms: wallToMs(td.y, mo, d, t[0], t[1], t[2], t[3], tz) };
  }
  if (/[a-z]/i.test(s)) {
    const p = Date.parse(s);
    if (!isNaN(p)) {
      // Without an explicit zone, Date.parse uses the browser's zone — re-read the wall time in `tz`.
      if (/\b(z|utc|gmt|[ecmp][sd]t)\b|[+-]\d{2}:?\d{2}\b/i.test(s)) return { ms: p };
      const L = new Date(p);
      return { ms: wallToMs(L.getFullYear(), L.getMonth() + 1, L.getDate(), L.getHours(), L.getMinutes(), L.getSeconds(), L.getMilliseconds(), tz) };
    }
  }
  return { err: true };
}

export const hasMs = (r: TimeResult | TsResult): r is { ms: number } & Record<string, unknown> =>
  !!r && 'ms' in r && r.ms != null;
