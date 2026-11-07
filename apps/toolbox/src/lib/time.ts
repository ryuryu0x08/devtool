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

export interface Wall {
  ms: number;
  /** The wall time occurs twice (clocks turned back): the later instant. */
  alt?: number;
  /** The wall time doesn't exist (clocks turned forward): `ms` is the same moment read with the earlier offset. */
  gap?: boolean;
}

/** Wall-clock time in `tz` → epoch ms, reporting DST overlaps and gaps instead of silently picking. */
export function resolveWall(y: number, mo: number, d: number, h: number, mi: number, s: number, msp: number, tz: string): Wall {
  const g = utc(y, mo, d, h, mi, s, msp || 0);
  const before = tzOffset(g - 864e5, tz), after = tzOffset(g + 864e5, tz);
  const hits = [...new Set([g - before, g - after, g - tzOffset(g, tz)])]
    .filter((r) => { const p = tzParts(r, tz); return utc(p.y, p.m, p.d, p.h, p.mi, p.s, p.ms) === g; })
    .sort((a, b) => a - b);
  if (hits.length) return hits.length > 1 ? { ms: hits[0], alt: hits[hits.length - 1] } : { ms: hits[0] };
  return { ms: g - before, gap: true };
}

/** Wall-clock time in `tz` → epoch ms (earlier instant in an overlap; shifted forward in a gap). */
export function wallToMs(y: number, mo: number, d: number, h: number, mi: number, s: number, msp: number, tz: string): number {
  return resolveWall(y, mo, d, h, mi, s, msp, tz).ms;
}

/**
 * hh:mm of an offset, with :ss when it has seconds (local mean time before standard zones,
 * e.g. Shanghai +08:05:43 until 1901): rounding to minutes would name a different instant.
 */
function offHms(off: number): string {
  const a = Math.abs(Math.round(off / 1000)), sec = a % 60;
  return pad2(Math.floor(a / 3600)) + ':' + pad2(Math.floor(a / 60) % 60) + (sec ? ':' + pad2(sec) : '');
}

export function offLabel(off: number): string {
  return 'UTC' + (off < 0 ? '−' : '+') + offHms(off);
}

/** Fraction of a second: milliseconds plus any finer digits (`sub`), trailing zeros dropped (min 3 digits). */
export const fracStr = (ms: number, sub = '') => {
  const full = String(ms).padStart(3, '0') + sub;
  const t = full.replace(/0+$/, '');
  return t.length <= 3 ? full.slice(0, 3) : t;
};

export function fmtWall(ms: number, tz: string, withMs = false, sub = ''): string {
  const p = tzParts(ms, tz);
  let s = yearStr(p.y) + '-' + pad2(p.m) + '-' + pad2(p.d) + ' ' + pad2(p.h) + ':' + pad2(p.mi) + ':' + pad2(p.s);
  if (withMs && (p.ms || /[1-9]/.test(sub))) s += '.' + fracStr(p.ms, sub);
  return s;
}

export function fmtISO(ms: number, tz: string, sub = ''): string {
  const p = tzParts(ms, tz), off = tzOffset(ms, tz);
  return yearStr(p.y) + '-' + pad2(p.m) + '-' + pad2(p.d) + 'T' + pad2(p.h) + ':' + pad2(p.mi) + ':' + pad2(p.s) + '.' +
    fracStr(p.ms, sub) + (off < 0 ? '-' : '+') + offHms(off);
}

/** Exact decimal text of `ms + 0.sub` milliseconds, scaled by 10^-shift (3 → seconds). */
export function exactUnits(ms: number, sub: string, shift: number): string {
  const L = sub.length + shift;
  const total = BigInt(ms) * 10n ** BigInt(sub.length) + BigInt(sub || '0');
  const neg = total < 0n;
  const digits = (neg ? -total : total).toString().padStart(L + 1, '0');
  const int = L > 0 ? digits.slice(0, -L) : digits;
  const frac = L > 0 ? digits.slice(-L).replace(/0+$/, '') : '';
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
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
/** `ms` is floored; `sub` holds the digits finer than a millisecond, so `ms + 0.sub` is exact. */
export type TsResult = { ms: number; sub: string; u: TsUnit; dig: number } | { err: 'tsErr' | 'tsRange' } | null;

/** Parse a numeric timestamp; `unit: 'auto'` picks the unit from the digit count. */
export function parseTs(raw: string, unit: TsUnit | 'auto'): TsResult {
  const s = halfWidth(String(raw)).trim().replace(/[,_\s]/g, '');
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
  let sub = rest.replace(/0+$/, '');
  if (neg) {
    ms = -ms;
    // Floor, and keep the finer digits as a positive remainder: −1000.25 = −1001 + 0.75.
    if (sub) { ms -= 1; sub = (10n ** BigInt(sub.length) - BigInt(sub)).toString().padStart(sub.length, '0').replace(/0+$/, ''); }
  }
  if (!isFinite(ms) || Math.abs(ms) > 8.64e15) return { err: 'tsRange' };
  return { ms: ms || 0, sub, u, dig };
}

/** Parse a clock string such as `14:30`, `9点半`, `下午3点`, `9:00 pm` → [h, m, s, ms, finer digits]. */
function parseClock(str: string, strict = false): [number, number, number, number, string] | null {
  let s = (str || '').trim().toLowerCase();
  if (!s) return strict ? null : [0, 0, 0, 0, ''];
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
  return [h, mi, sec, ms, (m[4] || '').slice(3).replace(/0+$/, '')];
}

/** `sub`: digits finer than a millisecond; `alt` / `gap`: see Wall. */
export type TimeResult = { ms: number; sub?: string; note?: string; alt?: number; gap?: boolean } | { err: true } | null;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const EN_DATE = new RegExp(
  '^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?' +
  '(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MON + ',?\\s+(\\d{4})|' + MON + '\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4}))' +
  '(?:,?\\s+(?:at\\s+)?(.*))?$',
);
const US_ZONES: Record<string, number> = { est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420 };

