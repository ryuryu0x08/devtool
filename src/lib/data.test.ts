// "Nothing changes silently": formatting keeps every token, conversions refuse what the
// target can't hold exactly, and the diff never rounds or hides a difference.
import { describe, expect, it } from 'vitest';
import { ConvertError, MAX_DEPTH, Num, canon, decodeUtf8, diffNode, errInfo, numKey, type DiffNode, type DiffOpts } from './data';
import { astEqual, dupKeys, jsonValue, parseJsonAst, printJson, sortAst, toJsonText } from './json';
import { VerifyError, formatToml, parseTomlDoc, toTomlText, tomlValue, verifyToml } from './toml';

const fmtJson = (s: string, indent: string | number = 2, sort = false) => {
  let { ast } = parseJsonAst(s);
  if (sort) ast = sortAst(ast);
  return printJson(ast, indent);
};
const fmtToml = (s: string, sort = false) => {
  const doc = parseTomlDoc(s);
  const out = formatToml(doc, sort);
  verifyToml(doc, out, sort);
  return out;
};
const code = (f: () => unknown) => {
  try { f(); return null; } catch (e) { return e instanceof ConvertError ? e.code + ' ' + e.path : String(e); }
};

describe('JSON formatting keeps every token', () => {
  it('numbers exactly as written', () => {
    const src = '{"id":1234567890123456789,"f":1.50,"e":1E400,"z":-0,"n":-12.5e-3,"p":3.141592653589793238462643}';
    expect(fmtJson(src, '')).toBe(src);
    expect(fmtJson(src)).toContain('"id": 1234567890123456789');
    expect(fmtJson(src)).toContain('"p": 3.141592653589793238462643');
  });
  it('string escapes exactly as written', () => {
    const src = '["\\u00e9","é","\\/","\\uD83D\\uDE00","a\\nb","\\""]';
    expect(fmtJson(src, '')).toBe(src);
  });
  it('duplicate keys are kept, in order, and reported', () => {
    const src = '{"a":1,"b":{"c":1,"c":2},"a":2}';
    expect(fmtJson(src, '')).toBe(src);
    expect(dupKeys(parseJsonAst(src).ast)).toEqual(['$.b.c', '$.a']);
    // Sorting is stable: duplicates keep their relative order.
    expect(fmtJson('{"b":1,"a":1,"a":2}', '', true)).toBe('{"a":1,"a":2,"b":1}');
  });
  it('layout matches JSON.stringify', () => {
    const v = { a: [1, { b: 'x' }], c: {}, d: [] };
    expect(fmtJson(JSON.stringify(v), 2)).toBe(JSON.stringify(v, null, 2));
    expect(fmtJson(JSON.stringify(v), '\t')).toBe(JSON.stringify(v, null, '\t'));
  });
  it('reports a BOM instead of failing', () => {
    expect(parseJsonAst('\uFEFF{"a":1}').bom).toBe(true);
  });
  it(`refuses nesting deeper than ${MAX_DEPTH} instead of falling back to a lossy parser`, () => {
    const deep = (n: number) => '['.repeat(n) + '1' + ']'.repeat(n);
    expect(fmtJson(deep(MAX_DEPTH), '')).toBe(deep(MAX_DEPTH));
    expect(() => parseJsonAst(deep(MAX_DEPTH + 1))).toThrow(/not supported/);
  });
  it('reports error positions', () => {
    const at = (s: string) => {
      try { parseJsonAst(s); return null; } catch (e) { const i = errInfo(e, s); return [i.line, i.col]; }
    };
    expect(at('{\n  "a": 1,\n  "b": }')).toEqual([3, 8]);
    expect(at('{"a":1,}')).toEqual([1, 8]);
    expect(at('[01]')).toEqual([1, 3]);
    expect(at('"\\x"')).toEqual([1, 3]);
    expect(at('{"a":')).toEqual([1, 6]);
  });
});

