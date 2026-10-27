// Hex ⇄ bytes. Reading accepts the usual spellings (0x, \x, spaces, colons, dashes, commas).

export type HexSep = '' | ' ' | ':';
export type HexPrefix = '' | '0x' | '\\x';

export function bytesToHex(b: Uint8Array, sep: HexSep, upper: boolean, prefix: HexPrefix): string {
  const parts = Array.from(b, (x) => prefix + x.toString(16).padStart(2, '0'));
  const s = parts.join(sep);
  return upper ? s.toUpperCase().replace(/0X/g, '0x').replace(/\\X/g, '\\x') : s;
}

export class HexError extends Error {
  constructor(readonly code: 'char' | 'odd', readonly pos: number, readonly ch = '') { super(code + ' at ' + pos); }
}

/** Parse hex text into bytes. A byte written as one digit between separators ("0x1") is an error,
 *  not a guess; so is an odd number of digits in one run. */
export function hexToBytes(s: string): Uint8Array | null {
  const out: number[] = [];
  let i = 0, any = false;
  while (i < s.length) {
    const c = s[i];
    if (/[\s:,;\-_]/.test(c)) { i++; continue; }
    if ((c === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X') && /[0-9a-fA-F]/.test(s[i + 2] || '')) || (c === '\\' && s[i + 1] === 'x')) { i += 2; continue; }
    let j = i;
    while (j < s.length && /[0-9a-fA-F]/.test(s[j])) j++;
    if (j === i) throw new HexError('char', i, String.fromCodePoint(s.codePointAt(i)!));
    // A letter right after the digits is the mistake to point at, not the digit count.
    if (j < s.length && !/[\s:,;\-_]/.test(s[j]) && s[j] !== '\\' && !(s[j] === '0' && /[xX]/.test(s[j + 1] || ''))) throw new HexError('char', j, String.fromCodePoint(s.codePointAt(j)!));
    if ((j - i) % 2) throw new HexError('odd', j - 1);
    for (let k = i; k < j; k += 2) out.push(parseInt(s.slice(k, k + 2), 16));
    any = true;
    i = j;
  }
  return any ? Uint8Array.from(out) : null;
}

/** Text that is hex bytes: hex digit pairs, optionally with separators or 0x / \x. */
export const looksHex = (s: string) => {
  const t = s.trim();
  if (!/^(?:(?:0x|\\x)?[0-9a-fA-F]{2}[\s:,\-]*)+$/.test(t)) return false;
  try { return (hexToBytes(t)?.length ?? 0) >= 2; } catch { return false; }
};
