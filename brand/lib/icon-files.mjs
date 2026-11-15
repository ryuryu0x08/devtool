// Packing PNGs into the icon files desktop apps use: .ico for Windows, .icns for macOS.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// ICO: a 6-byte header, a 16-byte entry per image, then the images; Windows Vista and later read PNG images.
const ICO_HEADER = 6;
const ICO_ENTRY = 16;
const ICO_TYPE_ICON = 1;
const ICO_BITS = 32;
const ICO_MAX_SIDE = 256; // written as 0 in the one-byte width and height

/** `images` maps a side in pixels to its PNG. */
export function ico(images) {
  const sides = [...images.keys()].sort((a, b) => a - b);
  const header = Buffer.alloc(ICO_HEADER + ICO_ENTRY * sides.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(ICO_TYPE_ICON, 2);
  header.writeUInt16LE(sides.length, 4);
  let offset = header.length;
  sides.forEach((side, index) => {
    if (side > ICO_MAX_SIDE) throw new Error(`ico images are at most ${ICO_MAX_SIDE} px, got ${side}`);
    const png = images.get(side);
    const entry = ICO_HEADER + ICO_ENTRY * index;
    header.writeUInt8(side === ICO_MAX_SIDE ? 0 : side, entry);
    header.writeUInt8(side === ICO_MAX_SIDE ? 0 : side, entry + 1);
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(ICO_BITS, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...sides.map((side) => images.get(side))]);
}

// The .iconset files iconutil reads: a name and the side of its PNG.
const ICONSET = [
  ['icon_16x16', 16], ['icon_16x16@2x', 32], ['icon_32x32', 32], ['icon_32x32@2x', 64],
  ['icon_128x128', 128], ['icon_128x128@2x', 256], ['icon_256x256', 256], ['icon_256x256@2x', 512],
  ['icon_512x512', 512], ['icon_512x512@2x', 1024],
];

/** The PNG sides an .icns needs. */
export const ICNS_SIDES = [...new Set(ICONSET.map(([, side]) => side))];

/** Builds an .icns with macOS's own iconutil, as apps/quotabar/build.sh does. `images` maps a side to its PNG. */
export async function icns(images) {
  const dir = await mkdtemp(join(tmpdir(), 'brand-icns-'));
  try {
    const iconset = join(dir, 'icon.iconset');
    await mkdir(iconset);
    for (const [name, side] of ICONSET) await writeFile(join(iconset, `${name}.png`), images.get(side));
    const out = join(dir, 'icon.icns');
    try {
      await run('iconutil', ['-c', 'icns', iconset, '-o', out]);
    } catch (err) {
      const reason = err.code === 'ENOENT' ? 'iconutil not found (it comes with macOS)' : (err.stderr || err.message).trim();
      throw new Error(`iconutil failed: ${reason}`);
    }
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
