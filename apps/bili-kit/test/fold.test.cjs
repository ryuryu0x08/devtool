// The tree reading and the pruning: which diagrams fold, and what text a fold leaves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTree, prune, descendantCount, firstLevel } = require('../src/fold.js');

// A domain map: one root, every node one parent, plain links. The shape the plugin folds.
const DOMAIN = [
  'flowchart LR',
  '    D["Shop"]',
  '    D --- N0["Order"]',
  '    N0 --- C0["Id"]',
  '    N0 --- C1["Owner"]',
  '    D --- N1["Item"]',
  '    N1 --- P0["Name"]',
  '    P0 --- P00["Short name"]',
  '    D --- N2["Log"]',
  '    classDef domain fill:#EAE6FF,stroke:#6554C0;',
  '    class D domain;',
  '    class N0,C0,P0,P00 cap;',
  '    style C1 fill:#fff',
].join('\n');

test('a domain map is read as a tree', () => {
  const t = parseTree(DOMAIN);
  assert.ok(t);
  assert.equal(t.direction, 'LR');
  assert.equal(t.root, 'D');
  assert.deepEqual(t.children.get('D'), ['N0', 'N1', 'N2']);
  assert.deepEqual(t.children.get('N1'), ['P0']);
  assert.equal(t.children.has('N2'), false);
});

test('nothing folded gives back the text unchanged', () => {
  const t = parseTree(DOMAIN);
  assert.equal(prune(t, []), DOMAIN);
});

test('folding a node drops its whole subtree and the references to it', () => {
  const t = parseTree(DOMAIN);
  const out = prune(t, ['N1']).split('\n');
  assert.ok(out.includes('    D --- N1["Item"]'));
  assert.ok(!out.some((l) => l.includes('P0')), 'children and grandchildren are gone');
  assert.ok(out.includes('    class N0,C0 cap;'), 'class lists keep only the shown nodes');
  assert.ok(out.includes('    style C1 fill:#fff'));
});

test('a class line naming only hidden nodes is dropped, a style line of a hidden node too', () => {
  const t = parseTree(DOMAIN);
  const out = prune(t, ['N0', 'N1']);
  assert.ok(out.includes('    class N0 cap;'), 'the folded node itself is still shown');
  assert.doesNotMatch(out, /\bC0\b/);
  assert.deepEqual(prune(t, ['D']).split('\n').filter((l) => /^\s*class /.test(l)), ['    class D domain;']);
  assert.ok(!out.includes('style C1'));
  assert.ok(out.includes('class D domain;'));
});

test('folding the root leaves the root alone', () => {
  const t = parseTree(DOMAIN);
  const out = prune(t, ['D']).split('\n').filter((l) => /---|\["/.test(l));
  assert.deepEqual(out, ['    D["Shop"]']);
});

test('folding a leaf or an unknown id changes nothing', () => {
  const t = parseTree(DOMAIN);
  assert.equal(prune(t, ['N2', 'nope']), DOMAIN);
});

test('descendant counts and the first level', () => {
  const t = parseTree(DOMAIN);
  assert.equal(descendantCount(t, 'N1'), 2);
  assert.equal(descendantCount(t, 'D'), 7);
  assert.equal(descendantCount(t, 'N2'), 0);
  assert.deepEqual(firstLevel(t), ['N0', 'N1']);
});

test('arrows, graph header, ::: classes and semicolons are accepted', () => {
  const t = parseTree('graph TD;\n  A((root)):::x --> B{"b"};\n  A --> C>c]\n  B ==> E(["e"])');
  assert.ok(t);
  assert.equal(t.direction, 'TD');
  assert.deepEqual(t.children.get('A'), ['B', 'C']);
  assert.deepEqual(t.children.get('B'), ['E']);
});

test('a label holding brackets inside quotes is one node', () => {
  const t = parseTree('flowchart LR\n  A["a [x] (y)"] --- B["b]"]');
  assert.ok(t);
  assert.deepEqual(t.children.get('A'), ['B']);
});

const NOT_TREES = {
  'a process flow with labelled links': 'flowchart TD\n  A -->|yes| B\n  A -->|no| C',
  'a link with text in the middle': 'flowchart TD\n  A -- yes --> B',
  'two parents': 'flowchart TD\n  A --> B\n  A --> C\n  B --> D\n  C --> D',
  'two roots': 'flowchart TD\n  A --> B\n  C --> D',
  'a cycle': 'flowchart TD\n  R --> A\n  A --> B\n  B --> A',
  'a chain on one line': 'flowchart TD\n  A --> B --> C',
  'an & group': 'flowchart TD\n  A --> B & C',
  'a subgraph': 'flowchart TD\n  subgraph S\n  A --> B\n  end',
  'linkStyle (edge indexes would shift)': 'flowchart TD\n  A --> B\n  linkStyle 0 stroke:red',
  'a click handler': 'flowchart TD\n  A --> B\n  click A cb',
  'no links at all': 'flowchart TD\n  A["a"]',
  'another diagram type': 'sequenceDiagram\n  A->>B: hi',
  'an empty text': '',
};
for (const [name, code] of Object.entries(NOT_TREES)) {
  test(`not folded: ${name}`, () => assert.equal(parseTree(code), null));
}

test('%% comments and blank lines are kept', () => {
  const code = 'flowchart LR\n%% note\n\n  A --- B\n  B --- C';
  const t = parseTree(code);
  assert.ok(t);
  assert.equal(prune(t, ['B']), 'flowchart LR\n%% note\n\n  A --- B');
});
