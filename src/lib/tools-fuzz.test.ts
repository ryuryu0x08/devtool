// Random and edge-case input never makes a tool's code throw anything but its own error type:
// the pages catch exactly those and show them; anything else would be an unexplained failure.
// The paste detectors (looks…) must never throw at all, since every paste runs them.
import { describe, expect, it } from 'vitest';
import { UrlError, looksPercent, looksUrl, parseUrl, urlDecode, urlEncode } from './url';
import { UniError, charTable, escapeUnicode, looksUniEscaped, unescapeUnicode } from './unicode';
import { decodeHtml, encodeHtml, looksHtmlEscaped } from './htmlent';
import { EscError, escapeStr, unescapeStr } from './escape';
import { HexError, hexToBytes, looksHex } from './hex';
import { NumError, readInt, widths, writeInt } from './numbase';
import { JwtError, decodeJwt, looksJwt, times } from './jwt';
import { YamlError, YamlVerifyError, formatYaml, looksYaml } from './yamlfmt';
import { XmlError, XmlVerifyError, formatXml, looksXml } from './xml';
import { SqlError, SqlVerifyError, formatSql, looksSql } from './sqlfmt';
import { SchemaError, looksSchema, validateJson } from './schema';
import { diffText } from './textdiff';
import { runRegex, splitLiteral } from './regex';
import { CASES, convertLines } from './caseconv';
import { countText } from './count';
import { processLines } from './textproc';
import { looksUuid, parseUuid } from './uuid';
import { looksUlid, snowflakeTime, ulidTime } from './ids';
import { CronError, describe as describeCron, guessDialect, looksCron, nextRuns, parseCron, type Dialect } from './cron';
import { presetOf, readExpr, toPreset, writeExpr } from './cronbuild';
import { contrast, formats, looksColor, parseColor } from './color';
import { parseJsonAst } from './json';

let seed = 20261027;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const PIECES = ['', ' ', '\n', '\t', '%', '%2', '%zz', '%E4', '%E4%B8', '%20', '+', '\\', '\\u', '\\u{', '\\u{110000}', '\\u{FFFFFFFF}', '\\uD800', '\\x', '\\x4', '\\0',
  '\\U0010FFFF', '\\U00110000', '&', '&#', '&#x', '&#x110000;', '&#99999999999;', '&amp', '&lt;', '\ud800', '\udc00', '😀', '\u0000', '中', 'é', '0x', '0b', '0o', '-', '_',
  ',', ':', ';', '.', '..', '1', '00', '9', 'ff', 'FF', 'g', 'z', 'L', 'W', '#', '?', '*', '/', '*/', '1-', '-1', '1/0', 'MON', 'JAN', '@', '@daily', '@reboot',
  '<', '>', '</', '<a', '<a>', '</a>', '<a/>', '<!--', '-->', '<![CDATA[', ']]>', '<?', '?>', '<!DOCTYPE', '"', "'", '`', '[', ']', '{', '}', '(', ')', '$', '$$',
  'a:', 'a: 1', '- ', '---', '...', '&a', '*a', '!!str', '|', '>-', 'select', 'from', 'where', 'E\'', '/*', '*/', '--', 'eyJ', 'eyJhbGciOiJub25lIn0', 'Bearer ',
  'rgb(', 'hsl(', 'oklch(', '#', '#fff', 'nan', 'inf', '1e999', '%', 'urn:uuid:', '{', '-', '0000', 'http://', 'https://a.b/', '?x=', '#frag', '=', '%%'];
const randomText = () => Array.from({ length: Math.floor(rnd() * 8) }, () => pick(PIECES)).join(rnd() < 0.3 ? ' ' : '');

/** Calls f with each input; collects any exception that isn't one of the allowed types. */
function check(name: string, inputs: string[], f: (s: string) => unknown, allowed: (new (...a: never[]) => Error)[] = []) {
  const bad: string[] = [];
  for (const s of inputs) {
    try { f(s); } catch (e) {
      if (!allowed.some((A) => e instanceof A)) bad.push(`${name}(${JSON.stringify(s)}): ${(e as Error)?.constructor?.name} ${String((e as Error)?.message).slice(0, 80)}`);
    }
  }
  return bad;
}

