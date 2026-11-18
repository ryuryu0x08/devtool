import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { printJson } from './json';
import { looksEscapedJson, unescapeJson, unescapeOnce } from './unjson';

const out = (t: string, nested = true) => {
  const r = unescapeJson(t, nested);
  if (!r.ok) throw new Error(r.message);
  return { text: printJson(r.ast), steps: r.steps, nested: r.nested, ...(r.mixed ? { mixed: true } : {}) };
};

describe('unescapeJson', () => {
  it('takes off one level, several, or a whole JSON string with its quotes', () => {
    expect(out('{\\"a\\":1,\\"b\\":\\"x\\"}')).toEqual({ text: '{"a":1,"b":"x"}', steps: ['unescape'], nested: 0 });
    expect(out('"{\\"a\\":1}"')).toEqual({ text: '{"a":1}', steps: ['string'], nested: 0 });
    expect(out('{\\\\\\"a\\\\\\":1}').steps).toEqual(['unescape', 'unescape']);
    expect(out('"\\"{\\\\\\"a\\\\\\":[1]}\\""').text).toBe('{"a":[1]}');
    // JSON as it is: left alone.
    expect(out('{"a":"say \\"hi\\""}')).toEqual({ text: '{"a":"say \\"hi\\""}', steps: [], nested: 0 });
  });

  it('a value escaped once more than the rest (mixed levels), as a message push holds', () => {
    const sample = readFileSync(new URL('./fixtures/escaped-push.txt', import.meta.url), 'utf8');
    const r = out(sample);
    expect(r.steps).toEqual(['unescape', 'unescape']);
    expect(r.mixed).toBe(true);
    const v = JSON.parse(r.text);
    expect(v.msg_title).toBe('啦啦啦');
    expect(v.push_button.buttons[0]).toMatchObject({ button: 4, text: '回复' });
    expect(v.push_button.buttons[0].link).toMatch(/^xhsdiscover:\/\/message\/groupchat\?group_id=138201657865554582&/);
  });

  it('numbers stay as written; escapes in values stay right', () => {
    expect(out('{\\"id\\":12345678901234567890,\\"f\\":1.50,\\"e\\":1E+3}').text).toBe('{"id":12345678901234567890,"f":1.50,"e":1E+3}');
    // A new line inside a value (\\n in the escaped text) stays an escape in the JSON.
    expect(out('{\\"t\\":\\"a\\\\nb\\",\\"u\\":\\"\\\\u4e2d\\"}').text).toBe('{"t":"a\\nb","u":"\\u4e2d"}');
    // Pretty-printed JSON put in a string: its new lines are just layout.
    expect(out('"{\\n  \\"a\\": 1\\n}"').text).toBe('{"a":1}');
  });

  it('opens up string values that are JSON, as deep as they go, unless asked not to', () => {
    const t = '{"data":"{\\"items\\":\\"[1,2]\\",\\"s\\":\\"{not json\\"}","n":"{}"}';
    expect(out(t)).toEqual({ text: '{"data":{"items":[1,2],"s":"{not json"},"n":{}}', steps: [], nested: 3 });
    expect(out(t, false).nested).toBe(0);
    expect(out(t, false).text).toBe(t);
  });

  it('says why when it is not JSON at any level', () => {
    expect(unescapeJson('')).toEqual({ ok: false, message: 'empty' });
    const r = unescapeJson('{\\"a\\":}');
    expect(r.ok).toBe(false);
    expect(unescapeJson('hello').ok).toBe(false);
    expect(unescapeJson('"just a string"').ok).toBe(false);
  });

  it('one level off, as JSON reads a string; mixed quotes kept', () => {
    expect(unescapeOnce('a\\"b\\\\c\\u4e2d')).toBe('a"b\\c中');
    expect(unescapeOnce('"x" and \\"y\\"')).toBe('"x" and "y"');
  });

  it('tells escaped JSON from JSON and from other text', () => {
    expect(looksEscapedJson('{\\"a\\":1}')).toBe(true);
    expect(looksEscapedJson('"{\\"a\\":1}"')).toBe(true);
    expect(looksEscapedJson('{"a":"\\"q\\""}')).toBe(false);
    expect(looksEscapedJson('say \\"hi\\"')).toBe(false);
  });
});