/** Minutes east of UTC for Z / UTC / GMT / ±hh[:mm] / GMT±hhmm / US zone names; null if out of range. */
/** Offset text → milliseconds (Z, ±hh, ±hhmm, ±hh:mm, ±hh:mm:ss, GMT+0800, EST…). */
function offsetMs(off: string): number | null {
  const o = off.toLowerCase();
  if (o === 'z') return 0;
  if (o in US_ZONES) return US_ZONES[o] * 60000;
  const m = o.match(/^(?:gmt|utc)?(?:([+-])(\d{2})(?::?(\d{2})(?::(\d{2}))?)?)?$/);
  if (!m) return null;
  if (!m[1]) return 0;
  const h = +m[2], mi = +(m[3] || 0), sec = +(m[4] || 0);
  if (h > 23 || mi > 59 || sec > 59) return null;
  return (m[1] === '-' ? -1 : 1) * ((h * 60 + mi) * 60 + sec) * 1000;
}

/** Full-width ASCII (typed with a Chinese IME in full-width mode: １７９３, ：, －) → ASCII. */
export const halfWidth = (s: string) =>
  s.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');

const REL: Record<string, number> = {
  today: 0, '今天': 0, '今日': 0, tomorrow: 1, '明天': 1, '明日': 1,
  yesterday: -1, '昨天': -1, '昨日': -1, '后天': 2, '前天': -2,
};

/** Parse a human-entered date/time in `tz`. */
export function parseTime(raw: string, tz: string, now: number): TimeResult {
  const s = halfWidth(String(raw || '')).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (/^(now|现在|此刻)$/.test(low)) return { ms: now };
  if (/^\d{9,19}$/.test(s)) return { err: true };
  const td = tzParts(now, tz);
  const shift = (n: number) => {
    const t = new Date(utc(td.y, td.m, td.d + n));
    return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
  };
  const wall = (y: number, mo: number, d: number, t: [number, number, number, number, string]) =>
    ({ ...resolveWall(y, mo, d, t[0], t[1], t[2], t[3], tz), sub: t[4] });
  let m = low.match(/^(today|tomorrow|yesterday|今天|今日|明天|明日|昨天|昨日|后天|前天)\s*(.*)$/);
  if (m) {
    const [y, mo, d] = shift(REL[m[1]]);
    const t = parseClock(m[2]);
    if (!t) return { err: true };
    return wall(y, mo, d, t);
  }
  const tOnly = parseClock(low, true);
  if (tOnly) return wall(td.y, td.m, td.d, tOnly);
  /** A date plus the rest of the text: clock time and an optional zone (Z, ±hh[:mm], GMT+0800, EST…). */
  const dated = (y: number, mo: number, d: number, restIn: string): TimeResult => {
    // Reject impossible dates instead of rolling 02-31 over into March.
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { err: true };
    let rest = restIn.replace(/\s*\([^)]*\)\s*$/, '').trim();
    let off: string | null = null;
    const om = rest.match(/(z|utc|gmt|(?:gmt|utc)?[+-]\d{2}(?::\d{2}(?::\d{2})?|\d{2})?|[ecmp][sd]t)$/i);
    if (om) {
      off = om[1];
      rest = rest.slice(0, -om[1].length).trim();
    }
    const t = parseClock(rest);
    if (!t) return { err: true };
    if (off === null) return wall(y, mo, d, t);
    const offMs = offsetMs(off);
    if (offMs === null) return { err: true };
    return { ms: utc(y, mo, d, t[0], t[1], t[2], t[3]) - offMs, sub: t[4], note: off };
  };
  m = s.match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?(?:[T\s]*(.*))?$/i);
  if (m) return dated(+m[1], +m[2], +m[3], m[4] || '');
  m = s.match(/^(\d{1,2})[-/.月](\d{1,2})日?\s*(.*)$/);
  if (m) {
    const t = parseClock(m[3]);
    const mo = +m[1], d = +m[2];
    if (!t || mo < 1 || mo > 12 || d < 1 || d > daysIn(td.y, mo)) return { err: true };
    return wall(td.y, mo, d, t);
  }
  // English dates ("Oct 26 2026 14:30", "Mon, 26 Oct 2026 14:30:00 GMT", Date#toString). Parsed
  // here rather than with Date.parse, which is lenient and reads zone-less text in the
  // browser's zone (shifting times that fall in a DST gap there).
  m = low.match(EN_DATE);
  if (m) {
    const mo = MONTHS.indexOf((m[2] ?? m[4]).slice(0, 3)) + 1;
    return dated(+(m[3] ?? m[6]), mo, +(m[1] ?? m[5]), m[7] || '');
  }
  return { err: true };
}

export const hasMs = (r: TimeResult | TsResult): r is { ms: number } & Record<string, unknown> =>
  !!r && 'ms' in r && r.ms != null;
