// Lays out the shown part of a tree, like a mind map: each level is a column (left to right) or a
// row (top down), leaves are stacked one after another, and a parent sits in the middle of its
// children. Folded nodes are placed like leaves. No DOM here: the sizes come from a function.
//
// Positions are node centres in the drawing's own coordinates, starting at 0,0.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__biliKitLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function layoutTree(tree, collapsed, sizeOf, gap) {
    const horizontal = tree.direction === 'LR' || tree.direction === 'RL';
    // Along the levels ("depth") and across them ("breadth").
    const depthSize = (s) => (horizontal ? s.width : s.height);
    const breadthSize = (s) => (horizontal ? s.height : s.width);

    const shownChildren = (id) => (collapsed.has(id) ? [] : tree.children.get(id) || []);

    // Depth of each level: the largest node of that level.
    const levelSize = [];
    const levelOf = new Map();
    const sizes = new Map();
    (function walk(id, level) {
      const s = sizeOf(id);
      sizes.set(id, s);
      levelOf.set(id, level);
      levelSize[level] = Math.max(levelSize[level] || 0, depthSize(s));
      for (const c of shownChildren(id)) walk(c, level + 1);
    })(tree.root, 0);

    const levelStart = [];
    let depthTotal = 0;
    levelSize.forEach((size, i) => {
      if (i) depthTotal += gap.level;
      levelStart[i] = depthTotal;
      depthTotal += size;
    });

    // Across: leaves take the next free place; a parent is centred on its first and last child.
    const across = new Map();
    let next = 0;
    let breadthTotal = 0;
    (function place(id) {
      const kids = shownChildren(id);
      const b = breadthSize(sizes.get(id));
      if (!kids.length) {
        if (next) next += gap.sibling;
        across.set(id, next + b / 2);
        next += b;
      } else {
        for (const c of kids) place(c);
        across.set(id, (across.get(kids[0]) + across.get(kids[kids.length - 1])) / 2);
      }
      breadthTotal = Math.max(breadthTotal, across.get(id) + b / 2);
    })(tree.root);
    // A parent wider than its children can stick out before the first leaf.
    let shift = 0;
    for (const [id, a] of across) shift = Math.max(shift, breadthSize(sizes.get(id)) / 2 - a);
    breadthTotal += shift;

    const flip = tree.direction === 'RL' || tree.direction === 'BT';
    const nodes = new Map();
    for (const [id, a] of across) {
      const level = levelOf.get(id);
      let d = levelStart[level] + levelSize[level] / 2;
      if (flip) d = depthTotal - d;
      const s = sizes.get(id);
      const point = horizontal ? { x: d, y: a + shift } : { x: a + shift, y: d };
      nodes.set(id, { ...point, width: s.width, height: s.height });
    }

    const links = [];
    for (const id of nodes.keys()) for (const c of shownChildren(id)) links.push({ from: id, to: c });

    return {
      nodes,
      links,
      width: horizontal ? depthTotal : breadthTotal,
      height: horizontal ? breadthTotal : depthTotal,
    };
  }

  const round = (n) => Math.round(n * 10) / 10;

  // A smooth link from the parent's side facing the child to the child's side facing the parent.
  function linkPath(from, to, direction) {
    let x1, y1, x2, y2;
    const horizontal = direction === 'LR' || direction === 'RL';
    if (horizontal) {
      const sign = direction === 'RL' ? -1 : 1;
      x1 = from.x + (sign * from.width) / 2;
      x2 = to.x - (sign * to.width) / 2;
      y1 = from.y;
      y2 = to.y;
      const m = (x1 + x2) / 2;
      return `M${round(x1)},${round(y1)} C${round(m)},${round(y1)} ${round(m)},${round(y2)} ${round(x2)},${round(y2)}`;
    }
    const sign = direction === 'BT' ? -1 : 1;
    x1 = from.x;
    x2 = to.x;
    y1 = from.y + (sign * from.height) / 2;
    y2 = to.y - (sign * to.height) / 2;
    const m = (y1 + y2) / 2;
    return `M${round(x1)},${round(y1)} C${round(x1)},${round(m)} ${round(x2)},${round(m)} ${round(x2)},${round(y2)}`;
  }

  return { layoutTree, linkPath };
});
