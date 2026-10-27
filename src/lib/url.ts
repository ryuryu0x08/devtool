// URL percent-encoding and parsing. Decoding is strict: a stray "%" is reported with its position,
// and bytes that are not UTF-8 are decoded as GB18030 only when that works, and then labelled.
import { wellFormed } from './data';

export type UrlMode = 'component' | 'uri' | 'form';

/** null when the text has lone surrogates (no UTF-8 form). */
export function urlEncode(s: string, mode: UrlMode): string | null {
  if (!wellFormed(s)) return null;
  if (mode === 'uri') return encodeURI(s);
  // application/x-www-form-urlencoded, exactly as URLSearchParams writes it (space → "+").
  if (mode === 'form') return new URLSearchParams([['', s]]).toString().slice(1);
  return encodeURIComponent(s);
}

export class UrlError extends Error {
  constructor(readonly code: 'pct' | 'utf8', readonly pos: number) {
    super(code + ' at ' + pos);
  }
}

/** Decode every %XX; in form mode "+" is a space. */
export function urlDecode(s: string, form: boolean): { text: string; enc?: 'GB18030'; plus: number } {
  const bytes: number[] = [];
  const enc = new TextEncoder();
  let plus = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '%') {
      const h = s.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(h)) throw new UrlError('pct', i);
      bytes.push(parseInt(h, 16));
      i += 2;
    } else if (c === '+') {
      plus++;
      bytes.push(form ? 32 : 43);
    } else {
      const cp = s.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      bytes.push(...enc.encode(ch));
      i += ch.length - 1;
    }
  }
  const b = Uint8Array.from(bytes);
  try { return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b), plus }; } catch { /* not UTF-8 */ }
  try { return { text: new TextDecoder('gb18030', { fatal: true }).decode(b), enc: 'GB18030', plus }; } catch { /* neither */ }
  const first = firstBadUtf8(s);
  throw new UrlError('utf8', first);
}

/** Position of the first %XX run that is not valid UTF-8 (for the error mark). */
function firstBadUtf8(s: string): number {
  const re = /(?:%[0-9a-fA-F]{2})+/g;
  for (const m of s.matchAll(re)) {
    const b = Uint8Array.from(m[0].slice(1).split('%'), (h) => parseInt(h, 16));
    try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return m.index!; }
  }
  return 0;
}

/** Text that is meant to be decoded: it has %XX sequences and decodes cleanly. */
export function looksPercent(s: string): boolean {
  const t = s.trim();
  if (!/%[0-9a-fA-F]{2}/.test(t)) return false;
  try { urlDecode(t, false); return true; } catch { return false; }
}

export interface ParsedUrl {
  url: URL;
  /** No scheme was written: read as https://. */
  assumed: boolean;
  /** What the browser's URL parser made of it, when that differs from the input. */
  normalized: string | null;
  params: [string, string][];
}

/** Parse with the WHATWG URL parser (what browsers use). Null when it isn't a URL. */
export function parseUrl(input: string): ParsedUrl | null {
  const s = input.trim();
  if (!s) return null;
  let url: URL | null = null, assumed = false;
  try { url = new URL(s); } catch { /* maybe no scheme */ }
  if (!url || (!/^[a-z][a-z0-9+.-]*:/i.test(s))) {
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(s)) {
      try { url = new URL('https://' + s); assumed = true; } catch { url = null; }
    } else url = null;
  }
  if (!url) return null;
  const shown = assumed ? 'https://' + s : s;
  return { url, assumed, normalized: url.href !== shown ? url.href : null, params: [...url.searchParams] };
}

export function looksUrl(s: string): boolean {
  const t = s.trim();
  return !/\s/.test(t) && /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(t) && parseUrl(t) !== null;
}

/** The URL with its query replaced by these parameters (written as URLSearchParams writes them). */
export function withParams(url: URL, params: [string, string][]): string {
  const u = new URL(url.href);
  u.search = new URLSearchParams(params).toString();
  return u.href;
}
