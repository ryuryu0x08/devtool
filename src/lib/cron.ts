// Cron expressions: Unix (5 fields), Spring (6, seconds first) and Quartz (6–7, Sunday = 1).
// Description in words and the next run times in a time zone, wall clock and DST included.
import { resolveWall, tzParts, utc } from './time';

export type Dialect = 'unix' | 'spring' | 'quartz';
type Kind = 'sec' | 'min' | 'hour' | 'dom' | 'mon' | 'dow' | 'year';

export class CronError extends Error {
  constructor(readonly code: 'count' | 'value' | 'range' | 'step' | 'special' | 'question' | 'quartzQ', readonly field: number, readonly token = '') {
    super(code + ' in field ' + field + ': ' + token);
  }
}

interface Field {
  raw: string;
  /** Every value it allows (empty for day fields that only use L / W / #). */
  vals: number[];
  /** Written as "*" or "?" (or begins with "*", as Vixie cron reads it). */
  star: boolean;
  any: boolean;
  last?: number[];        // dom: L-n (offset from the last day); dow: nL (last such weekday)
  nearestW?: number[];    // dom: nW
  lastW?: boolean;        // dom: LW
  nth?: [number, number][]; // dow: d#k
}

export interface Cron { dialect: Dialect; f: Record<Kind, Field>; macro?: string; reboot?: boolean }

const RANGE: Record<Kind, [number, number]> = { sec: [0, 59], min: [0, 59], hour: [0, 23], dom: [1, 31], mon: [1, 12], dow: [0, 7], year: [1970, 2099] };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MACROS: Record<string, string> = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };

