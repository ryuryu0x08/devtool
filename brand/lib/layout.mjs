// Sets glyphs in a row and fits the row into a box on the canvas.
import { CENTER } from './svg.mjs';

/**
 * Places glyph builders left to right, `gaps[i]` apart between glyph i and i + 1 (outer edges).
 * Returns the placed glyphs and the row's outer bounds in design units.
 */
export function row(builders, gaps) {
  const glyphs = [];
  let left = 0;
  builders.forEach((build, index) => {
    const glyph = build(left);
    glyphs.push(glyph);
    left = glyph.right + (gaps[index] ?? 0);
  });
  const top = Math.min(...glyphs.map((glyph) => glyph.top));
  const bottom = Math.max(...glyphs.map((glyph) => glyph.bottom));
  return { glyphs, width: glyphs.at(-1).right, top, bottom };
}

/**
 * The transform that scales a row to `width` canvas pixels and centres its outer box on
 * (`centerX`, `centerY`); `lift` moves it up, since a box centred exactly looks low.
 */
export function fit(placed, { width, centerX = CENTER, centerY = CENTER, lift = 0 }) {
  const scale = width / placed.width;
  const x = centerX - width / 2;
  const y = centerY - lift - ((placed.top + placed.bottom) / 2) * scale;
  // Fine enough that a 32-unit tile drawn at 2048 px is off by well under a pixel.
  const fixed = (value, digits) => Number(value.toFixed(digits));
  return { scale, x, y, transform: `translate(${fixed(x, 3)} ${fixed(y, 3)}) scale(${fixed(scale, 6)})` };
}
