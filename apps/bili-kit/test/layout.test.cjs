// The tree layout: where each shown node goes, the size of the drawing, and the links.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTree } = require('../src/fold.js');
const { layoutTree, linkPath } = require('../src/layout.js');

const CODE = [
  'flowchart LR',
  '  R --- A',
  '  A --- A1',
  '  A --- A2',
  '  R --- B',
  '  B --- B1',
  '  R --- C',
].join('\n');
const SIZE = { R: [40, 30], A: [60, 30], A1: [50, 30], A2: [50, 30], B: [60, 30], B1: [80, 30], C: [40, 30] };
const size = (id) => ({ width: SIZE[id][0], height: SIZE[id][1] });
const GAP = { level: 50, sibling: 10 };

function boxes(l) {
  return Object.fromEntries([...l.nodes].map(([id, p]) => [id, p]));
}

test('everything shown: each level in its own column, children centred on their parent', () => {
  const t = parseTree(CODE);
  const l = layoutTree(t, new Set(), size, GAP);
  const b = boxes(l);
  assert.deepEqual(Object.keys(b).sort(), ['A', 'A1', 'A2', 'B', 'B1', 'C', 'R']);
  // Columns: widest node of each level, then the gap; a node is centred in its column.
  assert.equal(b.R.x, 20);
  assert.equal(b.A.x, 40 + 50 + 30);
  assert.equal(b.A1.x, 40 + 50 + 60 + 50 + 40);
  assert.equal(b.B1.x, 40 + 50 + 60 + 50 + 40);
  // Leaves are stacked with the sibling gap; a parent sits in the middle of its children.
  assert.equal(b.A1.y, 15);
  assert.equal(b.A2.y, 15 + 30 + 10);
  assert.equal(b.A.y, (b.A1.y + b.A2.y) / 2);
  assert.equal(b.B1.y, b.A2.y + 30 + 10);
  assert.equal(b.B.y, b.B1.y);
  assert.equal(b.C.y, b.B1.y + 30 + 10);
  assert.equal(b.R.y, (b.A.y + b.C.y) / 2);
  assert.equal(l.width, 40 + 50 + 60 + 50 + 80);
  assert.equal(l.height, 4 * 30 + 3 * 10);
});

test('a folded node is placed like a leaf and its subtree is not shown', () => {
  const t = parseTree(CODE);
  const b = boxes(layoutTree(t, new Set(['A']), size, GAP));
  assert.equal('A1' in b || 'A2' in b, false);
  assert.equal(b.A.y, 15);
  assert.equal(b.B.y, 15 + 30 + 10);
});

test('first level only: two columns and the drawing shrinks to them', () => {
  const t = parseTree(CODE);
  const l = layoutTree(t, new Set(['A', 'B']), size, GAP);
  assert.deepEqual([...l.nodes.keys()].sort(), ['A', 'B', 'C', 'R']);
  assert.equal(l.width, 40 + 50 + 60);
  assert.equal(l.height, 3 * 30 + 2 * 10);
});

test('links join a parent to each shown child', () => {
  const t = parseTree(CODE);
  const l = layoutTree(t, new Set(['A']), size, GAP);
  assert.deepEqual(l.links.map((k) => `${k.from}>${k.to}`).sort(), ['B>B1', 'R>A', 'R>B', 'R>C']);
});

test('top-down puts levels in rows and siblings side by side', () => {
  const t = parseTree(CODE.replace('LR', 'TD'));
  const b = boxes(layoutTree(t, new Set(), size, GAP));
  assert.equal(b.R.y, 15);
  assert.equal(b.A.y, 30 + 50 + 15);
  assert.equal(b.A1.x, 25);
  assert.equal(b.A2.x, 50 + 10 + 25);
  assert.equal(b.A.x, (b.A1.x + b.A2.x) / 2);
});

test('right-to-left and bottom-up mirror the drawing', () => {
  const t = parseTree(CODE.replace('LR', 'RL'));
  const l = layoutTree(t, new Set(), size, GAP);
  const b = boxes(l);
  assert.equal(b.R.x, l.width - 20);
  assert.ok(b.A1.x < b.A.x && b.A.x < b.R.x);
  const u = layoutTree(parseTree(CODE.replace('LR', 'BT')), new Set(), size, GAP);
  assert.equal(u.nodes.get('R').y, u.height - 15);
});

test('a link runs from the parent side facing the child to the child side facing the parent', () => {
  const d = linkPath({ x: 20, y: 50, width: 40, height: 30 }, { x: 120, y: 10, width: 60, height: 30 }, 'LR');
  assert.match(d, /^M40,50 C/);
  assert.match(d, /90,10$/);
  const v = linkPath({ x: 50, y: 15, width: 40, height: 30 }, { x: 20, y: 100, width: 40, height: 30 }, 'TD');
  assert.match(v, /^M50,30 C/);
  assert.match(v, /20,85$/);
});
