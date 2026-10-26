import { hashers } from './hash';

/** Hash a file (or large text) in chunks, reporting progress about ten times a second. */
self.onmessage = async (e: MessageEvent<Blob>) => {
  try {
    const h = hashers(), r = e.data.stream().getReader();
    let n = 0, t = 0;
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      h.update(value);
      n += value.length;
      if (performance.now() - t > 100) { t = performance.now(); self.postMessage({ p: n }); }
    }
    self.postMessage({ d: h.digest() });
  } catch (err) {
    self.postMessage({ err: String(err) });
  }
};
