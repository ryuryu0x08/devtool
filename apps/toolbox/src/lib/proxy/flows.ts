// The capture list: applying a backend's events, the filter box, and what a row shows.
import type { Flow, FlowEvent, Message } from './backend';

/** Flows in the order they were first seen; `index` maps an id to its place in `list`. */
export interface FlowList {
  list: Flow[];
  index: Map<string, number>;
}

export const EMPTY: FlowList = { list: [], index: new Map() };

function indexOf(list: Flow[]) {
  return new Map(list.map((f, i) => [f.id, i]));
}

/** A batch of events (one animation frame's worth) on top of `s`; `s` isn't changed. */
export function applyEvents(s: FlowList, events: FlowEvent[]): FlowList {
  if (!events.length) return s;
  let list = s.list;
  let index = s.index;
  let copied = false;
  const own = () => {
    if (!copied) { list = list.slice(); index = new Map(index); copied = true; }
  };
  for (const e of events) {
    if (e.type === 'reset') {
      list = e.flows.slice();
      index = indexOf(list);
      copied = true;
    } else if (e.type === 'upsert') {
      own();
      const i = index.get(e.flow.id);
      if (i === undefined) { index.set(e.flow.id, list.length); list.push(e.flow); } else list[i] = e.flow;
    } else if (index.has(e.id)) {
      own();
      list = list.filter((f) => f.id !== e.id);
      index = indexOf(list);
    }
  }
  return copied ? { list, index } : s;
}

export function header(m: Message | null | undefined, name: string): string | null {
  const n = name.toLowerCase();
  return m?.headers.find(([k]) => k.toLowerCase() === n)?.[1] ?? null;
}

/** "application/json" from "application/json; charset=utf-8". */
export function contentType(f: Flow): string {
  return (header(f.response, 'content-type') ?? '').split(';')[0].trim().toLowerCase();
}

/** From the request going out to the response's end (or its start, or the error). */
export function duration(f: Flow): number | null {
  const start = f.request?.start ?? null;
  const end = f.response?.end ?? f.response?.start ?? null;
  return start !== null && end !== null ? Math.max(0, end - start) : null;
}

export type FlowState = 'pending' | 'ok' | 'redirect' | 'client-error' | 'server-error' | 'error';

export function state(f: Flow): FlowState {
  if (f.error && !f.response) return 'error';
  const s = f.response?.status;
  if (s === undefined) return f.kind === 'http' ? 'pending' : 'ok';
  return s >= 500 ? 'server-error' : s >= 400 ? 'client-error' : s >= 300 ? 'redirect' : 'ok';
}

/** What the filter matches: method, address, status, content type and error. */
function haystack(f: Flow) {
  return [f.method, f.url, f.response?.status ?? '', contentType(f), f.error ?? ''].join(' ').toLowerCase();
}

/**
 * The filter box: words separated by spaces, all must appear (in any order); a word starting with
 * "-" must not. "api -png 404" = addresses with "api", no "png", status 404.
 */
export function compileFilter(query: string): (f: Flow) => boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const want = words.filter((w) => !w.startsWith('-') || w === '-');
  const not = words.filter((w) => w.startsWith('-') && w !== '-').map((w) => w.slice(1));
  if (!want.length && !not.length) return () => true;
  return (f) => {
    const h = haystack(f);
    return want.every((w) => h.includes(w)) && !not.some((w) => h.includes(w));
  };
}

const UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatSize(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  let v = n;
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) { v /= 1024; u++; }
  return u === 0 ? `${v} B` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${UNITS[u]}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** The request line and headers, as they'd be written on the wire (for copying). */
export function headText(f: Flow, part: 'request' | 'response'): string {
  const m = part === 'request' ? f.request : f.response;
  if (!m) return '';
  const first = part === 'request' || !f.response
    ? `${f.method} ${f.path} ${m.httpVersion}`
    : `${m.httpVersion} ${f.response.status} ${f.response.reason}`.trimEnd();
  return [first, ...m.headers.map(([k, v]) => `${k}: ${v}`)].join('\n');
}
