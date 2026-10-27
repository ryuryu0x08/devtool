// Formatters (YAML, XML, SQL) never change data; JSON Schema says what it can't check exactly.
import { parseAllDocuments } from 'yaml';
import { describe, expect, it } from 'vitest';
import { YamlError, formatYaml, looksYaml } from './yamlfmt';
import { XmlError, XmlVerifyError, checkXml, formatXml, looksXml } from './xml';
import { SqlError, formatSql, looksSql } from './sqlfmt';
import { SchemaError, inexact, pointerToPath, validateJson, looksSchema } from './schema';
import { parseJsonAst } from './json';

const yamlData = (s: string) => parseAllDocuments(s, { intAsBigInt: true }).map((d) => d.toJS({ maxAliasCount: -1 }));

describe('YAML formatting', () => {
  const SRC = `# config
server:
    host:   example.com   # where
    port: 0x1F90
    ratio: 0.10000000000000000555
    big: 12345678901234567890
    exp: 1e3
    tags: [a,   b, "c d"]
    when: 2001-12-14t21:59:43.10-05:00
    yes_is_string: yes
anchors:
  base: &b {x: 1}
  copy: *b
text: |
    line 1
      indented
    line 3
folded: >
    a
    b
---
second: doc
`;
  it('re-indents; every value, spelling and comment stays', () => {
    const r = formatYaml(SRC, 2);
    expect(r.text).toContain('\n  port: 0x1F90');
    expect(r.text).toContain('ratio: 0.10000000000000000555');
    expect(r.text).toContain('exp: 1e3');
    expect(r.text).toContain('# where');
    expect(r.docs).toBe(2);
    expect(r.changed).toEqual([]);
    expect(yamlData(r.text)).toEqual(yamlData(SRC));
    expect(formatYaml(r.text, 2).text).toBe(r.text);
    expect(formatYaml(SRC, 4).text).toContain('\n    port: 0x1F90');
  });
  it('errors carry a position; duplicate keys are errors', () => {
    const pos = (s: string) => { try { formatYaml(s, 2); return null; } catch (e) { return (e as YamlError).pos; } };
    expect(pos('a: 1\na: 2\n')).toBe(5);
    expect(pos('a: [1, 2\n')).not.toBeNull();
    expect(pos('a:\n  - 1\n - 2\n')).not.toBeNull();
  });
  it('recognises YAML, not prose', () => {
    expect(looksYaml('name: x\nport: 80\n')).toBe(true);
    expect(looksYaml('- a\n- b\n')).toBe(true);
    expect(looksYaml('Note: hello')).toBe(false);
    expect(looksYaml('hello\nworld')).toBe(false);
  });
});

describe('XML formatting', () => {
  it('indents element-only content; text, mixed content and xml:space="preserve" stay as written', () => {
    const src = `<?xml version="1.0"?><root a="1"  b='x'><a>t &amp; u</a><p>Hi <b>you</b>  !</p><pre xml:space="preserve">\n  x  \n</pre><e></e><s/><!-- c --></root>`;
    expect(formatXml(src, '  ')).toBe(`<?xml version="1.0"?>\n<root a="1" b='x'>\n  <a>t &amp; u</a>\n  <p>Hi <b>you</b>  !</p>\n  <pre xml:space="preserve">\n  x  \n</pre>\n  <e></e>\n  <s/>\n  <!-- c -->\n</root>\n`);
    // CDATA is text: an element holding it keeps its inside exactly.
    expect(formatXml('<r><a/><![CDATA[<x>]]> <b/></r>', '  ')).toBe('<r><a/><![CDATA[<x>]]> <b/></r>\n');
  });
  it('is stable and reports what is wrong, where', () => {
    const src = '<a><b>1</b><c><d/></c></a>';
    expect(formatXml(formatXml(src, '\t'), '\t')).toBe(formatXml(src, '\t'));
    const err = (s: string) => { try { formatXml(s, '  '); return null; } catch (e) { return [(e as XmlError).code, (e as XmlError).pos]; } };
    expect(err('<a><b></a>')).toEqual(['mismatch', 6]);
    expect(err('<a>')).toEqual(['unclosed', 0]);
    expect(err('<a x="1" x="2"/>')).toEqual(['dupAttr', 9]);
    expect(err('<a>R&D</a>')).toEqual(['amp', 4]);
    expect(err('<a/><b/>')).toEqual(['multiRoot', 4]);
    expect(err('<a x="<"/>')).toEqual(['lt', 6]);
    expect(looksXml('<a><b/></a>')).toBe(true);
    expect(looksXml('<b>bold</i>')).toBe(false);
  });
  it('the check passes re-indenting and catches any other change', () => {
    const src = '<r a="1"><p>Hi <b>x</b></p><e/><!-- c --></r>';
    expect(() => checkXml(src, '<r a="1">\n  <p>Hi <b>x</b></p>\n  <e/>\n  <!-- c -->\n</r>\n')).not.toThrow();
    for (const bad of ['<r a="2"><p>Hi <b>x</b></p><e/><!-- c --></r>', '<r a="1"><p>Hi  <b>x</b></p><e/><!-- c --></r>', '<r a="1"><p>Hi <b>x</b></p><!-- c --></r>',
      '<r a="1"><p>Hi <b>x</b></p><e/><!-- d --></r>', '<r a="1"><p>Hi <b>x</b></p><e/><!-- c --></r', '<r a="1"><p>Hi <b>x</b></p><e></e><!-- c --></r>']) {
      expect(() => checkXml(src, bad), bad).toThrow(XmlVerifyError);
    }
  });
});

