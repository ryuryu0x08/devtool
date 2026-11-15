#!/usr/bin/env node
// Writes the candidate icons of the navigation page's apps (nav/glyphs/) as SVG, a review sheet per
// app and an overview of them all, for choosing one per app; and the chosen one of each app (the
// `chosen` in nav/apps.mjs), named by the app, for the navigation page's config/icons/.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSteps, shown, usageError } from './lib/cli.mjs';
import { writeAll } from './lib/files.mjs';
import { htmlToPng, withBrowser } from './lib/raster.mjs';
import { APPS, candidateCode, chosenIndex } from './nav/apps.mjs';
import { navIconSvg } from './nav/draw.mjs';
import { appSheetHtml, overviewHtml } from './nav/sheet.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(HERE, 'out', 'nav');
const SHEET = { width: 1080, scale: 2 };
const OVERVIEW = { width: 760, scale: 2 };
const IDS = APPS.map((app) => app.id);

const USAGE = `用法: node brand/export-nav-icons.mjs [--app <名字>]... [--out <目录>] [--icons <目录>]

导出导航页各应用的候选图标，供挑选：
  <输出目录>/<应用>/<编号>.svg   每个候选一个 SVG，编号是 A、B、C
  <输出目录>/<应用>/review.png   这个应用的 review 图
  <输出目录>/overview.png        全部应用的总览（导出不止一个应用时）
  <图标目录>/<应用>.svg           每个应用选定的那一个（nav/apps.mjs 的 chosen），没选的不写

  --app <名字>     只导出这个应用，可重复（可选，默认全部: ${IDS.join(', ')}）
  --out <目录>     输出目录（可选，默认 brand/out/nav）
  --icons <目录>   选定图标的目录（可选，默认 <输出目录>/chosen），如导航页的 deploy/homelab-nav/config/icons
  -h, --help       显示这段说明

示例: node brand/export-nav-icons.mjs --app gitea --app grafana`;

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, icons: null, apps: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { help: true };
    if (!['--out', '--app', '--icons'].includes(arg)) throw new Error(`unknown argument ${arg}`);
    const value = argv[i + 1];
    if (!value) throw new Error(`${arg} needs a value`);
    if (arg === '--out') options.out = value;
    if (arg === '--app') options.apps.push(value);
    if (arg === '--icons') options.icons = value;
    i += 1;
  }
  const unknown = options.apps.filter((id) => !IDS.includes(id));
  if (unknown.length) throw new Error(`unknown app ${unknown.join(', ')} (known: ${IDS.join(', ')})`);
  const wanted = options.apps.length ? options.apps : IDS;
  const icons = options.icons ?? join(options.out, 'chosen');
  return { out: options.out, icons, apps: APPS.filter((app) => wanted.includes(app.id)) };
}

const candidateSvg = (app, glyphIndex) => navIconSvg(app, app.glyphs[glyphIndex]);

function appStep(browser, app, out) {
  const dir = join(out, app.id);
  return {
    label: `${app.id}（${app.name}）`,
    target: `${shown(dir)}/`,
    run: async () => {
      const files = app.glyphs.map((_, glyphIndex) => ({
        path: join(dir, `${candidateCode(glyphIndex)}.svg`),
        bytes: Buffer.from(candidateSvg(app, glyphIndex)),
      }));
      const sheet = await htmlToPng(browser, appSheetHtml(app, (glyphIndex) => candidateSvg(app, glyphIndex)), SHEET);
      return writeAll([...files, { path: join(dir, 'review.png'), bytes: sheet }]);
    },
  };
}

function chosenStep(apps, dir) {
  const chosen = apps.filter((app) => chosenIndex(app) >= 0);
  return {
    label: `选定的图标（${chosen.length} 个）`,
    target: `${shown(dir)}/`,
    run: async () => writeAll(chosen.map((app) => ({
      path: join(dir, `${app.id}.svg`),
      bytes: Buffer.from(candidateSvg(app, chosenIndex(app))),
    }))),
  };
}

function overviewStep(browser, apps, out) {
  const path = join(out, 'overview.png');
  return {
    label: '总览',
    target: shown(path),
    run: async () => writeAll([{ path, bytes: await htmlToPng(browser, overviewHtml(apps, candidateSvg), OVERVIEW) }]),
  };
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    return usageError(err.message, USAGE);
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  return withBrowser(async (browser) => {
    const steps = options.apps.map((app) => appStep(browser, app, options.out));
    if (options.apps.length > 1) steps.push(overviewStep(browser, options.apps, options.out));
    steps.push(chosenStep(options.apps, options.icons));
    return runSteps(steps, {
      heading: `导航页图标候选，输出目录 ${shown(options.out)}`,
      rerun: `node brand/export-nav-icons.mjs ${argv.join(' ')}`.trim(),
    });
  });
}

process.exitCode = await main(process.argv.slice(2));
