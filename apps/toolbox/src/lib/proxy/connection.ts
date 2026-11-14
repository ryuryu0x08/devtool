// Where the proxy tool finds its backend (address and token), kept in this browser. Small and
// without the tool's code: the app reads it at start (a link from `bmitmproxy serve` opens the
// tool) and when text is pasted on the tool's page.

export const DEFAULT_API = 'http://127.0.0.1:8081';
const STORE = 'tb.proxy';
const HASH = '#proxy';

export interface Connection { api: string; token: string }

export function savedConnection(): Connection {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<Connection> | null;
    return { api: typeof v?.api === 'string' && v.api ? v.api : DEFAULT_API, token: typeof v?.token === 'string' ? v.token : '' };
  } catch {
    return { api: DEFAULT_API, token: '' };
  }
}

const subs = new Set<(c: Connection) => void>();

export function saveConnection(c: Connection) {
  try { localStorage.setItem(STORE, JSON.stringify(c)); } catch { /* storage off: kept for this page only */ }
  for (const fn of subs) fn(c);
}

/** Called with each connection given from outside the tool (a link, a paste). Returns the unsubscribe. */
export function onConnection(fn: (c: Connection) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** The backend's token: what `bmitmctl token` prints (URL-safe Base64, 43 characters). */
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

function fromQuery(q: string): Partial<Connection> | null {
  const p = new URLSearchParams(q);
  const api = p.get('api') ?? undefined;
  const token = p.get('token') ?? undefined;
  if (token !== undefined && !TOKEN.test(token)) return null;
  if (api !== undefined && !/^https?:\/\/[^/?#\s]+$/.test(api.replace(/\/+$/, ''))) return null;
  return api || token ? { ...(api ? { api: api.replace(/\/+$/, '') } : {}), ...(token ? { token } : {}) } : null;
}

/**
 * A connection in pasted text: the toolbox link `bmitmproxy serve` prints
 * (…/#proxy?api=…&token=…), or the token alone. Null for anything else.
 */
export function parseConnection(text: string): Partial<Connection> | null {
  const t = text.trim();
  if (TOKEN.test(t)) return { token: t };
  const i = t.indexOf(HASH + '?');
  if (i >= 0 && !/\s/.test(t)) return fromQuery(t.slice(i + HASH.length + 1));
  return null;
}

/** Pasted text that is a connection: saved and handed to the tool. */
export function offerConnection(text: string): boolean {
  const c = parseConnection(text);
  if (!c) return false;
  saveConnection({ ...savedConnection(), ...c });
  return true;
}

/** The page was opened at #proxy (the link from `bmitmproxy serve`). */
export const openedForProxy = () => location.hash === HASH || location.hash.startsWith(HASH + '?');

/**
 * A connection in the page's address: saved, and taken out of the address (so the token doesn't
 * stay in the history or get bookmarked). True when the address was for the proxy tool.
 */
export function takeAddressConnection(): boolean {
  if (!openedForProxy()) return false;
  const c = fromQuery(location.hash.slice(HASH.length + 1));
  if (c) saveConnection({ ...savedConnection(), ...c });
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}
