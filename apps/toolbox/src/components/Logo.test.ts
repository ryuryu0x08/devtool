// The favicon is generated (brand/export-toolbox-icon.mjs): it must stay the same drawing as the in-app mark.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOGO } from './Logo';

describe('logo', () => {
  it('public/favicon.svg draws the same shapes as LogoGlyph', () => {
    const svg = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8');
    const attrs = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
    expect(svg).toContain(`<g transform="${LOGO.transform}">`);
    for (const d of LOGO.letters) expect(svg).toContain(`<path d="${d}"/>`);
    expect(svg).toContain(`<rect ${attrs(LOGO.cursor)} fill="${LOGO.accent}"/>`);
    expect(svg).toContain(`stroke-width="${LOGO.stroke}"`);
  });
});
