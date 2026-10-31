// Syntax colouring of formatted text. Only splits the text into coloured pieces: the pieces put
// together are always exactly the text (checked by the tests), so what is shown and copied is
// unchanged. Unknown or broken input just gets fewer colours.

export type HlLang = 'json' | 'toml' | 'yaml' | 'xml' | 'sql';
export type Kind = 'key' | 'str' | 'num' | 'bool' | 'date' | 'kw' | 'fn' | 'com' | 'punc' | 'tag' | 'attr' | 'var' | 'null';
export type Tok = { t: string; k?: Kind };

/** Adds a piece, joining it to the previous one when they look the same (fewer elements). */
function push(out: Tok[], t: string, k?: Kind) {
  if (!t) return;
  const last = out[out.length - 1];
  if (last && last.k === k) last.t += t;
  else out.push(k ? { t, k } : { t });
}

/** Scans `s` with sticky rules tried in order; text no rule matches stays plain, one character at a time. */
type Rule = [RegExp, Kind | undefined | ((m: RegExpExecArray, s: string, end: number) => Kind | undefined)];

function scan(s: string, rules: Rule[], out: Tok[] = []): Tok[] {
  let i = 0;
  outer: while (i < s.length) {
    for (const [re, kind] of rules) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (m && m[0]) {
        push(out, m[0], typeof kind === 'function' ? kind(m, s, i + m[0].length) : kind);
        i += m[0].length;
        continue outer;
      }
    }
    push(out, s[i]);
    i++;
  }
  return out;
}

const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function json(s: string): Tok[] {
  return scan(s, [
    [/\s+/y, undefined],
    // A string followed by ":" is a key.
    [/"(?:[^"\\\n]|\\.)*"?/y, (_m, src, end) => (/^\s*:/.test(src.slice(end, end + 64)) ? 'key' : 'str')],
    [NUM, 'num'],
    [/(?:true|false)\b/y, 'bool'],
    [/null\b/y, 'null'],
    [/[{}[\],:]/y, 'punc'],
  ]);
}

const TOML_KEY = String.raw`(?:[A-Za-z0-9_-]+|"(?:[^"\\\n]|\\.)*"|'[^'\n]*')`;

