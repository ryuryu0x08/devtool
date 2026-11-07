import { runRegex } from './regex';

self.onmessage = (e: MessageEvent<{ pattern: string; flags: string; text: string; repl: string | null }>) => {
  const { pattern, flags, text, repl } = e.data;
  self.postMessage(runRegex(pattern, flags, text, repl));
};
