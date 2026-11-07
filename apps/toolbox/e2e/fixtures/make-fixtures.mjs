// Generates the QR fixtures used by the e2e tests: node e2e/fixtures/make-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const qrcode = createRequire(import.meta.url)('qrcode-generator');

/** QR modules for raw bytes (so non-UTF-8 encodings can be produced). */
function modules(bytes) {
  const saved = qrcode.stringToBytes;
  qrcode.stringToBytes = () => bytes;
  const q = qrcode(0, 'M');
  q.addData('x', 'Byte');
  q.make();
  qrcode.stringToBytes = saved;
  const n = q.getModuleCount();
  return { n, dark: (r, c) => q.isDark(r, c) };
}
/** Codes laid out in rows of `cols`, each with its quiet zone. */
function svg(codes, cols = codes.length, scale = 8) {
  const cell = Math.max(...codes.map((m) => (m.n + 8) * scale));
  const W = cell * cols, H = cell * Math.ceil(codes.length / cols);
  let rects = '';
  codes.forEach((m, i) => {
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * cell;
    for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++)
      if (m.dark(r, c)) rects += `<rect x="${ox + (c + 4) * scale}" y="${oy + (r + 4) * scale}" width="${scale}" height="${scale}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>\n`;
}
const utf8 = (s) => [...new TextEncoder().encode(s)];
// "中文测试" in GBK (common in older Chinese QR codes; not valid UTF-8).
writeFileSync(new URL('./gbk.svg', import.meta.url), svg([modules([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4])]));
writeFileSync(new URL('./two-codes.svg', import.meta.url), svg([modules(utf8('https://example.com/first')), modules(utf8('第二个 second'))]));
writeFileSync(new URL('./three-in-a-row.svg', import.meta.url), svg(['one', 'two', 'three'].map((t) => modules(utf8(t)))));
writeFileSync(new URL('./four-grid.svg', import.meta.url), svg(['A1', 'A2', 'B1', 'B2'].map((t) => modules(utf8(t))), 2));
