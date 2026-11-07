// Unicode escapes: text ⇄ \uXXXX (JS / JSON / Java), \u{…} (ES2015), &#x…; (HTML), U+XXXX.

export type UniFmt = 'u4' | 'ubrace' | 'html' | 'cp';

const hex = (n: number, w = 4) => n.toString(16).toUpperCase().padStart(w, '0');

/** Escape; with `all` false, printable ASCII stays as it is. */
export function escapeUnicode(s: string, fmt: UniFmt, all: boolean): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (!all && cp >= 0x20 && cp < 0x7f) { out += ch; continue; }
    if (fmt === 'cp') out += (out && !out.endsWith(' ') ? ' ' : '') + 'U+' + hex(cp) + ' ';
    else if (fmt === 'html') out += '&#x' + hex(cp, 1) + ';';
    else if (fmt === 'ubrace') out += '\\u{' + hex(cp, 1) + '}';
    else if (cp > 0xffff) out += '\\u' + hex(0xd800 + ((cp - 0x10000) >> 10)) + '\\u' + hex(0xdc00 + ((cp - 0x10000) & 0x3ff));
    else out += '\\u' + hex(cp);
  }
  return fmt === 'cp' ? out.trimEnd() : out;
}

export class UniError extends Error {
  constructor(readonly pos: number) { super('bad escape at ' + pos); }
}

/**
 * Turn \uXXXX, \u{…}, \UXXXXXXXX, &#x…; / &#…; back into characters; a text that is only
 * U+XXXX tokens is read as a list of code points. Everything else is left as it is.
 */
export function unescapeUnicode(s: string): { text: string; n: number } {
  let n = 0;
  if (/^\s*(U\+[0-9a-fA-F]{1,6}[\s,]*)+$/.test(s)) {
    const text = s.trim().split(/[\s,]+/).filter(Boolean).map((t) => {
      const cp = parseInt(t.slice(2), 16);
      if (cp > 0x10ffff) throw new UniError(s.indexOf(t));
      n++;
      return String.fromCodePoint(cp);
    }).join('');
    return { text, n };
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && (s[i + 1] === 'u' || s[i + 1] === 'U')) {
      let m: RegExpExecArray | null;
      const rest = s.slice(i);
      if (s[i + 1] === 'u' && (m = /^\\u\{([0-9a-fA-F]{1,6})\}/.exec(rest))) {
        const cp = parseInt(m[1], 16);
        if (cp > 0x10ffff) throw new UniError(i);
        out += String.fromCodePoint(cp);
      } else if (s[i + 1] === 'u' && (m = /^\\u([0-9a-fA-F]{4})/.exec(rest))) out += String.fromCharCode(parseInt(m[1], 16));
      else if (s[i + 1] === 'U' && (m = /^\\U([0-9a-fA-F]{8})/.exec(rest))) {
        const cp = parseInt(m[1], 16);
        if (cp > 0x10ffff) throw new UniError(i);
        out += String.fromCodePoint(cp);
      } else throw new UniError(i);
      n++;
      i += m[0].length - 1;
    } else if (c === '\\' && s[i + 1] === '\\') { out += '\\\\'; i++; }
    else if (c === '&' && s[i + 1] === '#') {
      const m = /^&#(?:[xX]([0-9a-fA-F]{1,6})|(\d{1,7}));/.exec(s.slice(i));
      const cp = m ? (m[1] ? parseInt(m[1], 16) : parseInt(m[2], 10)) : -1;
      if (!m || cp > 0x10ffff) { out += c; continue; }
      out += String.fromCodePoint(cp);
      n++;
      i += m[0].length - 1;
    } else out += c;
  }
  return { text: out, n };
}

/** Has escapes worth decoding. */
export const looksUniEscaped = (s: string) => /\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}|\\U[0-9a-fA-F]{8}/.test(s) || /^\s*(U\+[0-9a-fA-F]{4,6}[\s,]*)+$/.test(s);

/** Code point, UTF-8 and UTF-16 of each character (first `max`). */
export function charTable(s: string, max = 300): { ch: string; cp: string; utf8: string; utf16: string }[] {
  const rows = [];
  const enc = new TextEncoder();
  for (const ch of s) {
    if (rows.length >= max) break;
    const cp = ch.codePointAt(0)!;
    const lone = cp >= 0xd800 && cp <= 0xdfff;
    rows.push({
      ch, cp: 'U+' + hex(cp),
      utf8: lone ? '—' : Array.from(enc.encode(ch), (b) => hex(b, 2)).join(' '),
      utf16: Array.from({ length: ch.length }, (_, i) => hex(ch.charCodeAt(i))).join(' '),
    });
  }
  return rows;
}
