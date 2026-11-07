// Time inside IDs: ULID (48-bit ms, Crockford Base32) and Snowflake (ms since an epoch, << 22).

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const looksUlid = (s: string) => /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(s.trim());

/** ms of a ULID, or null. */
export function ulidTime(s: string): number | null {
  const t = s.trim().toUpperCase();
  if (!looksUlid(t)) return null;
  let ms = 0;
  for (const c of t.slice(0, 10)) ms = ms * 32 + CROCKFORD.indexOf(c);
  return ms;
}

export const SNOWFLAKE_EPOCHS = { twitter: 1288834974657, discord: 1420070400000 } as const;
export type SnowflakeKind = keyof typeof SNOWFLAKE_EPOCHS;

/** ms of a Snowflake ID with the given epoch; null if it isn't a 64-bit positive integer. */
export function snowflakeTime(s: string, kind: SnowflakeKind): number | null {
  const t = s.trim();
  if (!/^\d{15,20}$/.test(t)) return null;
  const v = BigInt(t);
  if (v >= 1n << 63n) return null;
  return Number(v >> 22n) + SNOWFLAKE_EPOCHS[kind];
}
