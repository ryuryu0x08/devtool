// Local plugins: the user's own code, kept in this browser only, each a tool of its own in the
// sidebar. A plugin is a web page (HTML with its scripts and styles) that runs in an isolated frame:
// it can't read the toolbox or its data, and reaches the outside through the `toolbox` object the
// frame is given (network requests, its own storage, copy, toast). See PluginFrames.
import { del, get, set } from 'idb-keyval';
import blankTemplate from '../plugins/blank.html?raw';

export interface Plugin { id: string; html: string }

export const BLANK = blankTemplate;

const STORE = 'tb.plugins';
let cache: Plugin[] | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
export const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** The plugin's name (in the sidebar): its page's <title>. */
export const nameOf = (html: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].trim() || 'Plugin';

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function plugins(): Plugin[] {
  if (cache) return cache;
  let raw: unknown = [];
  try { raw = JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { /* storage off or damaged */ }
  cache = (Array.isArray(raw) ? raw : []).filter((p): p is Plugin => !!p && typeof p.id === 'string' && typeof p.html === 'string');
  return cache;
}

/** Ids of the stored plugins, read before anything else loads (for the tool to open on). */
export const storedIds = () => plugins().map((p) => p.id);

/** The sidebar icon: <meta name="toolbox-icon" content="…">, else the name's first characters. */
export function iconOf(html: string) {
  const m = /<meta\s+name=["']toolbox-icon["']\s+content=["']([^"']{1,4})["']/i.exec(html);
  if (m) return m[1];
  const n = nameOf(html);
  return /^[\x00-\x7f]/.test(n) ? n.slice(0, 2) : n.slice(0, 1);
}

/** Tool ids of plugins in the app's state: "p:<id>". */
export const PLUGIN_PREFIX = 'p:';
export const pluginOfTool = (tool: string) => (tool.startsWith(PLUGIN_PREFIX) ? tool.slice(PLUGIN_PREFIX.length) : null);

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
  // "config" too: plugins converted from the first version had it written without the index.
  await Promise.all([...new Set([...keys, 'config'])].map((k) => del(dataKey(id, k)).catch(() => {})));
  await del(indexKey(id)).catch(() => {});
}
