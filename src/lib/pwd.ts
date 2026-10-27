// Random passwords / strings from the browser's cryptographic random source, without modulo bias.

export interface PwdOpts { lower: boolean; upper: boolean; digits: boolean; symbols: boolean; extra: string; noAmbiguous: boolean; eachClass: boolean }

export const SETS = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: '!@#$%^&*()-_=+[]{};:,.<>/?~' };
const AMBIGUOUS = /[Il1O0o]/g;

/** The selected classes (each without duplicates), and their union. */
export function charset(o: PwdOpts): { classes: string[]; all: string[] } {
  const classes: string[] = [];
  for (const k of ['lower', 'upper', 'digits', 'symbols'] as const) if (o[k]) classes.push(SETS[k]);
  if (o.extra) classes.push(o.extra);
  const clean = classes.map((c) => [...new Set([...(o.noAmbiguous ? c.replace(AMBIGUOUS, '') : c)])].join('')).filter(Boolean);
  return { classes: clean, all: [...new Set(clean.flatMap((c) => [...c]))] };
}

/** Uniform integer in [0, n): values from the top of the 32-bit range that would bias it are drawn again. */
export function randInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** One password. With eachClass, a draw missing a class is thrown away and drawn again, which
 *  keeps every valid password equally likely. */
export function password(len: number, o: PwdOpts): string | null {
  const { classes, all } = charset(o);
  if (!all.length || len < 1) return null;
  if (o.eachClass && classes.length > len) return null;
  for (let tries = 0; tries < 10000; tries++) {
    const p = Array.from({ length: len }, () => all[randInt(all.length)]);
    if (!o.eachClass || classes.every((c) => p.some((ch) => c.includes(ch)))) return p.join('');
  }
  return null;
}

/** Bits of entropy of a uniform draw (slightly less with eachClass). */
export const entropy = (len: number, size: number) => (size > 1 ? len * Math.log2(size) : 0);
