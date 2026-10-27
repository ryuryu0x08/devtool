// gzip / zlib (deflate) / raw deflate, with the browser's own CompressionStream.

export type ZFmt = 'gzip' | 'deflate' | 'deflate-raw';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export const compress = (b: Uint8Array, fmt: ZFmt) => pipe(b, new CompressionStream(fmt));
export const decompress = (b: Uint8Array, fmt: ZFmt) => pipe(b, new DecompressionStream(fmt));

/** Format from the header: gzip magic, a valid zlib header, or else raw deflate. */
export function sniffZ(b: Uint8Array): ZFmt {
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  if (b.length > 1 && (b[0] & 0x0f) === 8 && (b[0] >> 4) <= 7 && ((b[0] << 8) | b[1]) % 31 === 0) return 'deflate';
  return 'deflate-raw';
}
