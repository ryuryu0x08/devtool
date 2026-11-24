// Runs in the page (world MAIN): the editor's <mermaid-viewer> elements keep their Mermaid text in
// a JS property, `code`, which the extension's isolated world cannot see.
//
// The page has already drawn each diagram. For a tree diagram this script keeps that drawing and
// lays it out again itself (layout.js) on every fold: folded subtrees are hidden, the shown nodes
// are moved, the links redrawn and the drawing resized. Mermaid is not run again: running it
// blocks the page for 45-400 ms per diagram and inserting a new SVG costs another ~100 ms here;
// moving the existing nodes costs ~10 ms. The viewer's `code` and the document are never touched.
// When the viewer draws a new SVG (its text was edited), the text is read again and the folds that
// still apply are kept.
(function () {
  if (window.__biliKitMermaidStarted) return;
  window.__biliKitMermaidStarted = true;
  const { parseTree, descendantCount, firstLevel } = window.__biliKitFold;
  const { layoutTree, linkPath } = window.__biliKitLayout;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RADIUS = 9;
  const PADDING = 8;
  const GAP = { level: 56, sibling: 12 };
  const OURS = 'data-bk-tree';
  const states = new WeakMap();

  const style = document.createElement('style');
  style.textContent = `
    .bk-toggle { cursor: pointer; }
    .bk-toggle circle { fill: #fff; stroke: #6554C0; stroke-width: 1.5; }
    .bk-toggle:hover circle { fill: #EAE6FF; }
    .bk-toggle text { fill: #6554C0; font: 600 12px system-ui, -apple-system, sans-serif;
      text-anchor: middle; dominant-baseline: central; user-select: none; pointer-events: none; }
    [${OURS}] .bk-hidden { display: none; }
    .bk-toolbar { position: absolute; top: 6px; left: 6px; z-index: 2; display: flex; gap: 4px;
      opacity: .55; transition: opacity .15s; }
    .bk-host:hover > .bk-toolbar { opacity: 1; }
    .bk-toolbar button { font: 12px system-ui, -apple-system, sans-serif; color: #42526E;
      background: #fff; border: 1px solid #C1C7D0; border-radius: 4px; padding: 2px 8px;
      cursor: pointer; }
    .bk-toolbar button:hover { background: #F4F5F7; }
    .bk-toolbar button[aria-pressed="true"] { border-color: #6554C0; color: #6554C0; }
  `;
  document.head.appendChild(style);

  // The editor selects or opens a diagram on mousedown / double click: our controls keep those.
  function swallow(el) {
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'dblclick']) {
      el.addEventListener(type, (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
    }
  }

  // Reads the page's drawing: the group of each node (data-id is the Mermaid id), its size, and
  // the path of each link (classes LS-<from> LE-<to>). Null when it does not match the tree.
  function readDrawing(svg, tree) {
    const nodes = new Map();
    for (const g of svg.querySelectorAll('g.node[data-id]')) {
      const box = g.getBBox();
      nodes.set(g.getAttribute('data-id'), {
        g,
        width: box.width,
        height: box.height,
        dx: box.x + box.width / 2,
        dy: box.y + box.height / 2,
      });
    }
    const links = new Map();
    for (const path of svg.querySelectorAll('path.flowchart-link')) {
      let to = null;
      for (const c of path.classList) if (c.startsWith('LE-')) to = c.slice(3);
      if (to) links.set(to, path);
    }
    if (!nodes.has(tree.root)) return null;
    for (const id of tree.parent.keys()) if (!nodes.has(id) || !links.has(id)) return null;
    return { nodes, links, labels: svg.querySelector('g.edgeLabels') };
  }

  function toggleOffset(node, direction) {
    switch (direction) {
      case 'RL': return [node.dx - node.width / 2, node.dy];
      case 'BT': return [node.dx, node.dy - node.height / 2];
      case 'TB':
      case 'TD': return [node.dx, node.dy + node.height / 2];
      default: return [node.dx + node.width / 2, node.dy];
    }
  }

  function makeToggle(state, id) {
    const node = state.drawing.nodes.get(id);
    const button = document.createElementNS(SVG_NS, 'g');
    button.setAttribute('class', 'bk-toggle');
    const [x, y] = toggleOffset(node, state.tree.direction);
    button.setAttribute('transform', `translate(${x},${y})`);
    const title = document.createElementNS(SVG_NS, 'title');
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('r', String(RADIUS));
    const text = document.createElementNS(SVG_NS, 'text');
    button.append(title, circle, text);
    swallow(button);
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggle(state, id);
    });
    node.g.appendChild(button);
    return { title, circle, text };
  }

  // Applies the current fold state to the drawing: attribute writes only.
  function draw(state) {
    const { tree, drawing, svg, collapsed } = state;
    const layout = layoutTree(tree, collapsed, (id) => drawing.nodes.get(id), GAP);
    const at = (id) => {
      const p = layout.nodes.get(id);
      return p && { ...p, x: p.x + PADDING, y: p.y + PADDING };
    };
    for (const [id, node] of drawing.nodes) {
      const p = at(id);
      node.g.classList.toggle('bk-hidden', !p);
      if (p) node.g.setAttribute('transform', `translate(${p.x - node.dx},${p.y - node.dy})`);
    }
    for (const [to, path] of drawing.links) {
      const p = at(to);
      path.classList.toggle('bk-hidden', !p);
      if (p) path.setAttribute('d', linkPath(at(tree.parent.get(to)), p, tree.direction));
    }
    for (const [id, t] of state.toggles) {
      const folded = collapsed.has(id);
      const count = descendantCount(tree, id);
      t.title.textContent = folded ? `展开 ${count} 个节点` : '收起';
      t.text.textContent = folded ? String(count) : '−';
      t.circle.setAttribute('r', String(folded && count > 99 ? RADIUS + 3 : RADIUS));
    }
    const width = layout.width + PADDING * 2;
    const height = layout.height + PADDING * 2;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.maxWidth = `${width}px`;
    updateToolbar(state);
  }

  function setCollapsed(state, collapsed) {
    state.collapsed = collapsed;
    draw(state);
  }

  function toggle(state, id) {
    const next = new Set(state.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(state, next);
  }

  function sameSet(a, b) {
    return a.size === b.size && [...a].every((x) => b.has(x));
  }

  function updateToolbar(state) {
    if (!state.bar) return;
    const [fold, expand] = state.bar.children;
    fold.setAttribute('aria-pressed', String(sameSet(state.collapsed, new Set(firstLevel(state.tree)))));
    expand.setAttribute('aria-pressed', String(state.collapsed.size === 0));
  }

  // The toolbar outlives redraws of the viewer: its buttons look up the viewer's current state.
  function ensureToolbar(viewer) {
    const host = viewer.parentElement;
    if (!host) return null;
    let bar = host.querySelector(':scope > .bk-toolbar');
    if (bar) return bar;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.classList.add('bk-host');
    bar = document.createElement('div');
    bar.className = 'bk-toolbar';
    bar.contentEditable = 'false';
    const actions = [
      ['收起', '只显示第一层', (s) => new Set(firstLevel(s.tree))],
      ['展开', '展开所有节点', () => new Set()],
    ];
    for (const [label, hint, next] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = hint;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const s = states.get(viewer);
        if (s) setCollapsed(s, next(s));
      });
      bar.appendChild(b);
    }
    swallow(bar);
    host.insertBefore(bar, viewer);
    return bar;
  }

  function handle(viewer) {
    const svg = viewer.querySelector('.eva3-mermaid-container > svg');
    if (!svg || svg.hasAttribute(OURS)) return;
    // The viewer drew this SVG: first sight, or its text changed.
    const old = states.get(viewer);
    const code = viewer.code;
    const tree = typeof code === 'string' ? parseTree(code) : null;
    const drawing = tree ? readDrawing(svg, tree) : null;
    if (!drawing) {
      viewer.parentElement?.querySelector(':scope > .bk-toolbar')?.remove();
      states.delete(viewer);
      return;
    }
    const collapsed = old
      ? new Set([...old.collapsed].filter((id) => tree.children.has(id)))
      : new Set(firstLevel(tree));
    const state = { viewer, svg, tree, drawing, collapsed, toggles: new Map(), bar: ensureToolbar(viewer) };
    states.set(viewer, state);
    svg.setAttribute(OURS, '1');
    svg.style.overflow = 'visible';
    drawing.labels?.classList.add('bk-hidden');
    for (const id of tree.children.keys()) if (id !== tree.root) state.toggles.set(id, makeToggle(state, id));
    draw(state);
  }

  function scan() {
    for (const viewer of document.querySelectorAll('mermaid-viewer')) handle(viewer);
  }

  // 快捷键 Alt+Shift+M：night-page.js（隔离世界）收到后发出页面事件，这里折叠鼠标所在的图。
  window.addEventListener('bili-kit:fold-hovered', () => {
    const viewer = document.querySelector('mermaid-viewer:hover');
    const state = viewer && states.get(viewer);
    if (!state) return;
    setCollapsed(state, state.collapsed.size ? new Set() : new Set(firstLevel(state.tree)));
  });

  // setTimeout, not requestAnimationFrame: animation frames stop in a background tab, and a
  // document opened there should be folded by the time it is looked at.
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      scan();
    }, 30);
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
