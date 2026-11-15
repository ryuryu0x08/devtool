// SVG building blocks every icon design uses: the canvas, number formatting, gradients, the document.

export const CANVAS = 1024;
export const CENTER = CANVAS / 2;

/** Rounds to two decimals so the SVG stays short and stable between runs. */
export const n = (value) => Number(value.toFixed(2));

/** A vertical gradient by default; pass x2/y2 to turn it. Stops are [offset, colour] pairs. */
export function linearGradient(id, stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = {}) {
  const tags = stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('');
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${tags}</linearGradient>`;
}

/** A soft highlight from the upper left that fades to nothing. */
export function glowGradient(id, color) {
  return `<radialGradient id="${id}" cx="0.3" cy="0.12" r="0.75"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
}

/** Wraps a design's defs and body into a 1024 × 1024 SVG document. */
export function svgDocument({ comment, defs, body }) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">`,
    `<!-- ${comment} -->`,
    '<defs>',
    ...defs.map((def) => `  ${def}`),
    '</defs>',
    ...body,
    '</svg>',
    '',
  ].join('\n');
}
