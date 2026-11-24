// Reads a Mermaid flowchart as a tree and writes it back with folded subtrees left out.
// No DOM here: the page script (content.js) and the tests both use it.
//
// A flowchart is a tree when it has one root, every node has at most one parent, every node can
// be reached from the root, and each line is one of: a node, one plain link "A --- B" (no text on
// the link), classDef, class, style, a %% comment or a blank. Anything else (labelled links,
// chains, &, subgraph, linkStyle, click, ...) means it is a process flow or something this does
// not understand, and parseTree returns null so the diagram is left as it is.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__biliKitFold = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ID = '[\\w\\u00C0-\\uFFFF]+';
  // A shape: opening brackets, a quoted or unquoted label, closing brackets. Quotes let labels
  // hold brackets.
  const SHAPE = '(?:[\\[\\(\\{>]+(?:"[^"]*"|[^"\\]\\)\\}]*)[\\]\\)\\}]+)';
  const NODE = `(${ID})${SHAPE}?(?::::[\\w-]+)?`;
  const LINK = '(?:-{3,}|-{2,}>|={3,}|={2,}>|-\\.+-|-\\.+->)';

  const HEADER_RE = /^\s*(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)\s*;?\s*$/;
  const NODE_RE = new RegExp(`^\\s*${NODE}\\s*;?\\s*$`);
  const EDGE_RE = new RegExp(`^\\s*${NODE}\\s*${LINK}\\s*${NODE}\\s*;?\\s*$`);
  const CLASS_RE = /^(\s*)class\s+(\S+)\s+([\w-]+)\s*(;?)\s*$/;
  const STYLE_RE = new RegExp(`^\\s*style\\s+(${ID})\\s`);
  const KEEP_RE = /^\s*(?:%%.*|classDef\s.*)?$/;

  function parseTree(code) {
    if (typeof code !== 'string') return null;
    const texts = code.split('\n');
    const headerAt = texts.findIndex((l) => l.trim() && !/^\s*%%/.test(l));
    if (headerAt < 0) return null;
    const header = HEADER_RE.exec(texts[headerAt]);
    if (!header) return null;

    const lines = [];
    const nodes = new Set();
    const parent = new Map();
    const children = new Map();
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      let m;
      if (i <= headerAt || KEEP_RE.test(text)) lines.push({ kind: 'keep', text });
      else if ((m = EDGE_RE.exec(text))) {
        const [, from, to] = m;
        if (from === to || parent.has(to)) return null;
        parent.set(to, from);
        if (!children.has(from)) children.set(from, []);
        children.get(from).push(to);
        nodes.add(from).add(to);
        lines.push({ kind: 'edge', text, child: to });
      } else if ((m = NODE_RE.exec(text))) {
        nodes.add(m[1]);
        lines.push({ kind: 'node', text, id: m[1] });
      } else if ((m = CLASS_RE.exec(text))) {
        lines.push({ kind: 'class', text, indent: m[1], ids: m[2].split(','), cls: m[3], semi: m[4] });
      } else if ((m = STYLE_RE.exec(text))) lines.push({ kind: 'style', text, id: m[1] });
      else return null;
    }
    if (parent.size === 0) return null;

    const roots = [...nodes].filter((n) => !parent.has(n));
    if (roots.length !== 1) return null;
    const tree = { source: code, direction: header[1], root: roots[0], parent, children, lines };
    // One parent each and one root still allows a cycle cut off from the root.
    if (descendantCount(tree, tree.root) + 1 !== nodes.size) return null;
    return tree;
  }

  function descendants(tree, id, into = new Set()) {
    for (const c of tree.children.get(id) || []) {
      if (into.has(c)) continue;
      into.add(c);
      descendants(tree, c, into);
    }
    return into;
  }

  function descendantCount(tree, id) {
    return descendants(tree, id).size;
  }

  // The root's children that have children: folding them shows the first level only.
  function firstLevel(tree) {
    return (tree.children.get(tree.root) || []).filter((c) => tree.children.has(c));
  }

  function prune(tree, collapsed) {
    const hidden = new Set();
    for (const id of collapsed) if (tree.children.has(id)) descendants(tree, id, hidden);
    if (hidden.size === 0) return tree.source;

    const out = [];
    for (const line of tree.lines) {
      switch (line.kind) {
        case 'edge':
          if (!hidden.has(line.child)) out.push(line.text);
          break;
        case 'node':
        case 'style':
          if (!hidden.has(line.id)) out.push(line.text);
          break;
        case 'class': {
          const ids = line.ids.filter((id) => !hidden.has(id));
          if (ids.length === line.ids.length) out.push(line.text);
          else if (ids.length) out.push(`${line.indent}class ${ids.join(',')} ${line.cls}${line.semi}`);
          break;
        }
        default:
          out.push(line.text);
      }
    }
    return out.join('\n');
  }

  return { parseTree, prune, descendantCount, firstLevel };
});
