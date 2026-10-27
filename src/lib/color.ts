// Colours: HEX, rgb(), hsl(), oklch() and CSS names ⇄ each other, and WCAG contrast.

export interface Rgba { r: number; g: number; b: number; a: number } // sRGB 0–1

const NAMED: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff', beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c', cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9', darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f', darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f', darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff', gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080', green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa', lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080', lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (may be outside 0–1) → OKLab. */
export function toOklab({ r, g, b }: Rgba): [number, number, number] {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromOklab(L: number, A: number, Bb: number, a = 1): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * Bb) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * Bb) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * Bb) ** 3;
  return {
    r: gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), a,
  };
}
export function toOklch(c: Rgba): [number, number, number] {
  const [L, A, B] = toOklab(c);
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}
export const fromOklch = (L: number, C: number, H: number, a = 1) => fromOklab(L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180), a);

const inGamut = (c: Rgba, e = 1e-6) => [c.r, c.g, c.b].every((x) => x >= -e && x <= 1 + e);

/** CSS Color 4 gamut mapping: lower the OKLCH chroma until the colour fits sRGB. */
export function toGamut(L: number, C: number, H: number, a: number): { c: Rgba; mapped: boolean } {
  const direct = fromOklch(L, C, H, a);
  if (inGamut(direct)) return { c: direct, mapped: false };
  if (L >= 1) return { c: { r: 1, g: 1, b: 1, a }, mapped: true };
  if (L <= 0) return { c: { r: 0, g: 0, b: 0, a }, mapped: true };
  let lo = 0, hi = C;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(fromOklch(L, mid, H, a))) lo = mid; else hi = mid;
  }
  const c = fromOklch(L, lo, H, a);
  return { c: { r: clamp01(c.r), g: clamp01(c.g), b: clamp01(c.b), a }, mapped: true };
}

function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0), g: f(8), b: f(4), a };
}
export function toHsl({ r, g, b }: Rgba): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export interface Parsed { c: Rgba; mapped: boolean; from: 'hex' | 'rgb' | 'hsl' | 'oklch' | 'name' }

const num = (t: string, pctOf: number) => (t.endsWith('%') ? (parseFloat(t) / 100) * pctOf : parseFloat(t));
const alpha = (t?: string) => (t === undefined ? 1 : clamp01(num(t, 1)));

/** Read a CSS colour; null if it isn't one. */
export function parseColor(input: string): Parsed | null {
  const s = input.trim().toLowerCase();
  let m: RegExpExecArray | null;
  const hex = (h: string): Rgba | null => {
    if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
    const full = h.length <= 4 ? [...h].map((x) => x + x).join('') : h;
    const v = full.match(/../g)!.map((x) => parseInt(x, 16) / 255);
    return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 };
  };
  if ((m = /^#([0-9a-f]+)$/.exec(s))) { const c = hex(m[1]); return c && { c, mapped: false, from: 'hex' }; }
  if (NAMED[s]) return { c: hex(NAMED[s])!, mapped: false, from: 'name' };
  if (s === 'transparent') return { c: { r: 0, g: 0, b: 0, a: 0 }, mapped: false, from: 'name' };
  const args = (body: string) => {
    const [main, a] = body.includes('/') ? body.split('/') : [body, undefined];
    const parts = main.trim().split(/[\s,]+/).filter(Boolean);
    if (a === undefined && parts.length === 4) return { parts: parts.slice(0, 3), a: parts[3] };
    return { parts, a: a?.trim() };
  };
  const NUM = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/;
  if ((m = /^rgba?\((.*)\)$/.exec(s))) {
    const { parts, a } = args(m[1]);
    if (parts.length !== 3 || !parts.every((p) => NUM.test(p)) || (a !== undefined && !NUM.test(a))) return null;
    const [r, g, b] = parts.map((p) => clamp01(num(p, 255) / 255));
    return { c: { r, g, b, a: alpha(a) }, mapped: false, from: 'rgb' };
  }
  if ((m = /^hsla?\((.*)\)$/.exec(s))) {
    const { parts, a } = args(m[1]);
    const h = parts[0]?.replace(/deg$/, '');
    if (parts.length !== 3 || !NUM.test(h) || !NUM.test(parts[1]) || !NUM.test(parts[2])) return null;
    const c = hslToRgb(((parseFloat(h) % 360) + 360) % 360, clamp01(num(parts[1], 1) / (parts[1].endsWith('%') ? 1 : 100)), clamp01(num(parts[2], 1) / (parts[2].endsWith('%') ? 1 : 100)), alpha(a));
    return { c, mapped: false, from: 'hsl' };
  }
  if ((m = /^oklch\((.*)\)$/.exec(s))) {
    const { parts, a } = args(m[1]);
    const h = parts[2]?.replace(/deg$/, '');
    if (parts.length !== 3 || !NUM.test(parts[0]) || !NUM.test(parts[1]) || !NUM.test(h)) return null;
    const L = num(parts[0], 1), C = num(parts[1], 0.4);
    const { c, mapped } = toGamut(L, Math.max(0, C), parseFloat(h), alpha(a));
    return { c, mapped, from: 'oklch' };
  }
  return null;
}

const r8 = (x: number) => Math.round(clamp01(x) * 255);
const fx = (x: number, d: number) => String(+x.toFixed(d));

export function formats(c: Rgba): { hex: string; rgb: string; hsl: string; oklch: string } {
  const [r, g, b] = [r8(c.r), r8(c.g), r8(c.b)];
  const a = c.a < 1 ? Math.round(c.a * 255) : null;
  const hex = '#' + [r, g, b, ...(a === null ? [] : [a])].map((x) => x.toString(16).padStart(2, '0')).join('');
  const al = c.a < 1 ? ' / ' + fx(c.a, 3) : '';
  const [h, s, l] = toHsl(c);
  const [L, C, H] = toOklch(c);
  return {
    hex, rgb: `rgb(${r} ${g} ${b}${al})`, hsl: `hsl(${fx(h, 1)} ${fx(s * 100, 1)}% ${fx(l * 100, 1)}%${al})`,
    oklch: `oklch(${fx(L * 100, 2)}% ${fx(C, 4)} ${fx(H, 2)}${al})`,
  };
}

/** WCAG 2 relative luminance and contrast ratio. A translucent foreground is first laid over the background. */
export function luminance(c: Rgba): number {
  return 0.2126 * lin(clamp01(c.r)) + 0.7152 * lin(clamp01(c.g)) + 0.0722 * lin(clamp01(c.b));
}
export function contrast(fg: Rgba, bg: Rgba): number {
  const over = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
  const [x, y] = [luminance(over), luminance(bg)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const looksColor = (s: string) => /^\s*(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch)\(.*\))\s*$/i.test(s) && parseColor(s) !== null;
