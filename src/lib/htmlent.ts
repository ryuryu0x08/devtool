// HTML entities with the full HTML5 table (the `entities` package).
import { decodeHTMLStrict, encodeHTML, encodeNonAsciiHTML } from 'entities';

export type HtmlEnc = 'min' | 'nonascii' | 'named';

/** min: only & < > " ' (enough for text and attribute values); nonascii: also every non-ASCII
 *  character; named: every character that has a name. */
export function encodeHtml(s: string, mode: HtmlEnc): string {
  if (mode === 'named') return encodeHTML(s);
  const min = s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return mode === 'nonascii' ? encodeNonAsciiHTML(min).replace(/&amp;(amp|lt|gt|quot|#39);/g, '&$1;') : min;
}

/**
 * Decode entities that end with ";" (strict). Browsers also decode some legacy names without
 * the ";" (like "&amp" or "&copy") in page text: those are left as written and counted.
 */
export function decodeHtml(s: string): { text: string; legacy: number; n: number } {
  const text = decodeHTMLStrict(s);
  const n = (s.match(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g) || []).filter((e) => decodeHTMLStrict(e) !== e).length;
  const legacy = (text.match(/&(amp|lt|gt|quot|copy|reg|nbsp|AMP|LT|GT|QUOT|COPY|REG)(?![A-Za-z0-9;])/g) || []).length;
  return { text, legacy, n };
}

/** Has entities and no tags: text to decode. */
export const looksHtmlEscaped = (s: string) =>
  !/<[a-zA-Z/!]/.test(s) && /&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.test(s) && decodeHtml(s).n > 0;
