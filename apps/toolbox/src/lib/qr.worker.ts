// Runs the jsQR scan off the main thread.
import { scanBitmap } from './qr';

self.onmessage = (e: MessageEvent<ImageBitmap>) => {
  self.postMessage(scanBitmap(e.data));
};
