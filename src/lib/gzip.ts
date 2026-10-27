// gzip / zlib (deflate) / raw deflate, with the browser's own CompressionStream.

export type ZFmt = 'gzip' | 'deflate' | 'deflate-raw';

/** Results larger than this stop with ZTooBig: a small file can expand to gigabytes, and holding
 *  that in the page would crash it. */
export const MAX_OUT = 256 * 1024 * 1024;
export class ZTooBig extends Error {
  constructor(readonly max: number) { super('output over ' + max + ' bytes'); }
}

/** Read the result a chunk at a time, so it can stop at MAX_OUT or when no longer wanted. */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, signal?: AbortSignal, max = MAX_OUT): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) throw new ZTooBig(max);
      chunks.push(value);
    }
  } catch (e) {
    reader.cancel().catch(() => { /* already failed */ });
    throw e;
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export const compress = (b: Uint8Array, fmt: ZFmt, signal?: AbortSignal) => pipe(b, new CompressionStream(fmt), signal);
export const decompress = (b: Uint8Array, fmt: ZFmt, signal?: AbortSignal, max = MAX_OUT) => pipe(b, new DecompressionStream(fmt), signal, max);

/** Format from the header: gzip magic, a valid zlib header, or else raw deflate. */
export function sniffZ(b: Uint8Array): ZFmt {
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  if (b.length > 1 && (b[0] & 0x0f) === 8 && (b[0] >> 4) <= 7 && ((b[0] << 8) | b[1]) % 31 === 0) return 'deflate';
  return 'deflate-raw';
}
