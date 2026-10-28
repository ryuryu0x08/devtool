// Local plugins: the user's own code, kept in this browser only. A plugin is a web page (HTML with
// its scripts and styles) that runs in an isolated frame: it can't read the toolbox or its data,
// and reaches the outside through the `toolbox` object the frame is given (network requests, its
// own storage, copy, toast). See PluginFrames for the frame side.
import { del, get, set } from 'idb-keyval';
import quotaTemplate from '../plugins/quota.html?raw';
import blankTemplate from '../plugins/blank.html?raw';

export interface Plugin { id: string; html: string }

export const TEMPLATES = { quota: quotaTemplate, blank: blankTemplate };

const STORE = 'tb.plugins';
let cache: Plugin[] | null = null;
/** Settled once data carried over from the first version is written (plugins start after it). */
let carried: Promise<unknown> = Promise.resolve();
export const ready = () => { plugins(); return carried; };
let editing = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
export const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** The plugin's name: its page's <title>. */
export const nameOf = (html: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].trim() || 'Plugin';

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** A dashboard of the first version (a JSON description with its keys) becomes the quota template
 *  plugin with the same URL, interval and keys, so nothing that was entered is lost. */
function migrate(raw: unknown[]): Plugin[] {
  const writes: Promise<unknown>[] = [];
  const out = raw.flatMap((p): Plugin[] => {
    const o = p as { id?: string; html?: string; src?: string; keys?: { name: string; key: string }[] };
    if (typeof o.id !== 'string') return [];
    if (typeof o.html === 'string') return [{ id: o.id, html: o.html }];
    if (typeof o.src !== 'string') return [];
    let def: { url?: unknown; interval?: unknown } = {};
    try { def = JSON.parse(o.src); } catch { /* kept as the template's defaults */ }
    writes.push(set(dataKey(o.id, 'config'), {
      url: typeof def.url === 'string' ? def.url : undefined,
      interval: typeof def.interval === 'number' ? def.interval : undefined,
      keys: (o.keys ?? []).map((k) => ({ name: k.name, key: k.key })),
    }).catch(() => {}));
    return [{ id: o.id, html: quotaTemplate }];
  });
  carried = Promise.all(writes);
  return out;
}

export function plugins(): Plugin[] {
  if (cache) return cache;
  let raw: unknown[] = [];
  try { raw = JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { /* storage off or damaged */ }
  cache = migrate(Array.isArray(raw) ? raw : []);
  if (Array.isArray(raw) && raw.some((p) => typeof (p as { src?: unknown }).src === 'string')) save(cache);
  return cache;
}

function save(ps: Plugin[]) {
  try { localStorage.setItem(STORE, JSON.stringify(ps)); } catch { /* storage off: kept for this page only */ }
}

export function setPlugins(ps: Plugin[]) {
  cache = ps;
  save(ps);
  notify();
}

export function removePlugin(id: string) {
  setPlugins(plugins().filter((p) => p.id !== id));
  void clearData(id);
}

/** The definition is being edited (the frames step aside). */
export const isEditing = () => editing;
export const setEditing = (v: boolean) => { if (editing !== v) { editing = v; notify(); } };

// A plugin's own storage (its frame has none: it runs in an origin of its own). IndexedDB, in this browser.
const dataKey = (id: string, k: string) => 'plg:' + id + ':' + k;
const indexKey = (id: string) => 'plg:' + id;
export const getData = (id: string, k: string) => get(dataKey(id, k));
export async function setData(id: string, k: string, v: unknown) {
  await set(dataKey(id, k), v);
  const keys = new Set<string>((await get(indexKey(id))) ?? []);
  if (!keys.has(k)) { keys.add(k); await set(indexKey(id), [...keys]); }
}
export const delData = (id: string, k: string) => del(dataKey(id, k));
export async function clearData(id: string) {
  const keys: string[] = (await get(indexKey(id)).catch(() => undefined)) ?? [];
  await Promise.all([...keys, 'config'].map((k) => del(dataKey(id, k)).catch(() => {})));
  await del(indexKey(id)).catch(() => {});
}
