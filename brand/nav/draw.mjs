// Drawing the navigation page's icons: a glyph on a 24-unit grid (stroke 2, round caps, like the
// common icon sets), set on the dark full-bleed square tile the toolbox's icon uses, with one accent
// in the app's colour. The page rounds the corners itself, so the tile is square.
import { CANVAS, n, svgDocument } from '../lib/svg.mjs';
import { FRAME, TILE_STYLE, tile } from '../lib/tile.mjs';

const GRID = 24;
const GLYPH_SHARE = 0.6; // the glyph grid's side as a part of the tile
const STROKE = 2;
const DEG = Math.PI / 180;
const ARROW_SPREAD = 42; // degrees between an arrowhead's arm and its shaft

/** The colours of a glyph's roles: `main` strokes, `soft` secondary marks; `hi`, the accent, is the app's. */
const INK = { main: '#f5f5f2', soft: 'rgba(245,245,242,0.42)' };

// Glyph elements. Coordinates are on the 24 grid; stroke elements run on their centrelines.
const element = (kind, role, markup, opacity) => ({ kind, role, markup, opacity });
export const path = (d, role = 'main') => element('stroke', role, `<path d="${d}"/>`);
export const line = (x1, y1, x2, y2, role = 'main') => path(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`, role);
export const rect = (x, y, width, height, radius, role = 'main') =>
  element('stroke', role, `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/>`);
export const circle = (cx, cy, r, role = 'main') => element('stroke', role, `<circle cx="${cx}" cy="${cy}" r="${r}"/>`);
export const fillPath = (d, role = 'hi', opacity) => element('fill', role, `<path d="${d}"/>`, opacity);
export const fillRect = (x, y, width, height, radius, role = 'hi', opacity) =>
  element('fill', role, `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/>`, opacity);
export const fillCircle = (cx, cy, r, role = 'hi', opacity) => element('fill', role, `<circle cx="${cx}" cy="${cy}" r="${r}"/>`, opacity);

/** The point `r` from (cx, cy) at `deg` degrees; 0 is to the right and 90 is down. */
export function polar(cx, cy, r, deg) {
  return [cx + r * Math.cos(deg * DEG), cy + r * Math.sin(deg * DEG)];
}

/** An arc's path, clockwise on screen from `from` to `to` degrees. */
export function arc(cx, cy, r, from, to) {
  const span = (((to - from) % 360) + 360) % 360;
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  return `M${n(x0)} ${n(y0)}A${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${n(x1)} ${n(y1)}`;
}

/** An arrowhead's path at (x, y), pointing along `deg`, with arms `size` long. */
export function arrowHead(x, y, deg, size) {
  const [ax, ay] = polar(x, y, size, deg + 180 - ARROW_SPREAD);
  const [bx, by] = polar(x, y, size, deg + 180 + ARROW_SPREAD);
  return `M${n(ax)} ${n(ay)}L${n(x)} ${n(y)}L${n(bx)} ${n(by)}`;
}

/**
 * Another drawing set into the glyph: `children` drawn under `transform`, their strokes `strokeWidth`
 * wide in their own units (as the toolbox's mark, drawn in letter units).
 */
export const scaled = (transform, strokeWidth, children) => ({ kind: 'group', transform, strokeWidth, children });

/** The transform that lays a drawing made on a `side`-unit tile over the whole tile, from the glyph grid. */
export function wholeTile(side) {
  const tileUnits = GRID / GLYPH_SHARE;
  const offset = (GRID - tileUnits) / 2;
  return `translate(${n(offset)} ${n(offset)}) scale(${n(tileUnits / side)})`;
}

function paint(item, colors, strokeWidth = STROKE) {
  if (item.kind === 'group') {
    const inner = item.children.map((child) => paint(child, colors, item.strokeWidth)).join('');
    return `<g transform="${item.transform}">${inner}</g>`;
  }
  const color = colors[item.role];
  if (!color) throw new Error(`unknown glyph role ${item.role}`);
  const opacity = item.opacity === undefined ? '' : ` opacity="${item.opacity}"`;
  const style = item.kind === 'fill'
    ? `fill="${color}"`
    : `fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  return item.markup.replace('/>', ` ${style}${opacity}/>`);
}

/** The icon of `glyph` for `app`, as an SVG document on the 1024 canvas. */
export function navIconSvg(app, glyph) {
  const background = tile(TILE_STYLE.dark, FRAME.bleed);
  const colors = { ...INK, hi: app.accent };
  const side = CANVAS * GLYPH_SHARE;
  const offset = (CANVAS - side) / 2;
  return svgDocument({
    comment: `nav ${app.name}: ${glyph.name}, drawn by devtool brand/nav/glyphs/${app.id}.mjs`,
    defs: background.defs,
    body: [
      ...background.body,
      `<g transform="translate(${n(offset)} ${n(offset)}) scale(${n(side / GRID)})">`,
      ...glyph.draw().map((item) => `  ${paint(item, colors)}`),
      '</g>',
    ],
  });
}
