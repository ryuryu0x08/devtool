// The review sheets: one per app (each candidate large, and as a row of the navigation page in light
// and dark), and one overview of every app's candidates side by side.
import { candidateCode } from './apps.mjs';

// The page's own tile: 44 px with a 12 px corner (homelab internal/nav/page.html, .tile).
const ROW_TILE = 44;
const ROW_RADIUS = 12;
const LARGE = 168;
const OVERVIEW = 64;
const radiusFor = (side) => Math.round((side * ROW_RADIUS) / ROW_TILE);

// The page's colours, light and dark (page.html :root).
const PAGE = {
  light: { card: '#FFFFFF', ink: '#16181D', up: '#157F3B', dot: '#1F9D55' },
  dark: { card: '#1C1E23', ink: '#ECEDF0', up: '#4CC27A', dot: '#3FB06C' },
};

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const svgUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const img = (svg, side) => `<img src="${svgUrl(svg)}" width="${side}" height="${side}" style="border-radius:${radiusFor(side)}px;display:block">`;

/** The tile the page draws today: text on a flat colour. */
function currentTile(app, side) {
  const font = Math.round((side * 15) / ROW_TILE);
  return `<span class="now" style="width:${side}px;height:${side}px;border-radius:${radiusFor(side)}px;background:${app.current.color};font-size:${font}px">${escapeHtml(app.current.icon)}</span>`;
}

function navRow(app, tileHtml, scheme) {
  const c = PAGE[scheme];
  return `<div class="row" style="background:${c.card};color:${c.ink}">${tileHtml}
    <span class="text"><span class="name">${escapeHtml(app.name)}</span>
    <span class="status" style="color:${c.up}"><span class="dot" style="background:${c.dot}"></span>在线 · 3f9c2e1</span></span></div>`;
}

const BASE_STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 36px; background: #e9e8e4; color: #1b1b1d; font: 14px/1.5 -apple-system, 'PingFang SC', system-ui, sans-serif; }
  h1 { margin: 0; font-size: 24px; font-weight: 700; }
  .sub { margin: 4px 0 24px; color: #6b6a66; }
  .now { flex: none; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; }
  .row { display: flex; align-items: center; gap: 14px; min-height: 72px; padding: 12px 14px; }
  .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .name { font-size: 16px; font-weight: 600; white-space: nowrap; }
  .status { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; }
`;

const SHEET_STYLE = `${BASE_STYLE}
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .card { background: #fff; border-radius: 18px; padding: 18px; }
  .head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 2px; }
  .code { font-weight: 800; font-size: 20px; color: #1f5ed9; }
  .gname { font-weight: 600; font-size: 16px; }
  .note { margin: 0 0 14px; color: #6b6a66; font-size: 13px; min-height: 40px; }
  .large { display: flex; justify-content: center; margin-bottom: 14px; }
  .rows { border-radius: 14px; overflow: hidden; }
  .current { display: flex; align-items: center; gap: 20px; background: #fff; border-radius: 18px; padding: 16px 18px; margin-bottom: 20px; }
  .current .rows { flex: 1; display: grid; grid-template-columns: 1fr 1fr; }
`;

function candidateCard(app, glyph, glyphIndex, svg) {
  return `<section class="card">
    <div class="head"><span class="code">${candidateCode(glyphIndex)}</span><span class="gname">${escapeHtml(glyph.name)}</span></div>
    <p class="note">${escapeHtml(glyph.note)}</p>
    <div class="large">${img(svg, LARGE)}</div>
    <div class="rows">${navRow(app, img(svg, ROW_TILE), 'light')}${navRow(app, img(svg, ROW_TILE), 'dark')}</div>
  </section>`;
}

/** `svgs(glyphIndex)` returns the candidate's SVG. */
export function appSheetHtml(app, svgs) {
  const cards = app.glyphs.map((glyph, glyphIndex) => candidateCard(app, glyph, glyphIndex, svgs(glyphIndex)));
  return `<!doctype html><meta charset="utf-8"><style>${SHEET_STYLE}</style>
  <h1>${escapeHtml(app.name)}</h1>
  <p class="sub">每张卡片：编号、大图，以及它在导航页一行里的样子（浅色 / 深色）</p>
  <div class="current"><strong>现在</strong>${currentTile(app, ROW_TILE)}
    <div class="rows">${navRow(app, currentTile(app, ROW_TILE), 'light')}${navRow(app, currentTile(app, ROW_TILE), 'dark')}</div></div>
  <div class="grid">${cards.join('')}</div>`;
}

const OVERVIEW_STYLE = `${BASE_STYLE}
  table { border-collapse: separate; border-spacing: 0 10px; }
  td { padding: 0 12px; vertical-align: middle; }
  .label { font-weight: 600; white-space: nowrap; padding-right: 20px; }
  .col { text-align: center; font-weight: 700; color: #1f5ed9; }
  .gap { width: 24px; }
  .cell { text-align: center; }
  .cell small { display: block; margin-top: 4px; color: #8f8e89; font-size: 11px; white-space: nowrap; }
`;

/** Every app as a row: today's tile, then each candidate, so the set can be judged together. */
export function overviewHtml(apps, svgs) {
  const letters = apps[0].glyphs.map((_, glyphIndex) => candidateCode(glyphIndex));
  const header = `<tr><td></td><td class="col">现在</td><td class="gap"></td>${letters.map((code) => `<td class="col">${code}</td>`).join('')}</tr>`;
  const rows = apps.map((app) => {
    const cells = app.glyphs.map((glyph, glyphIndex) =>
      `<td class="cell">${img(svgs(app, glyphIndex), OVERVIEW)}<small>${escapeHtml(glyph.name)}</small></td>`);
    return `<tr><td class="label">${escapeHtml(app.name)}</td><td class="cell">${currentTile(app, OVERVIEW)}<small>&nbsp;</small></td><td class="gap"></td>${cells.join('')}</tr>`;
  });
  return `<!doctype html><meta charset="utf-8"><style>${OVERVIEW_STYLE}</style>
  <h1>导航页图标候选 · 总览</h1>
  <p class="sub">每行一个应用：现在的文字瓦片，和 A / B / C 三个候选（深色底，点缀用应用自己的颜色）</p>
  <table>${header}${rows.join('')}</table>`;
}