describe('TOML formatting keeps every literal and comment', () => {
  it('normalizes whitespace only', () => {
    expect(fmtToml('  a=1\n\n\n   b  =  "x"   # note\n[t]\n  c=[1,2,  3]\n')).toBe('a = 1\n\nb = "x" # note\n\n[t]\nc = [1, 2, 3]\n');
  });
  it('comments everywhere', () => {
    const src = '# head\na = [ # open\n  1, # one\n  # before two\n  2,\n  # end\n] # after\n[t] # table\n# last\n';
    const out = fmtToml(src);
    for (const c of ['# head', '# open', '# one', '# before two', '# end', '# after', '# table', '# last']) expect(out).toContain(c);
  });
  it('number literals', () => {
    const src = 'a = 0xDEAD_BEEF\nb = 0o755\nc = 0b1010\nd = +42\ne = 1_000\nf = 3.14159265358979323846\ng = 6.02E+23\nh = -0.0\ni = -inf\nj = nan\nk = 9223372036854775807\n';
    expect(fmtToml(src)).toBe(src);
  });
  it('string literals', () => {
    const src = "a = 'C:\\path'\nb = \"\"\"\nline1\nline2\\\n   joined\"\"\"\nc = '''\nraw \\n'''\nd = \"\\u00e9\\x41\\e\"\ne = \"\"\"two \"\" quotes\"\"\"\"\"\n";
    expect(fmtToml(src)).toBe(src);
  });
  it('date / time literals', () => {
    const src = 'a = 1979-05-27 07:32:00.999999-07:00\nb = 1979-05-27t07:32:00z\nc = 07:32\nd = 1979-05-27\ne = 07:32:00.123456\n';
    expect(fmtToml(src)).toBe(src);
  });
  it('structure as written: dotted keys and inline tables stay', () => {
    const src = 'a.b.c = 1\nd = { e = 1, f.g = 2 }\n[[arr]]\nx = 1\n[arr.sub]\ny = 2\n[[arr]]\nx = 2\n';
    expect(fmtToml(src)).toBe('a.b.c = 1\nd = { e = 1, f.g = 2 }\n\n[[arr]]\nx = 1\n\n[arr.sub]\ny = 2\n\n[[arr]]\nx = 2\n');
  });
  it('TOML 1.1 multi-line inline tables with comments', () => {
    const out = fmtToml('t = {\n  a = 1, # first\n  b = 2,\n}\n');
    expect(out).toBe('t = {\n  a = 1, # first\n  b = 2,\n}\n');
  });
  it('sorting keeps values and comments', () => {
    const out = fmtToml('# top\nb = 1 # bee\n# about a\na = 2\n\nz = 0x1\ny = 1.0\n[t]\nd = { y = 1, x = 2 }\n', true);
    expect(out).toBe('# about a\na = 2\n# top\nb = 1 # bee\n\ny = 1.0\nz = 0x1\n\n[t]\nd = { x = 2, y = 1 }\n');
  });
  it('is stable', () => {
    const once = fmtToml('a=1\n[b]\nc = [\n1,\n2]\n');
    expect(fmtToml(once)).toBe(once);
  });
});

describe('verification catches any change', () => {
  const src = '# c1\na = 0x2A\nb = 1.0\nc = 07:32:00.123456\nd = \'lit\'\ne = 3.14159265358979323846\n';
  const doc = parseTomlDoc(src);
  const out = formatToml(doc);
  it.each([
    ['dropped comment', '# c1\n', ''],
    ['hex rewritten', '0x2A', '42'],
    ['float became int', '1.0', '1'],
    ['fraction truncated', '07:32:00.123456', '07:32:00.123'],
    ['string style changed', "'lit'", '"lit"'],
    ['digits rounded', '3.14159265358979323846', '3.141592653589793'],
  ])('%s', (_name, from, to) => {
    expect(() => verifyToml(doc, out.replace(from, to), false)).toThrow(VerifyError);
  });
  it('accepts the untouched output', () => {
    expect(() => verifyToml(doc, out, false)).not.toThrow();
  });
  it('JSON: any token change breaks token equality', () => {
    const { ast } = parseJsonAst('{"a":1.50,"b":"\\u00e9"}');
    expect(astEqual(parseJsonAst('{"a": 1.50, "b": "\\u00e9"}').ast, ast)).toBe(true);
    expect(astEqual(parseJsonAst('{"a":1.5,"b":"\\u00e9"}').ast, ast)).toBe(false);
    expect(astEqual(parseJsonAst('{"a":1.50,"b":"é"}').ast, ast)).toBe(false);
  });
});

