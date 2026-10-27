// UUIDs (RFC 9562): generate v4 / v7, and read any UUID's version, variant and embedded time.

const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const fmt = (b: Uint8Array) => {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export function uuid4(): string {
  const b = rnd(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmt(b);
}

let last = { ms: -1, rand: 0n };
/** v7: 48-bit Unix ms, then 74 random bits. Within one millisecond the random part counts up,
 *  so a batch is strictly increasing (RFC 9562 §6.2, method 2). */
export function uuid7(now = Date.now()): string {
  let ms = now, rand: bigint;
  if (ms <= last.ms) { ms = last.ms; rand = last.rand + 1n; }
  else rand = BigInt('0x' + Array.from(rnd(10), (x) => x.toString(16).padStart(2, '0')).join('')) & ((1n << 73n) - 1n);
  last = { ms, rand };
  const b = new Uint8Array(16);
  for (let i = 0; i < 6; i++) b[i] = Number((BigInt(ms) >> BigInt(8 * (5 - i))) & 0xffn);
  const randA = Number(rand >> 62n) & 0xfff, randB = rand & ((1n << 62n) - 1n);
  b[6] = 0x70 | (randA >> 8);
  b[7] = randA & 0xff;
  for (let i = 0; i < 8; i++) b[8 + i] = Number((randB >> BigInt(8 * (7 - i))) & 0xffn);
  b[8] = (b[8] & 0x3f) | 0x80;
  return fmt(b);
}

export interface UuidInfo {
  canonical: string; version: number; variant: 'ncs' | 'rfc' | 'microsoft' | 'future';
  /** Unix ms of v1 / v6 / v7, with the finer digits of v1 / v6 (100 ns units) when present. */
  ms?: number; sub?: string; clockSeq?: number; node?: string; nil?: boolean; max?: boolean;
}

export function parseUuid(s: string): UuidInfo | null {
  const t = s.trim().replace(/^urn:uuid:/i, '').replace(/^\{(.*)\}$/, '$1');
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(t)) return null;
  const h = t.replace(/-/g, '').toLowerCase();
  const canonical = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  if (/^0+$/.test(h)) return { canonical, version: 0, variant: 'ncs', nil: true };
  if (/^f+$/.test(h)) return { canonical, version: 15, variant: 'future', max: true };
  const version = parseInt(h[12], 16), v8 = parseInt(h[16], 16);
  const variant = v8 < 8 ? 'ncs' : v8 < 12 ? 'rfc' : v8 < 14 ? 'microsoft' : 'future';
  const info: UuidInfo = { canonical, version, variant };
  if (variant !== 'rfc') return info;
  if (version === 7) info.ms = parseInt(h.slice(0, 12), 16);
  if (version === 1 || version === 6) {
    const ts = version === 1 ? BigInt('0x' + h.slice(13, 16) + h.slice(8, 12) + h.slice(0, 8)) : BigInt('0x' + h.slice(0, 12) + h.slice(13, 16));
    // 100 ns intervals since 1582-10-15.
    const units = ts - 122192928000000000n;
    const ms = units / 10000n, rem = units % 10000n;
    info.ms = Number(ms) - (rem < 0n ? 1 : 0);
    const r = rem < 0n ? rem + 10000n : rem;
    info.sub = r ? String(r).padStart(4, '0').replace(/0+$/, '') : '';
    info.clockSeq = parseInt(h.slice(16, 20), 16) & 0x3fff;
    info.node = h.slice(20).match(/../g)!.join(':');
  }
  return info;
}

export const looksUuid = (s: string) => parseUuid(s) !== null && /^\s*(urn:uuid:)?\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(s);
