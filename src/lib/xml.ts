// XML well-formedness check and formatting. Only whitespace between elements is changed: an
// element holding text (mixed content) or xml:space="preserve" keeps its inside exactly as written.
// The output is parsed again and compared before it is shown.

export type XmlCode = 'unclosed' | 'mismatch' | 'name' | 'attr' | 'dupAttr' | 'amp' | 'text' | 'multiRoot' | 'noRoot' | 'eof' | 'lt' | 'stray';
export class XmlError extends Error {
  constructor(readonly code: XmlCode, readonly pos: number, readonly arg = '') { super(code + ' at ' + pos); }
}
export class XmlVerifyError extends Error {}

type Node =
  | { k: 'el'; name: string; attrs: { name: string; raw: string }[]; self: boolean; kids: Node[]; inner: string; pos: number }
  | { k: 'text' | 'comment' | 'pi' | 'cdata' | 'doctype'; raw: string };

const NAME = /^[A-Za-z_:À-￿][\w.\-:·-￿]*/;

function parse(s: string): Node[] {
  const top: Node[] = [];
  const stack: { node: Extract<Node, { k: 'el' }>; innerStart: number }[] = [];
  const add = (n: Node) => (stack.length ? stack[stack.length - 1].node.kids : top).push(n);
  let i = 0;
  const until = (end: string, from: number) => {
    const j = s.indexOf(end, from);
    if (j < 0) throw new XmlError('eof', from);
    return j + end.length;
  };
  while (i < s.length) {
    if (s[i] !== '<') {
      const j = s.indexOf('<', i) < 0 ? s.length : s.indexOf('<', i);
      const raw = s.slice(i, j);
      for (const m of raw.matchAll(/&/g)) {
        if (!/^&(#\d+|#x[0-9a-fA-F]+|[A-Za-z_:][\w.\-:]*);/.test(raw.slice(m.index!))) throw new XmlError('amp', i + m.index!);
      }
      add({ k: 'text', raw });
      i = j;
      continue;
    }
    if (s.startsWith('<!--', i)) { const j = until('-->', i + 4); add({ k: 'comment', raw: s.slice(i, j) }); i = j; continue; }
    if (s.startsWith('<![CDATA[', i)) { const j = until(']]>', i + 9); add({ k: 'cdata', raw: s.slice(i, j) }); i = j; continue; }
    if (s.startsWith('<?', i)) { const j = until('?>', i + 2); add({ k: 'pi', raw: s.slice(i, j) }); i = j; continue; }
    if (s.startsWith('<!DOCTYPE', i)) {
      let j = i + 9, depth = 0, q = '';
      for (; j < s.length; j++) {
        const c = s[j];
        if (q) { if (c === q) q = ''; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= s.length) throw new XmlError('eof', i);
      add({ k: 'doctype', raw: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (s[i + 1] === '/') {
      const m = /^<\/([^\s>]+)\s*>/.exec(s.slice(i));
      if (!m) throw new XmlError('name', i + 2);
      const open = stack.pop();
      if (!open) throw new XmlError('stray', i, m[1]);
      if (open.node.name !== m[1]) throw new XmlError('mismatch', i, open.node.name);
      open.node.inner = s.slice(open.innerStart, i);
      i += m[0].length;
      continue;
    }
    // Start tag.
    const nm = NAME.exec(s.slice(i + 1));
    if (!nm) throw new XmlError('name', i + 1);
    const el: Extract<Node, { k: 'el' }> = { k: 'el', name: nm[0], attrs: [], self: false, kids: [], inner: '', pos: i };
    let j = i + 1 + nm[0].length;
    for (;;) {
      const ws = /^\s*/.exec(s.slice(j))![0].length;
      j += ws;
      if (j >= s.length) throw new XmlError('eof', i);
      if (s[j] === '>') { j++; break; }
      if (s.startsWith('/>', j)) { el.self = true; j += 2; break; }
      if (!ws) throw new XmlError('attr', j);
      const an = NAME.exec(s.slice(j));
      if (!an) throw new XmlError('attr', j);
      const m = /^\s*=\s*("[^"]*"|'[^']*')/.exec(s.slice(j + an[0].length));
      if (!m) throw new XmlError('attr', j + an[0].length);
      const val = m[1];
      const lt = val.indexOf('<');
      if (lt >= 0) throw new XmlError('lt', j + an[0].length + m[0].indexOf(val) + lt);
      if (el.attrs.some((a) => a.name === an[0])) throw new XmlError('dupAttr', j, an[0]);
      el.attrs.push({ name: an[0], raw: an[0] + '=' + val });
      j += an[0].length + m[0].length;
    }
    add(el);
    if (!el.self) stack.push({ node: el, innerStart: j });
    i = j;
  }
  if (stack.length) throw new XmlError('unclosed', stack[stack.length - 1].node.pos, stack[stack.length - 1].node.name);
  // Exactly one root; only whitespace, comments, PIs and a doctype around it.
  const roots = top.filter((n) => n.k === 'el');
  if (!roots.length) throw new XmlError('noRoot', 0);
  if (roots.length > 1) throw new XmlError('multiRoot', (roots[1] as { pos: number }).pos);
  let pos = 0;
  for (const n of top) {
    if ((n.k === 'text' && n.raw.trim()) || n.k === 'cdata') throw new XmlError('text', pos + (n.k === 'text' ? n.raw.search(/\S/) : 0));
    pos += n.k === 'el' ? 0 : n.raw.length;
  }
  return top;
}

const preserve = (el: Extract<Node, { k: 'el' }>) => el.attrs.some((a) => /^xml:space=["']preserve["']$/.test(a.raw));
/** Children are only elements, comments and PIs (whitespace between them carries no data). */
const elementOnly = (el: Extract<Node, { k: 'el' }>) =>
  !preserve(el) && el.kids.every((k) => k.k === 'el' || k.k === 'comment' || k.k === 'pi' || (k.k === 'text' && !k.raw.trim()));

function print(nodes: Node[], ind: string): string {
  const out: string[] = [];
  const tag = (el: Extract<Node, { k: 'el' }>) => '<' + el.name + el.attrs.map((a) => ' ' + a.raw).join('');
  const node = (n: Node, d: string) => {
    if (n.k === 'text') { if (n.raw.trim()) out.push(d + n.raw.trim()); return; }
    if (n.k !== 'el') { out.push(d + n.raw); return; }
    if (n.self) out.push(d + tag(n) + '/>');
    else if (!n.kids.length) out.push(d + tag(n) + '></' + n.name + '>');
    else if (elementOnly(n)) {
      out.push(d + tag(n) + '>');
      n.kids.forEach((k) => node(k, d + ind));
      out.push(d + '</' + n.name + '>');
    } else out.push(d + tag(n) + '>' + n.inner + '</' + n.name + '>');
  };
  nodes.forEach((n) => node(n, ''));
  return out.join('\n') + '\n';
}

/** What must survive formatting: everything except whitespace in element-only content. */
function canon(nodes: Node[], top = true): string {
  return nodes.map((n) => {
    if (n.k === 'text') return top || !n.raw.trim() ? '' : 'T' + n.raw;
    if (n.k !== 'el') return n.k[0] + n.raw;
    const head = '<' + n.name + n.attrs.map((a) => ' ' + a.raw).join('') + (n.self ? '/' : '') + '>';
    if (n.self) return head;
    return head + (elementOnly(n) ? canon(n.kids, false) : 'I' + n.inner) + '</>';
  }).filter(Boolean).join('\u0000');
}

export function formatXml(src: string, indent: string): string {
  const s = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  const text = print(parse(s), indent);
  checkXml(s, text);
  return text;
}

/** Throws unless `out` has the same content as `src`, apart from whitespace between elements. */
export function checkXml(src: string, out: string) {
  let again: Node[];
  try { again = parse(out); } catch { throw new XmlVerifyError(); }
  if (canon(parse(src)) !== canon(again)) throw new XmlVerifyError();
}

export function looksXml(s: string): boolean {
  const t = s.trim();
  if (!/^<[?!A-Za-z_]/.test(t) || !t.endsWith('>')) return false;
  try { parse(t); return true; } catch { return false; }
}