function field(raw: string, kind: Kind, idx: number, d: Dialect): Field {
  const [lo0, hi0] = kind === 'dow' && d === 'quartz' ? [1, 7] : RANGE[kind];
  const f: Field = { raw, vals: [], star: raw.startsWith('*') || raw === '?', any: raw === '*' || raw === '?' };
  if (raw === '?') {
    if (d === 'unix' || (kind !== 'dom' && kind !== 'dow')) throw new CronError('question', idx, raw);
    f.vals = range(RANGE[kind][0], kind === 'dow' ? 6 : RANGE[kind][1]);
    return f;
  }
  const name = (t: string): number => {
    const u = t.toUpperCase();
    if (kind === 'mon' && MONTHS.includes(u)) return MONTHS.indexOf(u) + 1;
    if (kind === 'dow' && DAYS.includes(u)) return DAYS.indexOf(u) + (d === 'quartz' ? 1 : 0);
    if (!/^\d+$/.test(t)) throw new CronError('value', idx, t);
    const n = +t;
    if (n < lo0 || n > hi0) throw new CronError('value', idx, t);
    return n;
  };
  const set = new Set<number>();
  for (const part of raw.split(',')) {
    if (!part) throw new CronError('value', idx, raw);
    const special = d !== 'unix' && (kind === 'dom' || kind === 'dow');
    let m: RegExpExecArray | null;
    if (special && kind === 'dom' && part.toUpperCase() === 'L') { (f.last ??= []).push(0); continue; }
    if (special && kind === 'dom' && (m = /^L-(\d+)$/i.exec(part))) { if (+m[1] > 30) throw new CronError('value', idx, part); (f.last ??= []).push(+m[1]); continue; }
    if (special && kind === 'dom' && part.toUpperCase() === 'LW') { f.lastW = true; continue; }
    if (special && kind === 'dom' && (m = /^(\d+)W$/i.exec(part))) { const n = name(m[1]); (f.nearestW ??= []).push(n); continue; }
    if (special && kind === 'dow' && (m = /^(\w+)L$/i.exec(part))) { (f.last ??= []).push(dowNorm(name(m[1]), d)); continue; }
    if (special && kind === 'dow' && (m = /^(\w+)#([1-5])$/.exec(part))) { (f.nth ??= []).push([dowNorm(name(m[1]), d), +m[2]]); continue; }
    if (/[LW#]/i.test(part) && !/^[A-Z]{3}$/i.test(part)) throw new CronError(d === 'unix' ? 'special' : 'value', idx, part);
    const [base, stepS] = part.split('/');
    if (part.split('/').length > 2) throw new CronError('step', idx, part);
    const step = stepS === undefined ? 1 : /^\d+$/.test(stepS) && +stepS > 0 ? +stepS : NaN;
    if (Number.isNaN(step)) throw new CronError('step', idx, part);
    let lo: number, hi: number;
    if (base === '*') [lo, hi] = [lo0, kind === 'dow' && d !== 'quartz' ? 6 : hi0];
    else if (base.includes('-')) {
      const [a, b] = base.split('-');
      lo = name(a); hi = name(b);
      if (lo > hi) throw new CronError('range', idx, part);
    } else {
      lo = name(base);
      hi = stepS === undefined ? lo : (kind === 'dow' && d !== 'quartz' ? 6 : hi0);
    }
    for (let v = lo; v <= hi; v += step) set.add(kind === 'dow' ? dowNorm(v, d) : v);
  }
  f.vals = [...set].sort((a, b) => a - b);
  return f;
}

/** Weekdays inside: 0 = Sunday … 6 = Saturday (Unix / Spring 7 is Sunday too; Quartz 1 is Sunday). */
const dowNorm = (v: number, d: Dialect) => (d === 'quartz' ? v - 1 : v % 7);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** The dialect a written expression is in, when not chosen: 5 fields Unix, 6 Spring, 7 Quartz. */
export function guessDialect(expr: string): Dialect {
  const n = expr.trim().split(/\s+/).length;
  return expr.trim().startsWith('@') || n <= 5 ? 'unix' : n === 6 ? 'spring' : 'quartz';
}

export function parseCron(expr: string, d: Dialect): Cron {
  let s = expr.trim();
  if (s.toLowerCase() === '@reboot') return { dialect: 'unix', f: {} as Record<Kind, Field>, reboot: true, macro: '@reboot' };
  let macro: string | undefined;
  if (s.startsWith('@')) {
    const m = MACROS[s.toLowerCase()];
    if (!m) throw new CronError('value', 0, s);
    macro = s.toLowerCase();
    s = m;
    d = 'unix';
  }
  const parts = s.split(/\s+/);
  const kinds: Kind[] = d === 'unix' ? ['min', 'hour', 'dom', 'mon', 'dow'] : ['sec', 'min', 'hour', 'dom', 'mon', 'dow', 'year'];
  const want = d === 'unix' ? [5] : d === 'spring' ? [6] : [6, 7];
  if (!want.includes(parts.length)) throw new CronError('count', parts.length, s);
  const f = {} as Record<Kind, Field>;
  kinds.forEach((k, i) => { f[k] = field(parts[i] ?? '*', k, i, d); });
  if (d === 'unix') f.sec = field('0', 'sec', -1, d);
  if (!f.year) f.year = field('*', 'year', -1, d);
  if (d === 'quartz' && (parts[3] === '?') === (parts[5] === '?')) throw new CronError('quartzQ', 3, parts[3] + ' ' + parts[5]);
  return { dialect: d, f, macro };
}

const daysIn = (y: number, m: number) => new Date(utc(y, m + 1, 0)).getUTCDate();
const weekday = (y: number, m: number, d: number) => new Date(utc(y, m, d)).getUTCDay();

function domMatch(f: Field, y: number, m: number, d: number): boolean {
  const last = daysIn(y, m);
  if (f.vals.includes(d)) return true;
  if (f.last?.some((off) => d === last - off)) return true;
  const wd = (day: number) => { const w = weekday(y, m, day); return w > 0 && w < 6; };
  if (f.lastW) { let x = last; while (!wd(x)) x--; if (d === x) return true; }
  for (const n of f.nearestW ?? []) {
    if (n > last) continue;
    // Nearest weekday within the same month (Quartz: 1W on a Saturday is Monday the 3rd).
    let x = n;
    const w = weekday(y, m, n);
    if (w === 6) x = n === 1 ? 3 : n - 1;
    else if (w === 0) x = n === last ? n - 2 : n + 1;
    if (d === x) return true;
  }
  return false;
}

function dowMatch(f: Field, y: number, m: number, d: number): boolean {
  const w = weekday(y, m, d);
  if (f.vals.includes(w)) return true;
  if (f.last?.includes(w) && d + 7 > daysIn(y, m)) return true;
  if (f.nth?.some(([dw, k]) => dw === w && Math.ceil(d / 7) === k)) return true;
  return false;
}

function dayMatch(c: Cron, y: number, m: number, d: number): boolean {
  const { dom, dow } = c.f;
  if (c.dialect === 'unix') {
    // Vixie cron: when both are restricted, either one matching is enough.
    if (dom.star && dow.star) return true;
    if (dom.star) return dowMatch(dow, y, m, d);
    if (dow.star) return domMatch(dom, y, m, d);
    return domMatch(dom, y, m, d) || dowMatch(dow, y, m, d);
  }
  return (dom.any || domMatch(dom, y, m, d)) && (dow.any || dowMatch(dow, y, m, d));
}

export interface Run { ms: number; repeated: boolean }

/** The next `n` run times after `now`, in `tz`. Wall-clock times a DST change skips don't run;
 *  a time that occurs twice runs once (its first occurrence). */
export function nextRuns(c: Cron, tz: string, now: number, n = 10): { runs: Run[]; skipped: number } {
  const runs: Run[] = [];
  let skipped = 0;
  if (c.reboot) return { runs, skipped };
  const p = tzParts(now, tz);
  const { sec, min, hour, mon, year } = c.f;
  let y = p.y, m = p.m, d = p.d;
  for (let day = 0; day < 366 * 100 && runs.length < n; day++) {
    if (day) {
      d++;
      if (d > daysIn(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } }
    }
    if (y > 2199) break;
    if (!mon.vals.includes(m) || !year.vals.includes(y) || !dayMatch(c, y, m, d)) continue;
    const today = day === 0;
    for (const h of hour.vals) {
      if (today && h < p.h) continue;
      for (const mi of min.vals) {
        if (today && h === p.h && mi < p.mi) continue;
        for (const s of sec.vals) {
          const w = resolveWall(y, m, d, h, mi, s, 0, tz);
          if (w.gap) { skipped++; continue; }
          if (w.ms <= now) continue;
          runs.push({ ms: w.ms, repeated: w.alt !== undefined });
          if (runs.length >= n) return { runs, skipped };
        }
      }
    }
  }
  return { runs, skipped };
}

// —— Description ——

type L = 'zh' | 'en';
const W = {
  zh: { days: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'], and: '、', to: '至' },
  en: { days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], and: ', ', to: ' to ' },
};
const p2 = (n: number) => String(n).padStart(2, '0');

/** Plain-language reading of a list: runs of consecutive values become ranges. */
function runsOf(v: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const x of v) {
    const last = out[out.length - 1];
    if (last && x === last[1] + 1) last[1] = x;
    else out.push([x, x]);
  }
  return out;
}
const stepOf = (f: Field): number | null => {
  const m = /^(\*|0)\/(\d+)$/.exec(f.raw);
  return m ? +m[2] : null;
};

export function describe(c: Cron, l: L): string {
  if (c.reboot) return l === 'zh' ? '系统启动时运行一次' : 'Once, when the system starts';
  const w = W[l], { sec, min, hour, dom, dow, mon, year } = c.f;
  const list = (v: number[], fmt: (n: number) => string) =>
    runsOf(v).map(([a, b]) => (a === b ? fmt(a) : b === a + 1 ? fmt(a) + w.and + fmt(b) : fmt(a) + w.to + fmt(b))).join(w.and);

  // Time of day.
  let time: string;
  const secs = sec.vals.length === 60 ? 'every' : sec.vals.length === 1 ? sec.vals[0] : 'list';
  const minStep = stepOf(min), hourStep = stepOf(hour);
  const fixedSec = typeof secs === 'number' ? secs : 0;
  const clock = (h: number, m: number) => p2(h) + ':' + p2(m) + (fixedSec ? ':' + p2(fixedSec) : '');
  if (secs === 'every' && min.vals.length === 60 && hour.vals.length === 24) time = l === 'zh' ? '每秒' : 'every second';
  else if (typeof secs !== 'number') {
    const ss = stepOf(sec);
    time = ss ? (l === 'zh' ? `每 ${ss} 秒` : `every ${ss} seconds`) : (l === 'zh' ? `在第 ${list(sec.vals, String)} 秒` : `at second ${list(sec.vals, String)}`);
    if (min.vals.length < 60) time += l === 'zh' ? `，分钟：${list(min.vals, String)}` : `, minutes ${list(min.vals, String)}`;
    if (hour.vals.length < 24) time += l === 'zh' ? `，${list(hour.vals, (h) => h + ' 点')}` : `, hours ${list(hour.vals, String)}`;
  } else if (min.vals.length === 60 && hour.vals.length === 24) time = l === 'zh' ? '每分钟' : 'every minute';
  else if (min.vals.length === 60) time = l === 'zh' ? `${list(hour.vals, (h) => h + ' 点')}的每分钟` : `every minute during hour ${list(hour.vals, String)}`;
  else if (minStep && hour.vals.length === 24) time = l === 'zh' ? `每 ${minStep} 分钟` : `every ${minStep} minutes`;
  else if (minStep) time = l === 'zh' ? `${list(hour.vals, (h) => h + ' 点')}之间每 ${minStep} 分钟` : `every ${minStep} minutes during hour ${list(hour.vals, String)}`;
  else if (hour.vals.length === 24) time = l === 'zh' ? `每小时的第 ${list(min.vals, String)} 分` : `every hour at minute ${list(min.vals, String)}`;
  else if (hourStep && min.vals.length === 1) time = l === 'zh' ? `每 ${hourStep} 小时（${p2(hour.vals[0])}:${p2(min.vals[0])} 起）` : `every ${hourStep} hours from ${p2(hour.vals[0])}:${p2(min.vals[0])}`;
  else if (hour.vals.length * min.vals.length <= 8) time = hour.vals.flatMap((h) => min.vals.map((m) => clock(h, m))).join(w.and);
  else time = l === 'zh' ? `${list(hour.vals, (h) => h + ' 点')}，第 ${list(min.vals, String)} 分` : `hours ${list(hour.vals, String)}, minutes ${list(min.vals, String)}`;

  // Days.
  const dowText = () => {
    const parts: string[] = [];
    if (dow.vals.length) {
      const v = dow.vals;
      parts.push(v.join() === '1,2,3,4,5' ? (l === 'zh' ? '每个工作日（周一至周五）' : 'every weekday (Monday to Friday)')
        : v.join() === '0,6' ? (l === 'zh' ? '每个周末' : 'every weekend day')
          : (l === 'zh' ? '每' : 'every ') + list(v, (x) => w.days[x]));
    }
    for (const x of dow.last ?? []) parts.push(l === 'zh' ? `每月最后一个${w.days[x]}` : `the last ${w.days[x]} of the month`);
    for (const [x, k] of dow.nth ?? []) parts.push(l === 'zh' ? `每月第 ${k} 个${w.days[x]}` : `the ${['', '1st', '2nd', '3rd', '4th', '5th'][k]} ${w.days[x]} of the month`);
    return parts.join(w.and);
  };
  const domText = () => {
    const parts: string[] = [];
    if (dom.vals.length) parts.push(l === 'zh' ? `每月 ${list(dom.vals, (x) => x + ' 日')}` : `day ${list(dom.vals, String)} of the month`);
    for (const off of dom.last ?? []) parts.push(l === 'zh' ? (off ? `每月倒数第 ${off + 1} 天` : '每月最后一天') : off ? `${off} days before the last day of the month` : 'the last day of the month');
    if (dom.lastW) parts.push(l === 'zh' ? '每月最后一个工作日' : 'the last weekday of the month');
    for (const n of dom.nearestW ?? []) parts.push(l === 'zh' ? `每月离 ${n} 日最近的工作日` : `the weekday nearest day ${n} of the month`);
    return parts.join(w.and);
  };
  const domFree = c.dialect === 'unix' ? dom.star && dom.vals.length >= 28 : dom.any;
  const dowFree = c.dialect === 'unix' ? dow.star && dow.vals.length >= 7 : dow.any;
  let days: string;
  if (domFree && dowFree) days = l === 'zh' ? '每天' : 'every day';
  else if (domFree) days = dowText();
  else if (dowFree) days = domText();
  else if (c.dialect === 'unix') days = l === 'zh' ? `${domText()}，以及${dowText()}` : `${domText()}, and ${dowText()}`;
  else days = l === 'zh' ? `${domText()}，且是${dowText().replace(/^每/, '')}时` : `${domText()}, when it is ${dowText().replace(/^every /, '')}`;

  const months = mon.vals.length === 12 ? '' : l === 'zh' ? list(mon.vals, (x) => x + ' 月') : list(mon.vals, (x) => MONTHS[x - 1][0] + MONTHS[x - 1].slice(1).toLowerCase());
  const years = year.vals.length >= 130 ? '' : l === 'zh' ? list(year.vals, (x) => x + ' 年') : list(year.vals, String);
  if (l === 'zh') return [years, months, days, time].filter(Boolean).join(' ');
  return [time, days, months && 'in ' + months, years && 'in ' + years].filter(Boolean).join(', ');
}

export const looksCron = (s: string) => {
  const t = s.trim();
  if (/^@(yearly|annually|monthly|weekly|daily|midnight|hourly|reboot)$/i.test(t)) return true;
  const parts = t.split(/\s+/);
  if (parts.length < 5 || parts.length > 7 || !parts.every((p) => /^[\d*?/,\-LW#A-Za-z]+$/.test(p))) return false;
  if (!parts.some((p) => /[*?/]/.test(p))) return false;
  try { parseCron(t, guessDialect(t)); return true; } catch { return false; }
};