describe('SQL formatting', () => {
  const Q = `select a.id, b."Name", 'it''s' s, -1 x, a<=b, j->>'k', Users.Total from t a join u b on a.id=b.id where x=-1 and y in (1,2) -- tail\ngroup by 1 order by 2 desc limit 10; insert into T(a) values ($$x y$$, E'a\\'b', :p, ?, $1);`;
  it('formats; strings, names and numbers unchanged; keywords re-cased only on request', () => {
    const up = formatSql(Q, 'postgresql', 'upper', 2).text;
    for (const keep of [`b."Name"`, `'it''s'`, `-1`, `->> 'k'`, 'Users.Total', '$$x y$$', `E'a\\'b'`, '-- tail']) expect(up).toContain(keep);
    expect(up).toMatch(/^SELECT\n/);
    expect(formatSql(Q, 'postgresql', 'preserve', 2).text).toMatch(/^select\n/);
    expect(formatSql(Q, 'postgresql', 'lower', 4).text).toContain('\n    a.id,');
  });
  it('a block comment re-indented is reported, not hidden', () => {
    expect(formatSql('select 1 /* a\n      b */ from t', 'sql', 'preserve', 2).commentsReindented).toBe(true);
    expect(formatSql('select 1 from t -- c', 'sql', 'preserve', 2).commentsReindented).toBe(false);
  });
  it('syntax errors carry line and column', () => {
    try { formatSql('select (1 from', 'sql', 'upper', 2); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(SqlError);
      expect((e as SqlError).line).toBe(1);
    }
  });
  it('recognises SQL statements', () => {
    expect(looksSql('SELECT * FROM t')).toBe(true);
    expect(looksSql('select the best option')).toBe(false);
  });
});

describe('JSON Schema', () => {
  const schema = JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['id'], properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } }, additionalProperties: false, xyz: 1 });
  it('valid data; ignored keywords and inexact numbers are reported', () => {
    const r = validateJson(schema, '{"id":12345678901234567890,"tags":["a"]}', 'en');
    expect(r.valid).toBe(true);
    expect(r.draft).toBe('2020-12');
    expect(r.ignored.join()).toContain('xyz');
    expect(r.inexact).toEqual(['$.id = 12345678901234567890']);
  });
  it('every error with a JSONPath, in Chinese too', () => {
    const r = validateJson(schema, '{"tags":[1],"x":2}', 'zh');
    expect(r.valid).toBe(false);
    expect(r.issues.map((i) => [i.path, i.keyword])).toEqual([['$', 'required'], ['$', 'additionalProperties'], ['$.tags[0]', 'type']]);
    expect(r.issues[2].message).toBe('应当是 string 类型');
  });
  it('drafts, refusals', () => {
    expect(validateJson('{"$schema":"http://json-schema.org/draft-06/schema#","type":"string"}', '"x"', 'en').draft).toBe('06');
    expect(validateJson('{"type":"string"}', '1', 'en').draft).toBe('07');
    const code = (s: string, d: string) => { try { validateJson(s, d, 'en'); return null; } catch (e) { return (e as SchemaError).code; } };
    expect(code('{"$schema":"http://json-schema.org/draft-04/schema#"}', '1')).toBe('draft4');
    expect(code('{"$ref":"https://example.com/s.json"}', '1')).toBe('ref');
    expect(code('{"type":"object"}', '{"a":1,"a":2}')).toBe('dup');
    expect(pointerToPath('/a/0/b~1c')).toBe('$.a[0]["b/c"]');
    expect(inexact(parseJsonAst('[0.1, 1e400, 9007199254740993]').ast)).toEqual(['$[1] = 1e400', '$[2] = 9007199254740993']);
    expect(looksSchema(schema)).toBe(true);
    expect(looksSchema('{"id":1}')).toBe(false);
  });
});
