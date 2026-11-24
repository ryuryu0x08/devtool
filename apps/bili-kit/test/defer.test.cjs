// The render gate: the page's Mermaid calls wait until their diagram is near the screen, and run
// one at a time with the main thread given back in between.
const test = require('node:test');
const assert = require('node:assert/strict');
const { gateMermaid } = require('../src/defer.js');

function fakeMermaid(log) {
  return {
    async parse(text) {
      log.push(`parse ${text}`);
      return true;
    },
    async render(id, text) {
      log.push(`render ${text}`);
      return { svg: `<svg id="${id}">${text}</svg>` };
    },
  };
}

// Diagrams are named by their text; `show(text)` brings one near the screen.
function harness() {
  const waiting = new Map();
  const shown = new Set();
  const env = {
    whenNear(text) {
      if (shown.has(text)) return Promise.resolve();
      return new Promise((resolve) => waiting.set(text, resolve));
    },
    breather: () => Promise.resolve(),
  };
  return {
    env,
    show(text) {
      shown.add(text);
      waiting.get(text)?.();
      waiting.delete(text);
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

test('a diagram off screen is not rendered until it comes near', async () => {
  const log = [];
  const h = harness();
  const m = gateMermaid(fakeMermaid(log), h.env);
  const done = m.render('a', 'A');
  await settle();
  assert.deepEqual(log, []);
  h.show('A');
  assert.deepEqual(await done, { svg: '<svg id="a">A</svg>' });
  assert.deepEqual(log, ['render A']);
});

test('parse waits too, so a diagram costs nothing until it is near', async () => {
  const log = [];
  const h = harness();
  const m = gateMermaid(fakeMermaid(log), h.env);
  const p = m.parse('A');
  await settle();
  assert.deepEqual(log, []);
  h.show('A');
  assert.equal(await p, true);
  assert.deepEqual(log, ['parse A']);
});

test('renders run one after another, in the order their diagrams came near', async () => {
  const log = [];
  const h = harness();
  const inner = fakeMermaid(log);
  let running = 0;
  let most = 0;
  const render = inner.render;
  inner.render = async (...a) => {
    most = Math.max(most, ++running);
    await settle();
    running--;
    return render(...a);
  };
  const m = gateMermaid(inner, h.env);
  const all = [m.render('a', 'A'), m.render('b', 'B'), m.render('c', 'C')];
  h.show('C');
  h.show('A');
  h.show('B');
  await Promise.all(all);
  assert.equal(most, 1);
  assert.deepEqual(log, ['render C', 'render A', 'render B']);
});

test('the main thread is given back before each call', async () => {
  const log = [];
  const h = harness();
  h.env.breather = () => {
    log.push('breathe');
    return Promise.resolve();
  };
  const m = gateMermaid(fakeMermaid(log), h.env);
  h.show('A');
  h.show('B');
  await Promise.all([m.render('a', 'A'), m.render('b', 'B')]);
  assert.deepEqual(log, ['breathe', 'render A', 'breathe', 'render B']);
});

test('a failing render rejects its caller and does not stop the next', async () => {
  const log = [];
  const h = harness();
  const inner = fakeMermaid(log);
  const render = inner.render;
  inner.render = async (id, text) => {
    if (text === 'bad') throw new Error('syntax');
    return render(id, text);
  };
  const m = gateMermaid(inner, h.env);
  h.show('bad');
  h.show('A');
  await assert.rejects(m.render('x', 'bad'), /syntax/);
  assert.deepEqual(await m.render('a', 'A'), { svg: '<svg id="a">A</svg>' });
});

test('other members are left as they are, and gating twice is a no-op', () => {
  const inner = { ...fakeMermaid([]), initialize() {}, version: '10' };
  const h = harness();
  const m = gateMermaid(inner, h.env);
  assert.equal(m, inner);
  assert.equal(typeof m.initialize, 'function');
  assert.equal(m.version, '10');
  const render = m.render;
  gateMermaid(m, h.env);
  assert.equal(m.render, render);
});
