/**
 * The app mark: a toolbox whose latch is the accent blue. Drawn on a 32 × 32 grid; the tile
 * behind it is the element's own background (.logo). public/favicon.svg uses the same shapes.
 */
export const LOGO = {
  handle: 'M12.5 11.5V9.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2',
  body: { x: 6.5, y: 11.5, width: 19, height: 13, rx: 2.5 },
  lid: 'M6.5 17.2h19',
  latch: { x: 14, y: 15.2, width: 4, height: 4, rx: 1 },
  stroke: 2.2,
  accent: '#3d6df2',
};

export function LogoGlyph() {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true" style={{ display: 'block' }}>
      <g fill="none" stroke="currentColor" strokeWidth={LOGO.stroke} strokeLinecap="round" strokeLinejoin="round">
        <path d={LOGO.handle} />
        <rect {...LOGO.body} />
        <path d={LOGO.lid} />
      </g>
      <rect {...LOGO.latch} fill={LOGO.accent} />
    </svg>
  );
}
