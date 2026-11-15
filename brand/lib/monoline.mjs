// Letters and code marks drawn as round-capped strokes of one width. Coordinates are design units on
// the stroke centrelines with the baseline at y = 0 (up is negative). Each glyph is a function of its
// left outer edge that returns its shape, its kind ('stroke' or 'fill') and its outer bounds.
import { n } from './svg.mjs';

const DEG = Math.PI / 180;

export function monoline({ stroke, cap, xHeight }) {
  const half = stroke / 2;
  const strokeGlyph = (d, right, top, bottom) => ({ kind: 'stroke', shape: `<path d="${d}"/>`, right, top, bottom });

  /** Upper-case D: a stem, a straight run of `flat`, then a half circle the height of the capital. */
  const D = ({ flat }) => (left) => {
    const stem = left + half;
    const radius = cap / 2;
    const turn = stem + flat;
    const d = `M${n(stem)} 0V${-cap}H${n(turn)}A${n(radius)} ${n(radius)} 0 0 1 ${n(turn)} 0Z`;
    return { ...strokeGlyph(d, turn + radius + half, -cap - half, half), stem, turn, radius };
  };

  /** Lower-case e: a crossbar through a circle that stops `apertureDeg` below the bar on the right. */
  const e = ({ apertureDeg }) => (left) => {
    const radius = xHeight / 2;
    const cx = left + half + radius;
    const cy = -radius;
    const endX = cx + radius * Math.cos(apertureDeg * DEG);
    const endY = cy + radius * Math.sin(apertureDeg * DEG);
    const d = `M${n(cx - radius)} ${n(cy)}H${n(cx + radius)}A${n(radius)} ${n(radius)} 0 1 0 ${n(endX)} ${n(endY)}`;
    return strokeGlyph(d, cx + radius + half, -xHeight - half, half);
  };

  /** Lower-case v. */
  const v = ({ width }) => (left) => {
    const start = left + half;
    const d = `M${n(start)} ${-xHeight}L${n(start + width / 2)} 0L${n(start + width)} ${-xHeight}`;
    return strokeGlyph(d, start + width + half, -xHeight - half, half);
  };

  /** An angle bracket between the centreline heights `top` and `bottom`: points 'left' is '<', 'right' is '>'. */
  const angle = ({ width, top, bottom, points }) => (left) => {
    const near = left + half;
    const far = near + width;
    const middle = (top + bottom) / 2;
    const [outer, tip] = points === 'left' ? [far, near] : [near, far];
    const d = `M${n(outer)} ${n(top)}L${n(tip)} ${n(middle)}L${n(outer)} ${n(bottom)}`;
    return strokeGlyph(d, far + half, top - half, bottom + half);
  };

  /** A forward slash between the centreline heights `top` and `bottom`. */
  const slash = ({ width, top, bottom }) => (left) => {
    const start = left + half;
    const d = `M${n(start)} ${n(bottom)}L${n(start + width)} ${n(top)}`;
    return strokeGlyph(d, start + width + half, top - half, bottom + half);
  };

  /** A filled rounded block between the outer heights `top` and `bottom` (a cursor, an underscore). */
  const block = ({ width, top, bottom, radius }) => (left) => ({
    kind: 'fill',
    shape: `<rect x="${n(left)}" y="${n(top)}" width="${n(width)}" height="${n(bottom - top)}" rx="${n(radius)}"/>`,
    right: left + width,
    top,
    bottom,
  });

  return { stroke, cap, xHeight, half, D, e, v, angle, slash, block };
}

/** Paints one glyph: strokes get the line style, fills just the colour. */
export function paint(glyph, color, stroke) {
  if (glyph.kind === 'fill') return glyph.shape.replace('/>', ` fill="${color}"/>`);
  const style = `fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"`;
  return glyph.shape.replace('/>', ` ${style}/>`);
}
