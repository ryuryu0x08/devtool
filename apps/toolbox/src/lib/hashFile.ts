// Hashing of files and large text off the main thread, so the page stays responsive.
import { hashers, type Digests } from './hash';

export interface HashJob { done: Promise<Digests>; cancel(): void }

/** Without workers: the same chunked reading on the main thread. */
async function inPage(blob: Blob, progress: (n: number) => void, stopped: () => boolean): Promise<Digests> {
  const h = hashers(), r = blob.stream().getReader();
  let n = 0;
  for (;;) {
    const { value, done } = await r.read();
    if (done || stopped()) break;
    h.update(value);
    progress((n += value.length));
  }
  return h.digest();
}

export function hashBlob(blob: Blob, progress: (bytes: number) => void): HashJob {
  let worker: Worker | null = null, stopped = false;
  const done = new Promise<Digests>((resolve, reject) => {
    const fallback = () => inPage(blob, progress, () => stopped).then(resolve, reject);
    try {
      worker = new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      fallback();
      return;
    }
    worker.onmessage = (e: MessageEvent<{ p?: number; d?: Digests; err?: string }>) => {
      const m = e.data;
      if (m.p !== undefined) progress(m.p);
      else { worker!.terminate(); if (m.d) resolve(m.d); else reject(new Error(m.err)); }
    };
    worker.onerror = () => { worker!.terminate(); fallback(); };
    worker.postMessage(blob);
  });
  return { done, cancel: () => { stopped = true; worker?.terminate(); } };
}