describe('JSON → TOML refuses anything TOML can’t hold exactly', () => {
  const conv = (s: string) => toTomlText(jsonValue(parseJsonAst(s).ast).v as Record<string, unknown>);
  it('keeps exact literals', () => {
    expect(conv('{"a":1,"b":1.50,"c":0.1,"d":9223372036854775807,"e":-9223372036854775808,"f":1e5,"s":"x\\ny"}'))
      .toBe('a = 1\nb = 1.50\nc = 0.1\nd = 9223372036854775807\ne = -9223372036854775808\nf = 1e5\ns = "x\\ny"\n');
  });
  it.each([
    ['{"a":9223372036854775808}', 'intRange $.a'],
    ['{"a":{"b":3.141592653589793238}}', 'floatPrecision $.a.b'],
    ['{"a":0.10000000000000000555}', 'floatPrecision $.a'],
    ['{"a":1e400}', 'floatRange $.a'],
    ['{"a":[1,null]}', 'null $.a[1]'],
    ['{"a":"\\ud800"}', 'badString $.a'],
  ])('%s → %s', (src, expected) => {
    expect(code(() => conv(src))).toBe(expected);
  });
  it('refuses duplicate keys', () => {
    expect(code(() => jsonValue(parseJsonAst('{"a":1,"a":2}').ast))).toBe('dupKey $.a');
  });
});

describe('TOML → JSON keeps exact values', () => {
  const conv = (s: string, dates: string[] = []) => toJsonText(parseTomlDoc(s).value, '', dates);
  it('integers and floats exactly', () => {
    expect(conv('a = 0xFF\nb = 9223372036854775807\nc = 3.14159265358979323846\nd = 1_000.5\ne = +1.5\nf = -0.0'))
      .toBe('{"a":255,"b":9223372036854775807,"c":3.14159265358979323846,"d":1000.5,"e":1.5,"f":-0.0}');
  });
  it('reports dates that become strings', () => {
    const dates: string[] = [];
    expect(conv('d = 1979-05-27\nt = { u = 07:32:00.999999 }', dates)).toBe('{"d":"1979-05-27","t":{"u":"07:32:00.999999"}}');
    expect(dates).toEqual(['$.d', '$.t.u']);
  });
  it.each(['a = nan', 'a = inf', 'a = [1, -inf]'])('refuses %s', (src) => {
    expect(code(() => conv(src))).toMatch(/^nanInf /);
  });
  it('round-trips JSON → TOML → JSON without changing a value', () => {
    const src = '{"a":1,"b":1.50,"c":[0.1,-0.0],"d":{"e":"é","f":9007199254740993}}';
    const toml = toTomlText(jsonValue(parseJsonAst(src).ast).v as Record<string, unknown>);
    expect(conv(toml)).toBe(src);
  });
});

const diff = (a: string, b: string, o: DiffOpts = {}) => {
  const A = jsonValue(parseJsonAst(a).ast), B = jsonValue(parseJsonAst(b).ast);
  return diffNode(A.v, B.v, null, '$', { rawA: A.raw, rawB: B.raw, ...o });
};
const tdiff = (a: string, b: string) => {
  const A = parseTomlDoc(a), B = parseTomlDoc(b);
  return diffNode(A.value, B.value, null, '$', { typed: true, rawA: A.raw, rawB: B.raw });
};
const flat = (d: DiffNode) => {
  const out: string[] = [];
  const walk = (n: DiffNode) => {
    if (n.ch) n.ch.forEach(walk);
    else if (n.st !== 'same') out.push(n.st + ' ' + n.path);
    else if (n.fmt) out.push('fmt ' + n.path + ' ' + n.fmt.join('→'));
  };
  walk(d);
  return out;
};

