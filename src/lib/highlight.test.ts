import { describe, expect, it } from 'vitest';
import { highlight, type HlLang, type Kind } from './highlight';

const LANGS: HlLang[] = ['json', 'toml', 'yaml', 'xml', 'sql'];
/** The pieces of `text` coloured `k`, in order. */
const of = (lang: HlLang, text: string, k: Kind) => highlight(lang, text).filter((t) => t.k === k).map((t) => t.t.trim());

describe('highlight', () => {
  it('never changes the text: the pieces put together are the input, for any input', () => {
    const alphabet = ['a', 'Z', '0', '9', ' ', '\t', '\n', '\r\n', '"', "'", '`', '#', '-', '--', '/*', '*/', ':', '=', '[', ']', '{', '}', ',', '.', '<', '>', '/', '!', '?', '&', ';', '|', '$', '@', '\\', 'é', '中', '😀', '​', 'true', 'SELECT', '<!--', '-->', '<![CDATA[', ']]>', '"""', "'''", '${', '- ', ': '];
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let n = 0; n < 3000; n++) {
      let s = '';
      for (let i = rnd(60); i > 0; i--) s += alphabet[rnd(alphabet.length)];
      for (const l of LANGS) {
        const toks = highlight(l, s);
        expect(toks.map((t) => t.t).join(''), l + ' ' + JSON.stringify(s)).toBe(s);
        expect(toks.every((t) => t.t.length > 0)).toBe(true);
      }
    }
  });

  it('is fast on a large input', () => {
    const big = Array.from({ length: 4000 }, (_, i) => `  "k${i}": ["v${i}", ${i}, true, null],\n  name: 'x${i}' -- c\nSELECT a${i} FROM t WHERE b = 'q' <a x="1">t</a>`).join('\n');
    const t0 = performance.now();
    for (const l of LANGS) highlight(l, big);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('SQL: keywords, functions, strings, numbers, comments, placeholders', () => {
    const s = "SELECT get_json_object (m, '$.a') AS t, count(*) FROM b_ods.select WHERE log_date = '${yyyyMMdd}' AND x >= 10 -- note\n/* c */ AND y::int = :p AND z = TRUE";
    expect(of('sql', s, 'kw')).toEqual(['SELECT', 'AS', 'FROM', 'WHERE', 'AND', 'AND', 'int', 'AND']);
    expect(of('sql', s, 'fn')).toEqual(['get_json_object', 'count']);
    expect(of('sql', s, 'str')).toEqual(["'$.a'", "'${yyyyMMdd}'"]);
    expect(of('sql', s, 'num')).toEqual(['10']);
    expect(of('sql', s, 'com')).toEqual(['-- note', '/* c */']);
    expect(of('sql', s, 'var')).toEqual([':p']);
    expect(of('sql', s, 'bool')).toEqual(['TRUE']);
    // A doubled quote stays inside the string; a quoted name is not a keyword.
    expect(of('sql', `SELECT 'it''s' AS "select"`, 'str')).toEqual(["'it''s'"]);
    expect(of('sql', `SELECT 'it''s' AS "select"`, 'kw')).toEqual(['SELECT', 'AS']);
    expect(of('sql', "SELECT E'a\\'b', 'c\\' AS d", 'str')).toEqual(["E'a\\'b'", "'c\\'"]);
  });

  it('JSON: keys, strings, numbers, true/false/null', () => {
    const s = '{\n  "a": "x",\n  "b": [1, -2.5e3, true, null],\n  "c" : {}\n}';
    expect(of('json', s, 'key')).toEqual(['"a"', '"b"', '"c"']);
    expect(of('json', s, 'str')).toEqual(['"x"']);
    expect(of('json', s, 'num')).toEqual(['1', '-2.5e3']);
    expect(of('json', s, 'bool')).toEqual(['true', 'null']);
  });

  it('TOML: tables, keys (dotted too), strings, dates, numbers, comments', () => {
    const s = 'title = "t" # c\n[server.limits]\nrps = 1_200\n"a b".c = \'\'\'x\ny\'\'\'\nwhen = 1979-05-27T07:32:00Z\nok = true\nlist = [1, 2]\n  [[owners]]\n';
    expect(of('toml', s, 'tag')).toEqual(['[server.limits]', '[[owners]]']);
    expect(of('toml', s, 'key')).toEqual(['title', 'rps', '"a b".c', 'when', 'ok', 'list']);
    expect(of('toml', s, 'str')).toEqual(['"t"', "'''x\ny'''"]);
    expect(of('toml', s, 'date')).toEqual(['1979-05-27T07:32:00Z']);
    expect(of('toml', s, 'num')).toEqual(['1_200', '1', '2']);
    expect(of('toml', s, 'com')).toEqual(['# c']);
  });

  it('YAML: keys, plain values by type, quoted strings, comments, anchors, block text', () => {
    const s = '---\nname: my app # c\nport: 8080\non: true\nnothing: ~\nurl: http://a.b/c#d\nlist:\n  - a, b\n  - key: "q"\n    ref: *base\ntext: |\n  line one: x\n  # not a comment\nflow: [1, x]\nwhen: 2024-01-02\n';
    expect(of('yaml', s, 'key')).toEqual(['name', 'port', 'on', 'nothing', 'url', 'list', 'key', 'ref', 'text', 'flow', 'when']);
    expect(of('yaml', s, 'str')).toEqual(['my app', 'http://a.b/c#d', 'a, b', '"q"', 'line one: x', '# not a comment', 'x']);
    expect(of('yaml', s, 'num')).toEqual(['8080', '1']);
    expect(of('yaml', s, 'bool')).toEqual(['true', '~']);
    expect(of('yaml', s, 'com')).toEqual(['# c']);
    expect(of('yaml', s, 'var')).toEqual(['*base']);
    expect(of('yaml', s, 'date')).toEqual(['2024-01-02']);
  });

  it('XML: tags, attributes, values, comments, CDATA, entities, declarations', () => {
    const s = '<?xml version="1.0"?>\n<!DOCTYPE a>\n<a x="1" y=\'2\'>\n  <!-- c -->\n  <b/>t &amp; u<![CDATA[<raw>]]>\n</a>';
    expect(of('xml', s, 'tag')).toEqual(['a', 'b', 'a']);
    expect(of('xml', s, 'attr')).toEqual(['x', 'y']);
    expect(of('xml', s, 'str')).toEqual(['"1"', "'2'", '<![CDATA[<raw>]]>']);
    expect(of('xml', s, 'com')).toEqual(['<!-- c -->']);
    expect(of('xml', s, 'num')).toEqual(['&amp;']);
    expect(of('xml', s, 'kw')).toEqual(['<?xml version="1.0"?>', '<!DOCTYPE a>']);
  });
});
