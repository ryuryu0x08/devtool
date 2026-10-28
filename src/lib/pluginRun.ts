// Runs the local dashboards while the page is open: each refresh calls the plugin's URL once per
// key, keeps the latest reading for each key, and appends the numbers to a 7-day history stored in
// this browser (IndexedDB).
import { get, set } from 'idb-keyval';
import { numPaths, read, type Plugin, type Reading } from './plugins';

export interface Sample { t: number; k: string; v: Record<string, number | null> }
export const KEEP_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 20000;

let plugins: Plugin[] = [];
const latest = new Map<string, Reading>();
const busy = new Set<string>();
const last = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

export const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const readingOf = (pluginId: string, keyId: string) => latest.get(pluginId + '/' + keyId);
export const refreshing = (pluginId: string) => busy.has(pluginId);
export const lastRefresh = (pluginId: string) => last.get(pluginId);
const histKey = (pluginId: string) => 'hist:' + pluginId;

/** A reply that isn't JSON, or no reply: why, in words the page can show. `connect` is a fetch
 *  that never got an answer (forwarder not running, CORS, the browser's local-network prompt). */
async function one(p: Plugin, key: string): Promise<Reading> {
  const now = Date.now();
  let res: Response;
  try {
    res = await fetch(p.def.url, { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return { at: now, ok: false, error: (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'connect', values: {} };
  }
  const text = await res.text().catch(() => '');
  let body: unknown;
  try { body = JSON.parse(text); } catch {
    return { at: now, ok: false, error: `HTTP ${res.status}: ` + (text.trim().slice(0, 120) || '(empty)'), values: {} };
  }
  const proxy = (body as { proxy_error?: unknown } | null)?.proxy_error;
  if (typeof proxy === 'string') return { at: now, ok: false, error: proxy, values: {} };
  return read(p.def, res.status, body, now);
}

export async function refresh(plugin: Plugin) {
  // A key row still being filled in is skipped.
  const p = { ...plugin, keys: plugin.keys.filter((k) => k.key) };
  if (busy.has(p.id) || !p.keys.length) return;
  busy.add(p.id);
  notify();
  try {
    const t = Date.now();
    const rs = await Promise.all(p.keys.map((k) => one(p, k.key)));
    const samples: Sample[] = [];
    // One time per refresh, so the keys' points line up on the chart.
    p.keys.forEach((k, i) => {
      latest.set(p.id + '/' + k.id, rs[i]);
      if (rs[i].ok) samples.push({ t, k: k.id, v: rs[i].values });
    });
    last.set(p.id, Date.now());
    if (samples.length) {
      const paths = new Set(numPaths(p.def));
      const old = ((await get<Sample[]>(histKey(p.id)).catch(() => undefined)) ?? []).filter((s) => s.t > Date.now() - KEEP_MS);
      // Only the numbers the plugin reads now are kept.
      for (const s of samples) for (const k of Object.keys(s.v)) if (!paths.has(k)) delete s.v[k];
      await set(histKey(p.id), [...old, ...samples]).catch(() => {});
    }
  } finally {
    busy.delete(p.id);
    notify();
  }
}

export const history = async (pluginId: string) => ((await get<Sample[]>(histKey(pluginId)).catch(() => undefined)) ?? []).filter((s) => s.t > Date.now() - KEEP_MS);
export const forget = (pluginId: string) => set(histKey(pluginId), []).catch(() => {});

/** Starts (or restarts) the timers for these plugins; each is refreshed now, then every interval. */
export function sync(ps: Plugin[]) {
  plugins = ps;
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
  for (const p of plugins) {
    void refresh(p);
    timers.set(p.id, setInterval(() => void refresh(p), p.def.interval * 1000));
  }
  notify();
}
