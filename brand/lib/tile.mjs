// The rounded square an icon sits on, and the frames it can be placed in on the 1024 canvas.
import { CANVAS, glowGradient, linearGradient } from './svg.mjs';

/**
 * Where the tile sits on the canvas.
 *   app    the macOS icon grid: 824 px with a 186 px corner, transparent around it (desktop app icons)
 *   bleed  the whole canvas, square: whoever shows it rounds the corners (the iOS home screen, the
 *          navigation page's tiles)
 */
export const FRAME = {
  app: { inset: 100, size: 824, radius: 186, rim: true },
  bleed: { inset: 0, size: CANVAS, radius: 0, rim: false },
};

/** Tile colours top to bottom, with the rim and the highlight drawn over it. */
export const TILE_STYLE = {
  dark: { top: '#2c2c31', bottom: '#141416', rim: 'rgba(255,255,255,0.08)', glow: 'rgba(255,255,255,0.07)' },
};

const RIM_WIDTH = 2;

/** The tile's defs and body in `frame`. A frame without a rim leaves it out, since its corners get cut. */
export function tile(style, frame) {
  const { inset, size, radius } = frame;
  const shape = `x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${radius}"`;
  const rim = inset + RIM_WIDTH / 2;
  const body = [`<rect ${shape} fill="url(#tile)"/>`, `<rect ${shape} fill="url(#tile-glow)"/>`];
  if (frame.rim) {
    body.push(`<rect x="${rim}" y="${rim}" width="${size - RIM_WIDTH}" height="${size - RIM_WIDTH}" rx="${radius - RIM_WIDTH / 2}" fill="none" stroke="${style.rim}" stroke-width="${RIM_WIDTH}"/>`);
  }
  return { defs: [linearGradient('tile', [[0, style.top], [1, style.bottom]]), glowGradient('tile-glow', style.glow)], body };
}