describe('no unexpected exceptions', () => {
  const inputs = [...PIECES, ...Array.from({ length: 3000 }, randomText)];
  const some = inputs.slice(0, 600);
  it('encoders and decoders', () => {
    const bad = [
      ...check('urlEncode', inputs, (s) => { urlEncode(s, 'component'); urlEncode(s, 'uri'); urlEncode(s, 'form'); }),
      ...check('urlDecode', inputs, (s) => { urlDecode(s, false); }, [UrlError]),
      ...check('urlDecode form', inputs, (s) => { urlDecode(s, true); }, [UrlError]),
      ...check('parseUrl', inputs, (s) => parseUrl(s)),
      ...check('escapeUnicode', inputs, (s) => { for (const f of ['u4', 'ubrace', 'html', 'cp'] as const) escapeUnicode(s, f, rnd() < 0.5); charTable(s); }),
      ...check('unescapeUnicode', inputs, (s) => unescapeUnicode(s), [UniError]),
      ...check('html', inputs, (s) => { encodeHtml(s, 'min'); encodeHtml(s, 'nonascii'); encodeHtml(s, 'named'); decodeHtml(s); }),
      ...check('escapeStr', inputs, (s) => { for (const l of ['json', 'js', 'java', 'c', 'sql', 'shell'] as const) { try { escapeStr(s, l); } catch (e) { if (!(e instanceof EscError)) throw e; } } }),
      ...check('unescapeStr', inputs, (s) => { for (const l of ['json', 'js', 'java', 'c', 'sql', 'shell'] as const) { try { unescapeStr(s, l); } catch (e) { if (!(e instanceof EscError)) throw e; } } }),
      ...check('hexToBytes', inputs, (s) => hexToBytes(s), [HexError]),
      ...check('readInt', inputs, (s) => { for (const b of ['auto', 2, 8, 10, 16, 36] as const) { try { const v = readInt(s, b).v; writeInt(v, 7, true); widths(v); } catch (e) { if (!(e instanceof NumError)) throw e; } } }),
      ...check('decodeJwt', inputs.map((s) => (rnd() < 0.5 ? s : 'eyJ' + s + '.eyJ' + s + '.' + s)), (s) => { try { times(decodeJwt(s).payload.obj); } catch (e) { if (!(e instanceof JwtError)) throw e; } }),
    ];
    expect(bad.slice(0, 20)).toEqual([]);
  });
  it('formatters, validators and text tools', () => {
    const bad = [
      ...check('formatYaml', inputs, (s) => formatYaml(s, 2), [YamlError, YamlVerifyError]),
      ...check('formatXml', inputs.map((s) => (rnd() < 0.5 ? '<r>' + s + '</r>' : s)), (s) => formatXml(s, '  '), [XmlError, XmlVerifyError]),
      ...check('formatSql', some.map((s) => 'select ' + s), (s) => formatSql(s, pick(['sql', 'postgresql', 'mysql'] as const), 'upper', 2), [SqlError, SqlVerifyError]),
      ...check('validateJson', some, (s) => {
        const data = JSON.stringify(s);
        for (const schema of ['{"type":"string","pattern":' + JSON.stringify(s) + '}', '{"type":"string","format":"date-time"}', '{"$ref":' + JSON.stringify(s) + '}']) {
          try { parseJsonAst(schema); } catch { continue; }
          try { validateJson(schema, data, 'zh'); } catch (e) { if (!(e instanceof SchemaError)) throw e; }
        }
      }),
      ...check('diffText', inputs, (s) => diffText(s, randomText(), { ignoreWs: rnd() < 0.5, ignoreCase: rnd() < 0.5 })),
      ...check('runRegex', inputs, (s) => { runRegex(s, pick(['', 'g', 'gi', 'gmsu', 'y', 'gv', 'gd']), randomText(), rnd() < 0.5 ? s : null); splitLiteral(s); }),
      ...check('text', inputs, (s) => { for (const k of CASES) convertLines(s, k); countText(s, 'zh'); processLines(s, { trim: true, dropBlank: true, dedupe: true, ignoreCase: true, sort: pick(['asc', 'natural', 'length'] as const), reverse: true }); }),
      ...check('ids', inputs, (s) => { parseUuid(s); ulidTime(s); snowflakeTime(s, 'twitter'); }),
      ...check('color', inputs, (s) => { const p = parseColor(s); if (p) { formats(p.c); contrast(p.c, p.c); } }),
    ];
    expect(bad.slice(0, 20)).toEqual([]);
  }, 120000);
  it('cron and its editor', () => {
    const exprs = [...inputs, ...Array.from({ length: 3000 }, () => Array.from({ length: 5 + Math.floor(rnd() * 3) }, () => pick(['*', '?', '0', '1', '5', '7', '12', '31', '59', '*/2', '1-5', '1,2', 'L', 'W', '5W', 'LW', 'L-2', '1#2', '6L', 'MON', 'MON-FRI', 'JAN', '0/15', '*/0', '60', '2099', '5-1'])).join(' '))];
    const bad = check('cron', exprs, (s) => {
      for (const d of ['unix', 'spring', 'quartz'] as Dialect[]) {
        try { const c = parseCron(s, d); describeCron(c, 'zh'); describeCron(c, 'en'); nextRuns(c, 'Asia/Shanghai', Date.UTC(2026, 9, 27), 3); } catch (e) { if (!(e instanceof CronError)) throw e; }
        const m = readExpr(s, d);
        if (m) { presetOf(m); writeExpr(m, d); for (const p of ['minute', 'everyN', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'custom'] as const) writeExpr(toPreset(p, m), d); }
      }
      guessDialect(s);
    });
    expect(bad.slice(0, 20)).toEqual([]);
  }, 60000);
  it('the paste detectors never throw', () => {
    const bad = check('looks', inputs, (s) => {
      looksPercent(s); looksUrl(s); looksUniEscaped(s); looksHtmlEscaped(s); looksHex(s); looksJwt(s); looksUuid(s); looksUlid(s);
      looksColor(s); looksCron(s); looksXml(s); looksSql(s); looksYaml(s); looksSchema(s);
    });
    expect(bad.slice(0, 20)).toEqual([]);
  });
});
