// Local plugins: defined by the user, kept in this browser only. A plugin is a JSON description,
// not code: a dashboard says which URL to call with each of its keys, how often, and which fields
// of the JSON reply to show as values, bars (used / limit) and trends over time.

export interface Check { path: string; equals: unknown }
export interface ValueDef { label: string; path: string }
export interface BarDef { label: string; used: string; limit: string }
export interface DashDef {
  type: 'dashboard';
  name: string;
  url: string;
  /** Seconds between refreshes (at least 10). */
  interval: number;
  /** The reply counts as a success only if each check holds. */
  ok: Check[];
  /** Where the reply says what went wrong (shown when a check fails). */
  error?: string;
  /** The card's title (e.g. the account's name). */
  title?: string;
  values: ValueDef[];
  bars: BarDef[];
  trends: ValueDef[];
}
export interface PluginKey { id: string; name: string; key: string }
export interface Plugin { id: string; src: string; def: DashDef; keys: PluginKey[] }

export const MIN_INTERVAL = 10;

/** `a.b.0.c` in a JSON value; undefined when absent. */
export function at(v: unknown, path: string): unknown {
  let cur = v;
  for (const p of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Every path a dashboard reads as a number (stored for each refresh). */
export const numPaths = (d: DashDef) => [...new Set([...d.values.map((x) => x.path), ...d.bars.flatMap((b) => [b.used, b.limit]), ...d.trends.map((t) => t.path)])];

export type DefResult = { def: DashDef } | { errors: string[] };

/** Reads a plugin's JSON; every problem is listed with where it is. */
export function parseDef(src: string): DefResult {
  let j: unknown;
  try { j = JSON.parse(src); } catch (e) { return { errors: ['JSON: ' + (e as Error).message] }; }
  const errors: string[] = [];
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { errors: ['the plugin must be a JSON object'] };
  const o = j as Record<string, unknown>;
  const str = (k: string, where: Record<string, unknown>, label: string, need = true) => {
    const v = where[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (need || v !== undefined) errors.push(label + ': expected a non-empty string');
    return '';
  };
  if (o.type !== 'dashboard') errors.push('type: expected "dashboard"');
  const name = str('name', o, 'name');
  const url = str('url', o, 'url');
  if (url && !/^https?:\/\//i.test(url)) errors.push('url: expected http:// or https://');
  const interval = o.interval === undefined ? 60 : o.interval;
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < MIN_INTERVAL) errors.push(`interval: expected a number of seconds, at least ${MIN_INTERVAL}`);
  const list = <T>(k: string, read: (x: Record<string, unknown>, label: string) => T): T[] => {
    const v = o[k];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { errors.push(k + ': expected a list'); return []; }
    const out: T[] = [];
    v.forEach((x, i) => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) errors.push(`${k}[${i}]: expected an object`);
      else out.push(read(x as Record<string, unknown>, `${k}[${i}]`));
    });
    return out;
  };
  const okRaw = o.ok === undefined ? [] : Array.isArray(o.ok) ? o.ok : [o.ok];
  const ok: Check[] = [];
  okRaw.forEach((c, i) => {
    if (!c || typeof c !== 'object' || !('equals' in c)) { errors.push(`ok[${i}]: expected { "path": …, "equals": … }`); return; }
    const p = str('path', c as Record<string, unknown>, `ok[${i}].path`);
    ok.push({ path: p, equals: (c as Check).equals });
  });
  const error = o.error === undefined ? undefined : str('error', o, 'error');
  const title = o.title === undefined ? undefined : str('title', o, 'title');
  const value = (x: Record<string, unknown>, l: string): ValueDef => ({ label: str('label', x, l + '.label'), path: str('path', x, l + '.path') });
  const values = list('values', value);
  const bars = list('bars', (x, l): BarDef => ({ label: str('label', x, l + '.label'), used: str('used', x, l + '.used'), limit: str('limit', x, l + '.limit') }));
  const trends = list('trends', value);
  if (!values.length && !bars.length && !trends.length) errors.push('values / bars / trends: show at least one');
  if (errors.length) return { errors };
  return { def: { type: 'dashboard', name, url, interval: interval as number, ok, error, title, values, bars, trends } };
}

/** What one refresh of one key gave. */
export interface Reading { at: number; ok: boolean; error?: string; title?: string; values: Record<string, number | null> }

/** Turns a reply (already JSON-parsed, with its HTTP status) into a reading. */
export function read(def: DashDef, status: number, body: unknown, now: number): Reading {
  const values: Record<string, number | null> = {};
  for (const p of numPaths(def)) values[p] = num(at(body, p));
  const said = def.error ? at(body, def.error) : undefined;
  const msg = typeof said === 'string' && said ? said : undefined;
  const title = def.title ? at(body, def.title) : undefined;
  const base = { at: now, values, ...(typeof title === 'string' && title ? { title } : {}) };
  if (status < 200 || status >= 300) return { ...base, ok: false, error: `HTTP ${status}` + (msg ? ': ' + msg : '') };
  const failed = def.ok.find((c) => at(body, c.path) !== c.equals);
  if (failed) return { ...base, ok: false, error: msg ?? `${failed.path} = ${JSON.stringify(at(body, failed.path))}` };
  return { ...base, ok: true };
}

export const TEMPLATE = `{
  "type": "dashboard",
  "name": "额度看板",
  "url": "http://127.0.0.1:8787/api/v1/billing/usage",
  "interval": 60,
  "ok": [{ "path": "code", "equals": 0 }, { "path": "data.valid", "equals": true }],
  "error": "message",
  "title": "data.nick_name",
  "values": [
    { "label": "余额", "path": "data.balance" }
  ],
  "bars": [
    { "label": "今日", "used": "data.daily_usage", "limit": "data.daily_limit" },
    { "label": "超额", "used": "data.overflow_usage", "limit": "data.overflow_limit" },
    { "label": "额度池", "used": "data.pool_usage", "limit": "data.pool_limit" },
    { "label": "本周", "used": "data.user_weekly_usage", "limit": "data.user_weekly_limit" },
    { "label": "本月", "used": "data.user_monthly_usage", "limit": "data.user_monthly_limit" }
  ],
  "trends": [
    { "label": "今日用量", "path": "data.daily_usage" },
    { "label": "余额", "path": "data.balance" }
  ]
}
`;

const STORE = 'tb.plugins';

export function loadPlugins(): Plugin[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '[]') as { id: string; src: string; keys: PluginKey[] }[];
    return raw.flatMap((p) => {
      const r = parseDef(p.src);
      return 'def' in r ? [{ id: p.id, src: p.src, def: r.def, keys: Array.isArray(p.keys) ? p.keys : [] }] : [];
    });
  } catch { return []; }
}

export function savePlugins(ps: Plugin[]) {
  try { localStorage.setItem(STORE, JSON.stringify(ps.map((p) => ({ id: p.id, src: p.src, keys: p.keys })))); } catch { /* storage off: kept for this page only */ }
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
