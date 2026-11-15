// The toolbox's mark: "Dev" followed by a terminal's block cursor. It is laid out on a 32 × 32 tile,
// the grid of the favicon and of the in-app logo (apps/toolbox/src/components/Logo.tsx, which must
// draw the same shapes), and every other icon file scales that tile to its own size.
import { fit, row } from '../lib/layout.mjs';
import { monoline } from '../lib/monoline.mjs';
import { linearGradient, n, svgDocument } from '../lib/svg.mjs';
import { FRAME, TILE_STYLE, tile } from '../lib/tile.mjs';

const GRID = 32;
// The word's width and its optical lift, as parts of the tile (712 and 10 px of an 824 px tile).
const WORD_WIDTH = 0.864;
const LIFT = 0.012;
const GAPS = [22, 12, 28]; // D to e, e to v, v to the cursor, between outer edges, in letter units

const FAVICON = { radius: 7, light: { tile: '#1b1b1d', ink: '#ffffff' }, dark: { tile: '#ededeb', ink: '#121211' } };
const ICON = { ink: '#f5f5f2', cursor: ['#5a86ff', '#3d6df2'] };
/** The cursor's colour where it is one flat colour (favicon, in-app logo); the toolbox's accent. */
export const ACCENT = '#3d6df2';

function layout() {
  const font = monoline({ stroke: 46, cap: 232, xHeight: 156 });
  const cursor = font.block({ width: 118, top: -font.cap - font.half, bottom: font.half, radius: 14 });
  const placed = row([font.D({ flat: 46 }), font.e({ apertureDeg: 50 }), font.v({ width: 146 }), cursor], GAPS);
  const { transform } = fit(placed, { width: GRID * WORD_WIDTH, centerX: GRID / 2, centerY: GRID / 2, lift: GRID * LIFT });
  const [d, e, v, block] = placed.glyphs;
  const pathOf = (glyph) => glyph.shape.match(/d="([^"]+)"/)[1];
  const rect = (name) => n(Number(block.shape.match(new RegExp(`${name}="([^"]+)"`))[1]));
  return {
    transform,
    stroke: font.stroke,
    letters: { d: pathOf(d), e: pathOf(e), v: pathOf(v) },
    cursor: { x: rect('x'), y: rect('y'), width: rect('width'), height: rect('height'), rx: rect('rx') },
  };
}

/** The mark's shapes in tile units: what Logo.tsx copies. */
export const MARK = layout();

const attrs = (shape) => Object.entries(shape).map(([key, value]) => `${key}="${value}"`).join(' ');

/** The mark on the 32 grid: the letters stroked with `ink` (or a class), the cursor filled with `cursor`. */
function glyph({ ink, inkClass, cursor }) {
  const stroke = inkClass ? `class="${inkClass}"` : `stroke="${ink}"`;
  return [
    `<g transform="${MARK.transform}">`,
    `  <g ${stroke} fill="none" stroke-width="${MARK.stroke}" stroke-linecap="round" stroke-linejoin="round">`,
    ...Object.values(MARK.letters).map((d) => `    <path d="${d}"/>`),
    '  </g>',
    `  <rect ${attrs(MARK.cursor)} fill="${cursor}"/>`,
    '</g>',
  ];
}

/** The browser-tab icon: one flat tile that turns light when the system is dark, like the old one. */
export function faviconSvg() {
  const { light, dark } = FAVICON;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">`,
    '  <!-- 工具箱: "Dev" and a terminal cursor, drawn by brand/toolbox/mark.mjs; Logo.tsx draws the same shapes. -->',
    `  <style>.t{fill:${light.tile}}.g{stroke:${light.ink}}@media (prefers-color-scheme:dark){.t{fill:${dark.tile}}.g{stroke:${dark.ink}}}</style>`,
    `  <rect class="t" width="${GRID}" height="${GRID}" rx="${FAVICON.radius}"/>`,
    ...glyph({ inkClass: 'g', cursor: ACCENT }).map((line) => `  ${line}`),
    '</svg>',
    '',
  ].join('\n');
}

/** The mark on the shaded tile, on the 1024 canvas, in `frame` (FRAME.app or FRAME.bleed). */
export function iconSvg(frame) {
  const background = tile(TILE_STYLE.dark, frame);
  const scale = Number((frame.size / GRID).toFixed(6));
  return svgDocument({
    comment: `工具箱: "Dev" and a terminal cursor, drawn by brand/toolbox/mark.mjs (${frame === FRAME.app ? 'app icon grid' : 'full bleed'})`,
    defs: [...background.defs, linearGradient('cursor', [[0, ICON.cursor[0]], [1, ICON.cursor[1]]])],
    body: [
      ...background.body,
      `<g transform="translate(${frame.inset} ${frame.inset}) scale(${scale})">`,
      ...glyph({ ink: ICON.ink, cursor: 'url(#cursor)' }).map((line) => `  ${line}`),
      '</g>',
    ],
  });
}
