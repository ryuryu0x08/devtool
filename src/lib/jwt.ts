// JWT: decode header and payload (numbers and keys exactly as written), read the time claims,
// and check the signature with the browser's Web Crypto.
import { b64decode } from './b64';
import { decodeUtf8 } from './data';
import { parseJsonAst, printJson, type JNode } from './json';

export interface JwtPart { text: string; ast: JNode; obj: Record<string, unknown> }
export interface Jwt { header: JwtPart; payload: JwtPart; sig: Uint8Array; signed: string; alg: string }

export class JwtError extends Error {
  constructor(readonly code: 'parts' | 'jwe' | 'b64' | 'utf8' | 'json' | 'obj', readonly part = 0) { super(code); }
}

export const looksJwt = (s: string) => /^eyJ[\w-]*\.eyJ[\w-]*\.[\w-]*$/.test(s.trim().replace(/^Bearer\s+/i, ''));

function part(seg: string, i: number): JwtPart {
  let r;
  try { r = b64decode(seg); } catch { throw new JwtError('b64', i); }
  const text = r ? decodeUtf8(r.bytes) : '';
  if (text === null) throw new JwtError('utf8', i);
  let ast: JNode;
  try { ast = parseJsonAst(text).ast; } catch { throw new JwtError('json', i); }
  if (ast.t !== 'obj') throw new JwtError('obj', i);
  return { text: printJson(ast, 2), ast, obj: JSON.parse(text) };
}

export function decodeJwt(input: string): Jwt {
  const s = input.trim().replace(/^Bearer\s+/i, '');
  const segs = s.split('.');
  if (segs.length === 5) throw new JwtError('jwe');
  if (segs.length !== 3) throw new JwtError('parts');
  const header = part(segs[0], 0), payload = part(segs[1], 1);
  let sig: Uint8Array;
  try { sig = b64decode(segs[2])?.bytes ?? new Uint8Array(); } catch { throw new JwtError('b64', 2); }
  return { header, payload, sig, signed: segs[0] + '.' + segs[1], alg: String(header.obj.alg ?? '') };
}

/** exp / nbf / iat as instants (ms), when they are numbers. */
export function times(p: Record<string, unknown>): { exp?: number; nbf?: number; iat?: number } {
  const t = (k: string) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) * 1000 : undefined);
  return { exp: t('exp'), nbf: t('nbf'), iat: t('iat') };
}

const HASH: Record<string, string> = { '256': 'SHA-256', '384': 'SHA-384', '512': 'SHA-512' };

function pemBody(pem: string): Uint8Array {
  const b = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const r = b64decode(b);
  if (!r) throw new Error('empty key');
  return r.bytes;
}

export type Verify = 'ok' | 'bad' | 'unsupported' | 'nocrypto' | 'key';

/** Check the signature. HS*: the key is the shared secret (text). RS* / PS* / ES* / EdDSA: a
 *  public key as PEM (SPKI) or JWK. */
export async function verifyJwt(j: Jwt, key: string): Promise<Verify> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return 'nocrypto';
  const data = new TextEncoder().encode(j.signed);
  const m = /^(HS|RS|PS|ES)(256|384|512)$|^(EdDSA|Ed25519)$/.exec(j.alg);
  if (!m) return 'unsupported';
  try {
    let k: CryptoKey, algo: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
    const asKey = (usage: KeyUsage[], imp: RsaHashedImportParams | EcKeyImportParams | HmacImportParams | Algorithm) => {
      const t = key.trim();
      if (t.startsWith('{')) return subtle.importKey('jwk', JSON.parse(t), imp, false, usage);
      return subtle.importKey('spki', pemBody(t) as BufferSource, imp, false, usage);
    };
    if (m[1] === 'HS') {
      k = await subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: HASH[m[2]] }, false, ['verify']);
      algo = 'HMAC';
    } else if (m[1] === 'RS') {
      k = await asKey(['verify'], { name: 'RSASSA-PKCS1-v1_5', hash: HASH[m[2]] });
      algo = 'RSASSA-PKCS1-v1_5';
    } else if (m[1] === 'PS') {
      k = await asKey(['verify'], { name: 'RSA-PSS', hash: HASH[m[2]] });
      algo = { name: 'RSA-PSS', saltLength: Number(m[2]) / 8 };
    } else if (m[1] === 'ES') {
      const curve = { '256': 'P-256', '384': 'P-384', '512': 'P-521' }[m[2]]!;
      k = await asKey(['verify'], { name: 'ECDSA', namedCurve: curve });
      algo = { name: 'ECDSA', hash: HASH[m[2]] };
    } else {
      k = await asKey(['verify'], { name: 'Ed25519' });
      algo = 'Ed25519';
    }
    return (await subtle.verify(algo, k, j.sig as BufferSource, data)) ? 'ok' : 'bad';
  } catch {
    return 'key';
  }
}
