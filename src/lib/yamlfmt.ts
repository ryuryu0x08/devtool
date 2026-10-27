// YAML formatting that never changes data. The `yaml` library re-indents; numbers, booleans and
// nulls are written exactly as in the source (it would turn 0x1F into 0x1f and round
// 0.10000000000000000555 to 0.1). The result is parsed again and compared value by value,
// with every comment; anything that differs stops the output.
import { Parser, isAlias, isCollection, isMap, isScalar, parseAllDocuments, visit, type Document, type Scalar, type ScalarTag, type CollectionTag, type Tags } from 'yaml';
import { numKey } from './data';

export class YamlError extends Error {
  constructor(message: string, readonly pos: number) { super(message); }
}
export class YamlVerifyError extends Error {
  constructor(readonly what: string) { super('verify ' + what); }
}

/** Keep the source text of non-string scalars. */
const keepSource = (tags: Tags): Tags => tags.map((t) => {
  const tag = t as ScalarTag | CollectionTag;
  if (!('stringify' in tag) || !tag.stringify || /:(str|map|seq)$/.test(tag.tag)) return t;
  const orig = tag.stringify;
  return { ...tag, stringify: ((item: Scalar, ...rest: unknown[]) =>
    isScalar(item) && typeof item.source === 'string' && item.source !== '' ? item.source : (orig as (...a: unknown[]) => string)(item, ...rest)) } as ScalarTag;
});

const OPTS = { keepSourceTokens: true, intAsBigInt: true, uniqueKeys: true, customTags: keepSource, prettyErrors: false } as const;

function parse(src: string): Document.Parsed[] {
  const docs = parseAllDocuments(src, OPTS);
  const list = Array.isArray(docs) ? docs : [];
  for (const d of list) {
    const e = d.errors[0];
    if (e) throw new YamlError(e.message.split('\n')[0], e.pos[0]);
  }
  return list;
}

interface Item { kind: string; text: string; value?: unknown; path: string }

/** Every node in document order: what it is, how it is written, its value. */
function items(docs: Document.Parsed[]): Item[] {
  const out: Item[] = [];
  docs.forEach((d, di) => visit(d, {
    Scalar(_k, n, path) {
      const block = n.type === 'BLOCK_LITERAL' || n.type === 'BLOCK_FOLDED';
      out.push({ kind: 'S' + (n.tag ?? '') + (n.anchor ? '&' + n.anchor : '') + ':' + n.type, text: block ? String(n.value) : (n.srcToken && 'source' in n.srcToken ? String(n.srcToken.source) : String(n.source ?? n.value)), value: n.value, path: di + '/' + path.length });
    },
    Alias(_k, n) { out.push({ kind: 'A', text: n.source, path: String(di) }); },
    Map(_k, n) { out.push({ kind: 'M' + (n.tag ?? '') + (n.anchor ? '&' + n.anchor : '') + (n.flow ? 'f' : ''), text: '', path: String(di) }); },
    Seq(_k, n) { out.push({ kind: 'Q' + (n.tag ?? '') + (n.anchor ? '&' + n.anchor : '') + (n.flow ? 'f' : ''), text: '', path: String(di) }); },
  }));
  return out;
}

function comments(src: string): string[] {
  const out: string[] = [];
  const walk = (t: unknown) => {
    if (!t || typeof t !== 'object') return;
    const o = t as Record<string, unknown>;
    if (o.type === 'comment' && typeof o.source === 'string') out.push(o.source.trim());
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  for (const tok of new Parser().parse(src)) walk(tok);
  return out;
}

const same = (a: unknown, b: unknown) => {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  return a === b || (a == null && b == null);
};

export interface YamlOut { text: string; docs: number; changed: { from: string; to: string }[]; warnings: string[] }

export function formatYaml(src: string, indent: 2 | 4): YamlOut {
  const docs = parse(src);
  const warnings = docs.flatMap((d) => d.warnings.map((w) => w.message.split('\n')[0]));
  const text = docs.map((d) => d.toString({ indent, lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false })).join('');
  // Verify: the same nodes, values and comments.
  let again: Document.Parsed[];
  try { again = parse(text); } catch { throw new YamlVerifyError('parse'); }
  const a = items(docs), b = items(again);
  if (a.length !== b.length) throw new YamlVerifyError('structure');
  const changed: { from: string; to: string }[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind) throw new YamlVerifyError(a[i].text || a[i].kind);
    if (!same(a[i].value, b[i].value)) throw new YamlVerifyError(a[i].text);
    // Numbers: the exact decimal must match too (0.10000000000000000555 is not 0.1).
    if (typeof a[i].value === 'number' && /^[-+]?[\d.]/.test(a[i].text) && numKey(a[i].text) !== numKey(b[i].text)) throw new YamlVerifyError(a[i].text);
    if (a[i].text !== b[i].text) changed.push({ from: a[i].text, to: b[i].text });
  }
  const ca = comments(src), cb = comments(text);
  if (ca.length !== cb.length || ca.some((c, i) => c !== cb[i])) throw new YamlVerifyError('#');
  return { text, docs: docs.length, changed, warnings };
}

/** Several "key: value" / "- item" lines that parse as a mapping or sequence. */
export function looksYaml(s: string): boolean {
  const lines = s.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2 || !lines.some((l) => /^\s*(?:[\w"'.-][^:\n]*:(\s|$)|-\s)/.test(l))) return false;
  try {
    const docs = parse(s);
    return docs.length > 0 && docs.every((d) => isCollection(d.contents)) && docs.some((d) => isMap(d.contents) || !isAlias(d.contents));
  } catch {
    return false;
  }
}