describe('diff', () => {
  it('ignores key order and whitespace', () => {
    expect(flat(diff('{"a":1,"b":2}', '{ "b": 2,\n "a": 1 }'))).toEqual([]);
  });
  it('never loses precision', () => {
    expect(flat(diff('[12345678901234567890]', '[12345678901234567891]'))).toEqual(['chg $[0]']);
    // Same double, different decimal: still a difference.
    expect(flat(diff('[0.1]', '[0.10000000000000000555]'))).toEqual(['chg $[0]']);
    expect(flat(diff('[1e400]', '[2e400]'))).toEqual(['chg $[0]']);
  });
  it('shows equal values written differently instead of hiding them', () => {
    expect(flat(diff('{"a":1.0,"b":"\\u00e9","c":100}', '{"a":1,"b":"é","c":1e2}'))).toEqual(['fmt $.a 1.0→1', 'fmt $.b "\\u00e9"→"é"', 'fmt $.c 100→1e2']);
    expect(diff('[1.0]', '[1]').st).toBe('same');
    expect(flat(diff('[[1.0]]', '[[1]]'))).toEqual(['fmt $[0][0] 1.0→1']);
  });
  it('TOML: int vs float is a change; 0xFF vs 255 is written differently', () => {
    expect(flat(tdiff('a = 1', 'a = 1.0'))).toEqual(['chg $.a']);
    expect(flat(tdiff('a = 0xFF\nb = 1979-05-27 07:32:00Z', 'a = 255\nb = 1979-05-27T07:32:00+00:00'))).toEqual(['fmt $.a 0xFF→255', 'fmt $.b 1979-05-27 07:32:00Z→1979-05-27T07:32:00+00:00']);
    expect(flat(tdiff('a = 07:32:00.999999', 'a = 07:32:00.999'))).toEqual(['chg $.a']);
  });
  it('aligns arrays and reports both locations', () => {
    expect(flat(diff('[1,2,3]', '[0,1,2,3]'))).toEqual(['add $[0]']);
    const d = diff('[1,{"x":1}]', '[0,1,{"x":2}]');
    const chg = d.ch!.find((c) => c.st === 'mod')!.ch![0];
    expect([chg.st, chg.path, chg.pathB]).toEqual(['chg', '$[1].x', '$[2].x']);
  });
  it('ignore-order matches as a multiset, nested too', () => {
    expect(diff('[[1,2],[3]]', '[[3],[2,1]]', { io: true }).st).toBe('same');
    expect(flat(diff('[1,1]', '[1]', { io: true }))).toEqual(['del $[1]']);
  });
  it('treats inherited names like constructor as ordinary keys', () => {
    expect(flat(diff('{}', '{"constructor":1}'))).toEqual(['add $.constructor']);
    expect(flat(diff('{"__proto__":{"x":1}}', '{"__proto__":{"x":2}}'))).toEqual(['chg $.__proto__.x']);
  });
  it('compares numbers across formats by value', () => {
    expect(canon(jsonValue(parseJsonAst('{"a":255,"b":1.5}').ast).v)).toBe(canon(parseTomlDoc('a = 0xFF\nb = 1.50').value));
  });
});

describe('helpers', () => {
  it('numKey is exact', () => {
    expect(numKey('1')).toBe(numKey('1.000e0'));
    expect(numKey('0x10')).toBe(numKey('16'));
    expect(numKey('12345678901234567890')).not.toBe(numKey('12345678901234567891'));
    expect(numKey(new Num('-0.0', 'float', 'toml'))).toBe('0');
  });
  it('tomlValue shows source text', () => {
    const doc = parseTomlDoc('a = [0x1, 1.50, \'x\']');
    expect(tomlValue(doc.value.a, '$.a', doc.raw)).toBe("[0x1, 1.50, 'x']");
  });
  it('decodeUtf8 refuses invalid bytes instead of inserting U+FFFD', () => {
    expect(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62]))).toBeNull();
    expect(decodeUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBeNull(); // encoded surrogate
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('\uFEFFa'); // BOM kept, reported later
    expect(decodeUtf8(new TextEncoder().encode('中文'))).toBe('中文');
  });
});