function toml(s: string): Tok[] {
  return scan(s, [
    [/[ \t]+|\r?\n/y, undefined],
    [/#[^\n]*/y, 'com'],
    // A table header on its own line.
    [new RegExp(String.raw`(?<=(?:^|\n)[ \t]*)\[\[?[ \t]*${TOML_KEY}(?:[ \t]*\.[ \t]*${TOML_KEY})*[ \t]*\]\]?(?=[ \t]*(?:#|\r?\n|$))`, 'y'), 'tag'],
    // A key (dotted parts included) before "=".
    [new RegExp(String.raw`${TOML_KEY}(?:[ \t]*\.[ \t]*${TOML_KEY})*(?=[ \t]*=)`, 'y'), 'key'],
    [/"""[\s\S]*?(?:"""(?!")|$)|'''[\s\S]*?(?:'''(?!')|$)/y, 'str'],
    [/"(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?/y, 'str'],
    [/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?/iy, 'date'],
    [/[+-]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|inf\b|nan\b|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/y, 'num'],
    [/(?:true|false)\b/y, 'bool'],
    [/[[\]{},=.]/y, 'punc'],
  ]);
}

/** A plain YAML value: a number, true/false/null, or else a string. */
function yamlScalar(v: string): Kind {
  if (/^(?:null|Null|NULL|~)$/.test(v)) return 'null';
  if (/^(?:true|True|TRUE|false|False|FALSE)$/.test(v)) return 'bool';
  if (/^[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|\.inf|\.Inf|\.INF|\.nan|\.NaN|\.NAN)$/.test(v)) return 'num';
  if (/^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:[ \t]*(?:Z|[-+]\d{1,2}(?::\d{2})?))?)?$/.test(v)) return 'date';
  return 'str';
}

/** The value part of a YAML line. In flow style ("[a, b]", "{a: 1}") ",[]{}" separate values; in
 *  block style a plain value runs to a comment (" #") or the end of the line. */
const yamlValue = (flow: boolean): Rule[] => [
  [/[ \t]+/y, undefined],
  [/#[^\n]*/y, 'com'],
  [/[&*][^\s,[\]{}]+/y, 'var'],
  [/!(?:<[^>\n]*>|[^\s,[\]{}]*)/y, 'var'],
  [/"(?:[^"\\]|\\.)*"?|'(?:[^']|'')*'?/y, 'str'],
  [/[|>][-+0-9]*(?=[ \t]*(?:#|$))/y, 'punc'],
  ...(flow ? [
    [/[[\]{},]/y, 'punc'] as Rule,
    [/(?:[^\s#,[\]{}:]|:(?![ \t]|$)|[ \t]+(?=[^\s#,[\]{}])|#)+?(?=[ \t]+#|[ \t]*$|[ \t]*[,[\]{}]|:(?:[ \t]|$))/y, (m: RegExpExecArray) => yamlScalar(m[0])],
    [/:(?=[ \t]|$)/y, 'punc'],
  ] satisfies Rule[] : [
    [/\S(?:[^\n]*?\S)??(?=[ \t]+#|[ \t]*$)/y, (m: RegExpExecArray) => yamlScalar(m[0])],
  ] satisfies Rule[]),
];
const YAML_FLOW = yamlValue(true), YAML_BLOCK = yamlValue(false);

function yaml(s: string): Tok[] {
  const out: Tok[] = [];
  const lines = s.split(/(?<=\n)/);
  /** Inside a block scalar (after "|" or ">"): lines indented deeper than this are its text. */
  let block = -1;
  for (const raw of lines) {
    const nl = raw.endsWith('\n') ? (raw.endsWith('\r\n') ? '\r\n' : '\n') : '';
    const line = raw.slice(0, raw.length - nl.length);
    const ind = line.length - line.trimStart().length;
    if (block >= 0) {
      if (!line.trim() || ind > block) { push(out, line, line.trim() ? 'str' : undefined); push(out, nl); continue; }
      block = -1;
    }
    let i = 0;
    push(out, line.slice(0, ind));
    i = ind;
    const doc = /^(?:---|\.\.\.)(?=\s|$)/.exec(line.slice(i));
    if (doc) { push(out, doc[0], 'punc'); i += doc[0].length; }
    // Sequence entries ("- "), then a key ("name:").
    for (let m; (m = /^-(?:[ \t]+|$)/.exec(line.slice(i))); i += m[0].length) push(out, m[0], 'punc');
    const key = /^(?:\?[ \t]+)?("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#'"[\]{},&*!|>%@`][^#\n]*?)([ \t]*)(:)(?=[ \t]|$)/.exec(line.slice(i));
    if (key) {
      push(out, key[0].slice(0, key[0].length - key[1].length - key[2].length - 1));
      push(out, key[1], 'key');
      push(out, key[2]);
      push(out, ':', 'punc');
      i += key[0].length;
    }
    const rest = line.slice(i);
    scan(rest, /^[ \t]*[[{]/.test(rest) ? YAML_FLOW : YAML_BLOCK, out);
    if (/(?:^|[ \t])[|>][-+0-9]*[ \t]*(?:#.*)?$/.test(rest)) block = ind;
    push(out, nl);
  }
  return out;
}

function xml(s: string): Tok[] {
  const out: Tok[] = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<![^>]*>?|<\/?[^\s<>/!?][^<>]*>?|&#?\w+;|[^<&]+|[<&]/y;
  for (let m; (m = re.exec(s)) && m[0];) {
    const t = m[0];
    if (t.startsWith('<!--')) push(out, t, 'com');
    else if (t.startsWith('<![CDATA[')) push(out, t, 'str');
    else if (t.startsWith('<?') || t.startsWith('<!')) push(out, t, 'kw');
    else if (t[0] === '<' && t.length > 1) {
      const name = /^<\/?([^\s/>]+)/.exec(t)!;
      push(out, name[0].slice(0, name[0].length - name[1].length), 'punc');
      push(out, name[1], 'tag');
      scan(t.slice(name[0].length), [
        [/\s+/y, undefined],
        [/[^\s=/>"']+(?=\s*=)/y, 'attr'],
        [/"[^"]*"?|'[^']*'?/y, 'str'],
        [/\/?>|=/y, 'punc'],
      ], out);
    } else if (t[0] === '&' && t.length > 1) push(out, t, 'num');
    else push(out, t);
  }
  return out;
}

const SQL_KW = new Set(`
add all alter analyze and any array as asc authorization begin between bigint binary bit blob boolean both by call cascade case cast char character check cluster clustered collate column columns comment commit constraint create cross cube current current_date current_time current_timestamp cursor database date datetime day dec decimal declare default deferrable delete desc describe distinct distribute do double drop each else elseif end enum escape except exclude exec execute exists explain external fetch filter first float following for foreign format from full function grant group grouping having hour if ignore ilike in index inner inout insert int integer intersect interval into is join json key keys language last lateral leading left like limit local location loop match matched materialized merge minute month natural nchar next no not nothing nowait null nulls numeric nvarchar of offset on only or order out outer over overwrite partition partitioned percent pivot preceding precision primary procedure qualify range real recursive references rename repeat replace restrict return returning returns revoke right rlike rollback rollup row rows schema second select semi set sets show similar smallint some sort start stored straight_join string struct table tablesample temp temporary text then ties time timestamp tinyint to top trailing transaction trigger truncate unbounded union unique unknown unnest unpivot until update use user using values varchar varying view when where while window with within without year zone
`.trim().split(/\s+/));

function sql(s: string): Tok[] {
  return scan(s, [
    [/\s+/y, undefined],
    [/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'com'],
    // E'…' (PostgreSQL) takes backslash escapes; other strings only a doubled quote.
    [/[eE]'(?:[^'\\]|''|\\.)*'?/y, 'str'],
    [/[nNxXbB]?'(?:[^']|'')*'?/y, 'str'],
    [/\$(\w*)\$[\s\S]*?(?:\$\1\$|$)/y, 'str'],
    [/"(?:[^"]|"")*"?|`(?:[^`]|``)*`?/y, undefined],
    [/::/y, undefined],
    [/\$\{[^}\n]*\}?|:[A-Za-z_]\w*|@@?[A-Za-z_]\w*|\?/y, 'var'],
    [/0x[0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?![\w$])/y, 'num'],
    [/[A-Za-z_][\w$]*/y, (m, src, end) => {
      const w = m[0].toLowerCase();
      if (w === 'true' || w === 'false') return 'bool';
      // "x.select" and similar are names, not keywords.
      const prev = src[end - m[0].length - 1];
      if (prev === '.') return undefined;
      if (SQL_KW.has(w)) return 'kw';
      return /^[ \t]*\(/.test(src.slice(end, end + 16)) ? 'fn' : undefined;
    }],
  ]);
}

const BY_LANG: Record<HlLang, (s: string) => Tok[]> = { json, toml, yaml, xml, sql };

export function highlight(lang: HlLang, text: string): Tok[] {
  return BY_LANG[lang](text);
}
