#!/usr/bin/env node
// Writes every icon file of the toolbox from its mark (toolbox/mark.mjs): the web page's tab and
// home-screen icons, the desktop app's icons, and a master set of SVG and PNGs up to 2048 px.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSteps, shown, usageError } from './lib/cli.mjs';
import { writeAll } from './lib/files.mjs';
import { ICNS_SIDES, icns, ico } from './lib/icon-files.mjs';
import { svgToPng, withBrowser } from './lib/raster.mjs';
import { FRAME } from './lib/tile.mjs';
import { faviconSvg, iconSvg } from './toolbox/mark.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLBOX = join(HERE, '..', 'apps', 'toolbox');
const WEB = join(TOOLBOX, 'public');
const DESKTOP = join(TOOLBOX, 'desktop', 'icons');
const MASTER = join(HERE, 'out', 'toolbox');

const TOUCH_ICON_SIDE = 180; // iOS home screen
const DESKTOP_PNG_SIDE = 512; // Linux; what electron-builder is given
const ICO_SIDES = [16, 24, 32, 48, 64, 256];
const MASTER_SIDES = [16, 32, 64, 128, 256, 512, 1024, 2048];

const USAGE = `用法: node brand/export-toolbox-icon.mjs

由 brand/toolbox/mark.mjs 生成工具箱的全部图标文件:
  apps/toolbox/public/          favicon.svg（随系统浅色 / 深色切换）、apple-touch-icon.png（${TOUCH_ICON_SIDE} px）
  apps/toolbox/desktop/icons/   icon.png（${DESKTOP_PNG_SIDE} px）、icon.icns、icon.ico
  brand/out/toolbox/            母版: toolbox.svg 和 ${MASTER_SIDES.join('/')} px 的 PNG
内容没变的文件不重写。icon.icns 用 macOS 自带的 iconutil 打包，只能在 Mac 上运行。

  -h, --help    显示这段说明`;

async function pngs(page, svg, sides) {
  const images = new Map();
  for (const side of sides) images.set(side, await svgToPng(page, svg, side));
  return images;
}

function steps(page) {
  const appIcon = iconSvg(FRAME.app);
  return [
    {
      label: '网页图标',
      target: `${shown(WEB)}/`,
      run: async () => {
        const touch = await svgToPng(page, iconSvg(FRAME.bleed), TOUCH_ICON_SIDE);
        return writeAll([
          { path: join(WEB, 'favicon.svg'), bytes: Buffer.from(faviconSvg()) },
          { path: join(WEB, 'apple-touch-icon.png'), bytes: touch },
        ]);
      },
    },
    {
      label: '桌面 App 图标',
      target: `${shown(DESKTOP)}/`,
      run: async () => {
        const images = await pngs(page, appIcon, [...new Set([...ICO_SIDES, ...ICNS_SIDES, DESKTOP_PNG_SIDE])]);
        const pick = (sides) => new Map(sides.map((side) => [side, images.get(side)]));
        return writeAll([
          { path: join(DESKTOP, 'icon.png'), bytes: images.get(DESKTOP_PNG_SIDE) },
          { path: join(DESKTOP, 'icon.icns'), bytes: await icns(pick(ICNS_SIDES)) },
          { path: join(DESKTOP, 'icon.ico'), bytes: ico(pick(ICO_SIDES)) },
        ]);
      },
    },
    {
      label: '母版',
      target: `${shown(MASTER)}/`,
      run: async () => {
        const images = await pngs(page, appIcon, MASTER_SIDES);
        return writeAll([
          { path: join(MASTER, 'toolbox.svg'), bytes: Buffer.from(appIcon) },
          ...MASTER_SIDES.map((side) => ({ path: join(MASTER, `toolbox-${side}.png`), bytes: images.get(side) })),
        ]);
      },
    },
  ];
}

async function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (argv.length) return usageError(`unknown argument ${argv[0]}`, USAGE);
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    return runSteps(steps(page), { heading: '工具箱图标', rerun: 'node brand/export-toolbox-icon.mjs' });
  });
}

process.exitCode = await main(process.argv.slice(2));
