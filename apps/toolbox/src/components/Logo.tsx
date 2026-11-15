/**
 * The app mark: "Dev" followed by a terminal's block cursor in the accent blue. Drawn on a 32 × 32
 * grid; the tile behind it is the element's own background (.logo). The shapes come from
 * brand/toolbox/mark.mjs, which generates public/favicon.svg and the desktop icons from the same ones.
 */
export const LOGO = {
  // The letters are drawn in their own units and placed on the grid by this transform.
  transform: 'translate(2.176 19.717) scale(0.035355)',
  letters: ['M23 0V-232H69A116 116 0 0 1 69 0Z', 'M253 -78H409A78 78 0 1 0 381.14 -18.25', 'M467 -156L540 0L613 -156'],
  cursor: { x: 664, y: -255, width: 118, height: 278, rx: 14 },
  stroke: 46,
  accent: '#3d6df2',
};

export function LogoGlyph() {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" style={{ display: 'block' }}>
      <g transform={LOGO.transform}>
        <g fill="none" stroke="currentColor" strokeWidth={LOGO.stroke} strokeLinecap="round" strokeLinejoin="round">
          {LOGO.letters.map((d) => <path key={d} d={d} />)}
        </g>
        <rect {...LOGO.cursor} fill={LOGO.accent} />
      </g>
    </svg>
  );
}
