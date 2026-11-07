// Hex ⇄ bytes. Reading accepts the usual spellings (0x, \x, spaces, colons, dashes, commas).

export type HexSep = '' | ' ' | ':';
export type HexPrefix = '' | '0x' | '\\x';

const LOWER = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const UPPER = LOWER.map((h) => h.toUpperCase());

/** The prefix (0x, \x) keeps its lower-case x either way. */
export function bytesToHex(b: Uint8Array, sep: HexSep, upper: boolean, prefix: HexPrefix): string {
  const t = upper ? UPPER : LOWER;
  const parts = new Array<string>(b.length);
  for (let i = 0; i < b.length; i++) parts[i] = prefix + t[b[i]];
  return parts.join(sep);
}

export class HexError extends Error {
  constructor(readonly code: 'char' | 'odd', readonly pos: number, readonly ch = '') { super(code + ' at ' + pos); }
}

/** Parse hex text into bytes. A byte written as one digit between separators ("0x1") is an error,
 *  not a guess; so is an odd number of digits in one run. */
export function hexToBytes(s: string): Uint8Array | null {
  const out = new Uint8Array(s.length >> 1);
  let i = 0, n = 0, any = false;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (isSep(s, i)) { i++; continue; }
    if ((c === 48 && (s[i + 1] === 'x' || s[i + 1] === 'X') && isHex(s.charCodeAt(i + 2))) || (c === 92 && s[i + 1] === 'x')) { i += 2; continue; }
    let j = i;
    while (j < s.length && isHex(s.charCodeAt(j))) j++;
    if (j === i) throw new HexError('char', i, String.fromCodePoint(s.codePointAt(i)!));
    // A letter right after the digits is the mistake to point at, not the digit count.
    if (j < s.length && !isSep(s, j) && s[j] !== '\\') throw new HexError('char', j, String.fromCodePoint(s.codePointAt(j)!));
    if ((j - i) % 2) throw new HexError('odd', j - 1);
    for (let k = i; k < j; k += 2) out[n++] = (val(s.charCodeAt(k)) << 4) | val(s.charCodeAt(k + 1));
    any = true;
    i = j;
  }
  return any ? out.slice(0, n) : null;
}

const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const val = (c: number) => (c <= 57 ? c - 48 : (c | 32) - 87);
/** Separators: white space (as \s), ":", ",", ";", "-", "_". */
function isSep(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  if (c < 128) return c === 32 || (c >= 9 && c <= 13) || c === 58 || c === 44 || c === 59 || c === 45 || c === 95;
  return /\s/.test(s[i]);
}

/** Text that is hex bytes: hex digit pairs, optionally with separators or 0x / \x. */
export const looksHex = (s: string) => {
  const t = s.trim();
  if (!/^(?:(?:0x|\\x)?[0-9a-fA-F]{2}[\s:,\-]*)+$/.test(t)) return false;
  try { return (hexToBytes(t)?.length ?? 0) >= 2; } catch { return false; }
};
