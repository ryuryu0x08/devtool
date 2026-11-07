// The cron editor's model: each field as "every", a list, a range or a step, read from an
// expression and written back. Anything else (L, W, #, mixed lists) is kept as written ("raw").
// Weekdays inside are 0 = Sunday … 6 = Saturday whatever the dialect.
import { MACROS, type Dialect } from './cron';

export type FKind = 'sec' | 'min' | 'hour' | 'dom' | 'mon' | 'dow';
export type Part =
  | { k: 'every' }
  | { k: 'list'; v: number[] }
  | { k: 'range'; a: number; b: number }
  // star: written with "*" before the slash (Unix cron then counts the day fields as unrestricted).
  | { k: 'step'; from: number; n: number; star: boolean }
  | { k: 'raw'; t: string };
export type Model = Record<FKind, Part> & { year?: string };
export type Preset = 'minute' | 'everyN' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export const LIMITS: Record<FKind, [number, number]> = { sec: [0, 59], min: [0, 59], hour: [0, 23], dom: [1, 31], mon: [1, 12], dow: [0, 6] };
export const EVERY: Part = { k: 'every' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** A number as written in this field, in the model's terms; null when out of range. */
function num(t: string, kind: FKind, d: Dialect): number | null {
  const u = t.toUpperCase();
  let n: number;
  if (kind === 'mon' && MONTHS.includes(u)) n = MONTHS.indexOf(u) + 1;
  else if (kind === 'dow' && DAYS.includes(u)) return DAYS.indexOf(u);
  else if (/^\d+$/.test(t)) n = +t;
  else return null;
  if (kind === 'dow') {
    if (d === 'quartz') return n >= 1 && n <= 7 ? n - 1 : null;
    return n >= 0 && n <= 7 ? n % 7 : null;
  }
  const [lo, hi] = LIMITS[kind];
  return n >= lo && n <= hi ? n : null;
}

export function readPart(tok: string, kind: FKind, d: Dialect): Part {
  if (tok === '*' || tok === '?') return EVERY;
  const raw: Part = { k: 'raw', t: tok };
  let m: RegExpExecArray | null;
  if ((m = /^(\*|\w+)\/(\d+)$/.exec(tok))) {
    const from = m[1] === '*' ? LIMITS[kind][0] : num(m[1], kind, d);
    return from === null || +m[2] < 1 ? raw : { k: 'step', from, n: +m[2], star: m[1] === '*' };
  }
  if ((m = /^(\w+)-(\w+)$/.exec(tok))) {
    const a = num(m[1], kind, d), b = num(m[2], kind, d);
    return a === null || b === null || a > b ? raw : { k: 'range', a, b };
  }
  if (/^\w+(,\w+)*$/.test(tok)) {
    const v = tok.split(',').map((x) => num(x, kind, d));
    return v.some((x) => x === null) ? raw : { k: 'list', v: [...new Set(v as number[])].sort((x, y) => x - y) };
  }
  return raw;
}

const dowOut = (v: number, d: Dialect) => String(d === 'quartz' ? v + 1 : v);

export function writePart(p: Part, kind: FKind, d: Dialect): string {
  const out = (v: number) => (kind === 'dow' ? dowOut(v, d) : String(v));
  switch (p.k) {
    case 'every': return '*';
    case 'raw': return p.t;
    case 'range': return out(p.a) + '-' + out(p.b);
    case 'step': return (p.star && p.from === LIMITS[kind][0] ? '*' : out(p.from)) + '/' + p.n;
    case 'list': {
      // Runs of three or more consecutive values are written as a range: 1-5, not 1,2,3,4,5.
      const v = [...p.v].sort((a, b) => a - b), parts: string[] = [];
      for (let i = 0; i < v.length;) {
        let j = i;
        while (j + 1 < v.length && v[j + 1] === v[j] + 1) j++;
        if (j - i >= 2) parts.push(out(v[i]) + '-' + out(v[j]));
        else for (let k = i; k <= j; k++) parts.push(out(v[k]));
        i = j + 1;
      }
      return parts.join(',');
    }
  }
}

const KINDS: Record<Dialect, FKind[]> = {
  unix: ['min', 'hour', 'dom', 'mon', 'dow'],
  spring: ['sec', 'min', 'hour', 'dom', 'mon', 'dow'],
  quartz: ['sec', 'min', 'hour', 'dom', 'mon', 'dow'],
};

/** The model of an expression, or null when it has the wrong number of fields. */
export function readExpr(expr: string, d: Dialect): Model | null {
  let s = expr.trim();
  if (s.startsWith('@')) {
    const m = MACROS[s.toLowerCase()];
    if (!m) return null;
    const f = m.split(' ');
    // Quartz: "?" in the unused day field, and weekdays count from 1 (Sunday).
    if (d === 'quartz') { if (f[4] === '*') f[4] = '?'; else { f[4] = String(+f[4] + 1); f[2] = '?'; } }
    s = (d === 'unix' ? '' : '0 ') + f.join(' ');
  }
  const t = s.split(/\s+/);
  const kinds = KINDS[d];
  if (!(t.length === kinds.length || (d === 'quartz' && t.length === 7))) return null;
  const m = { sec: { k: 'list', v: [0] } } as Model;
  kinds.forEach((k, i) => { m[k] = readPart(t[i], k, d); });
  if (t.length === 7 && t[6] !== '*') m.year = t[6];
  return m;
}

export function writeExpr(m: Model, d: Dialect): string {
  const f = KINDS[d].map((k) => writePart(m[k], k, d));
  if (d === 'quartz') {
    // Quartz needs "?" in exactly one of day of month (field 4) and day of week (field 6); the
    // editor never sets both.
    if (m.dow.k === 'every') f[5] = '?';
    else f[3] = '?';
    if (m.year) f.push(m.year);
  }
  return f.join(' ');
}

const one = (p: Part) => (p.k === 'list' && p.v.length === 1 ? p.v[0] : null);
const every = (...ps: Part[]) => ps.every((p) => p.k === 'every');

/** Which simple form the model is, or 'custom'. */
export function presetOf(m: Model): Preset {
  if (one(m.sec) !== 0 || m.year) return 'custom';
  const { min, hour, dom, mon, dow } = m;
  if (every(min, hour, dom, mon, dow)) return 'minute';
  if (min.k === 'step' && min.from === 0 && every(hour, dom, mon, dow)) return 'everyN';
  if (one(min) !== null && (hour.k === 'every' || (hour.k === 'step' && hour.from === 0)) && every(dom, mon, dow)) return 'hourly';
  if (one(min) === null || one(hour) === null) return 'custom';
  if (every(dom, mon, dow)) return 'daily';
  if (every(dom, mon) && (dow.k === 'list' || dow.k === 'range')) return 'weekly';
  if (every(mon, dow) && (dom.k === 'list' || (dom.k === 'raw' && dom.t.toUpperCase() === 'L'))) return 'monthly';
  if (every(dow) && one(dom) !== null && mon.k === 'list') return 'yearly';
  return 'custom';
}

/** The values a list or range part covers (for chips). */
export const values = (p: Part): number[] =>
  p.k === 'list' ? p.v : p.k === 'range' ? Array.from({ length: p.b - p.a + 1 }, (_, i) => p.a + i) : [];

/** The model switched to a preset, keeping what it can (the time of day, chosen days). */
export function toPreset(p: Preset, cur: Model | null): Model {
  const c = cur ?? readExpr('0 9 * * *', 'unix')!;
  const zero: Part = { k: 'list', v: [0] };
  const minute: Part = one(c.min) !== null ? c.min : zero;
  const hour: Part = one(c.hour) !== null ? c.hour : { k: 'list', v: [9] };
  const base = { sec: zero, min: minute, hour, dom: EVERY, mon: EVERY, dow: EVERY };
  const keep = (part: Part, def: number[]): Part => (values(part).length ? { k: 'list', v: values(part) } : { k: 'list', v: def });
  switch (p) {
    case 'minute': return { ...base, min: EVERY, hour: EVERY };
    case 'everyN': return { ...base, min: c.min.k === 'step' ? c.min : { k: 'step', from: 0, n: 5, star: true }, hour: EVERY };
    case 'hourly': return { ...base, hour: c.hour.k === 'step' ? c.hour : EVERY };
    case 'daily': return base;
    case 'weekly': return { ...base, dow: keep(c.dow, [1]) };
    case 'monthly': return { ...base, dom: c.dom.k === 'raw' && c.dom.t.toUpperCase() === 'L' ? c.dom : keep(c.dom, [1]) };
    case 'yearly': return { ...base, dom: one(c.dom) !== null ? c.dom : { k: 'list', v: [1] }, mon: keep(c.mon, [1]) };
    case 'custom': return c;
  }
}
