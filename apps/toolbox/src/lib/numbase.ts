// Integers in any base 2–36, exact at any size (BigInt).

export class NumError extends Error {
  constructor(readonly code: 'char' | 'frac' | 'empty', readonly pos: number, readonly ch = '') { super(code + ' at ' + pos); }
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Read an integer. With base 'auto', 0x / 0o / 0b prefixes pick the base, otherwise decimal.
 * "_", "'", "," and spaces between digits are separators (1_000, 1,000, 1 000).
 */
export function readInt(input: string, base: number | 'auto'): { v: bigint; base: number } {
  const s = input.trim(), off = input.indexOf(s);
  if (!s) throw new NumError('empty', 0);
  let i = 0, neg = false;
  if (s[0] === '-' || s[0] === '+') { neg = s[0] === '-'; i = 1; }
  let b = base === 'auto' ? 10 : base;
  const pre = s.slice(i, i + 2).toLowerCase();
  if ((base === 'auto' || base === 16) && pre === '0x') { b = 16; i += 2; }
  else if ((base === 'auto' || base === 8) && pre === '0o') { b = 8; i += 2; }
  else if ((base === 'auto' || base === 2) && pre === '0b') { b = 2; i += 2; }
  let v = 0n, digits = 0;
  const B = BigInt(b);
  for (; i < s.length; i++) {
    const c = s[i].toLowerCase();
    if (/[_',\s]/.test(c) && digits) continue;
    if (c === '.' && b === 10) throw new NumError('frac', off + i);
    const d = DIGITS.indexOf(c);
    if (d < 0 || d >= b) throw new NumError('char', off + i, String.fromCodePoint(s.codePointAt(i)!));
    v = v * B + BigInt(d);
    digits++;
  }
  if (!digits) throw new NumError('empty', off + i);
  return { v: neg ? -v : v, base: b };
}

/** Digits in groups from the right: 4 for binary / hex, 3 otherwise; "" for none. */
export function writeInt(v: bigint, base: number, group = false): string {
  const neg = v < 0n;
  let s = (neg ? -v : v).toString(base);
  if (group) {
    const g = base === 2 || base === 16 ? 4 : 3;
    s = s.replace(new RegExp(`\\B(?=(.{${g}})+$)`, 'g'), base === 10 ? ',' : ' ');
  }
  return (neg ? '-' : '') + s;
}

/** Fixed-width views: the bits of v as an unsigned and as a two's complement signed number. */
export function widths(v: bigint): { bits: number; unsigned: bigint; signed: bigint; hex: string }[] {
  const out = [];
  for (const bits of [8, 16, 32, 64, 128]) {
    const B = BigInt(bits), max = 1n << B;
    if (v >= max || v < -(max >> 1n)) continue;
    const unsigned = v < 0n ? v + max : v;
    const signed = unsigned >= max >> 1n ? unsigned - max : unsigned;
    out.push({ bits, unsigned, signed, hex: unsigned.toString(16).toUpperCase().padStart(bits / 4, '0') });
  }
  return out;
}
