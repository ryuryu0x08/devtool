// Text tools, UUIDs, passwords, IDs, cron and colours.
import { CronExpressionParser } from 'cron-parser';
import { converter, formatHex, parse as culoriParse, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';
import { diffText } from './textdiff';
import { groupNames, runRegex, splitLiteral } from './regex';
import { CASES, convertCase, convertLines, words } from './caseconv';
import { countText } from './count';
import { processLines } from './textproc';
import { looksUuid, parseUuid, uuid4, uuid7 } from './uuid';
import { looksUlid, snowflakeTime, ulidTime } from './ids';
import { CronError, describe as describeCron, guessDialect, looksCron, nextRuns, parseCron, type Dialect } from './cron';
import { presetOf, readExpr, toPreset, writeExpr, writePart } from './cronbuild';
import { contrast, formats, looksColor, parseColor, toOklch } from './color';

describe('text diff', () => {
  it('lines added, removed, changed (with the changed characters)', () => {
    const d = diffText('a\nb\nc\nd', 'a\nB!\nc\ne\nf', { ignoreWs: false, ignoreCase: false });
    expect(d.map((l) => l.k + (l.a ?? '-') + (l.b ?? '-') + ':' + l.text)).toEqual(['same11:a', 'del2-:b', 'add-2:B!', 'same33:c', 'del4-:d', 'add-4:e', 'add-5:f']);
    expect(d[1].segs).toEqual([{ t: 'b', ch: true }]);
    expect(d[2].segs).toEqual([{ t: 'B!', ch: true }]);
  });
  it('ignore whitespace / case', () => {
    expect(diffText('a  b\nX', 'a b \nx', { ignoreWs: true, ignoreCase: true }).every((l) => l.k === 'same')).toBe(true);
    expect(diffText('a  b', 'a b', { ignoreWs: false, ignoreCase: false }).map((l) => l.k)).toEqual(['del', 'add']);
  });
  it('identical and empty texts', () => {
    expect(diffText('x\ny', 'x\ny', { ignoreWs: false, ignoreCase: false }).every((l) => l.k === 'same')).toBe(true);
    expect(diffText('', 'a', { ignoreWs: false, ignoreCase: false }).map((l) => l.k)).toEqual(['del', 'add']);
  });
});

describe('regex', () => {
  it('matches with groups and positions; replacement', () => {
    const r = runRegex('(?<y>\\d{4})-(\\d{2})', 'g', 'on 2026-10 and 2027-01', '$2/$<y>');
    expect(r.matches.map((m) => [m.i, m.text, m.groups.map((g) => g.name + '=' + g.value).join()])).toEqual([[3, '2026-10', 'y=2026,2=10'], [15, '2027-01', 'y=2027,2=01']]);
    expect(r.replaced).toBe('on 10/2026 and 01/2027');
    expect(runRegex('a', '', 'aaa', null).matches).toHaveLength(1);
  });
  it('empty matches don\'t loop; errors are messages', () => {
    expect(runRegex('x*', 'g', 'ab', null).total).toBe(3);
    expect(runRegex('(?:)', 'gu', '😀a', null).total).toBe(3);
    expect(runRegex('(', 'g', 'a', null).err).toBeTruthy();
    expect(splitLiteral('/a\\/b/gi')).toEqual({ pattern: 'a\\/b', flags: 'gi' });
    expect(groupNames('(a)(?:b)(?<n>c)[(](?=d)(e)')).toEqual([null, 'n', null]);
  });
});

describe('case conversion', () => {
  it.each([
    ['XMLHttpRequest', ['xmlHttpRequest', 'XmlHttpRequest', 'xml_http_request', 'XML_HTTP_REQUEST', 'xml-http-request', 'xml.http.request', 'Xml Http Request']],
    ['user_id v2Api', ['userIdV2Api', 'UserIdV2Api', 'user_id_v2_api', 'USER_ID_V2_API', 'user-id-v2-api', 'user.id.v2.api', 'User Id V2 Api']],
    ['  hello-World.foo ', ['helloWorldFoo', 'HelloWorldFoo', 'hello_world_foo', 'HELLO_WORLD_FOO', 'hello-world-foo', 'hello.world.foo', 'Hello World Foo']],
  ])('%s', (s, want) => {
    expect(CASES.slice(0, 7).map((k) => convertCase(s, k))).toEqual(want);
  });
  it('lines on their own; non-ASCII letters kept', () => {
    expect(convertLines('foo bar\n\nBaz Qux', 'snake')).toBe('foo_bar\n\nbaz_qux');
    expect(words('ÜberGröße straße')).toEqual(['Über', 'Größe', 'straße']);
  });
});

describe('counting', () => {
  it('graphemes, code points, UTF-16, UTF-8, words, CJK', () => {
    const t = 'Hi 👨‍👩‍👧 中文！\nsecond line\n\nthird';
    const c = countText(t);
    // The family emoji is one character a reader sees, five code points, eight UTF-16 units.
    expect(c.graphemes).toBe(27);
    expect(c.codePoints).toBe(31);
    expect(c.utf16).toBe(t.length);
    expect(c.utf16).toBe(34);
    expect(c.utf8).toBe(new TextEncoder().encode(t).length);
    expect(c.lines).toBe(4);
    expect(c.nonEmptyLines).toBe(3);
    expect(c.cjk).toBe(2);
    expect(c.latinWords).toBe(4);
    expect(c.paragraphs).toBe(2);
    expect(countText('').lines).toBe(0);
  });
});

describe('line processing', () => {
  it('sorting keeps lines that compare equal in their order', () => {
    const o = { trim: false, dropBlank: false, dedupe: false, ignoreCase: true, sort: 'asc' as const, reverse: false };
    expect(processLines('b\nA\na\nB', o).text).toBe('A\na\nb\nB');
    expect(processLines('xx\nb\na', { ...o, sort: 'length' }).text).toBe('b\na\nxx');
  });
  const o = { trim: false, dropBlank: false, dedupe: false, ignoreCase: false, sort: 'none' as const, reverse: false };
  it('each operation, in order, with counts', () => {
    expect(processLines(' b\na\n\nb\nB', { ...o, trim: true, dropBlank: true, dedupe: true })).toEqual({ text: 'b\na\nB', lines: 3, blank: 1, dupes: 1 });
    expect(processLines('b\nB\na', { ...o, dedupe: true, ignoreCase: true }).text).toBe('b\na');
    expect(processLines('file10\nfile2\nfile1', { ...o, sort: 'natural' }).text).toBe('file1\nfile2\nfile10');
    expect(processLines('file10\nfile2\nfile1', { ...o, sort: 'asc' }).text).toBe('file1\nfile10\nfile2');
    expect(processLines('b\na\nc', { ...o, sort: 'desc' }).text).toBe('c\nb\na');
    expect(processLines('ccc\na\nbb', { ...o, sort: 'length' }).text).toBe('a\nbb\nccc');
    expect(processLines('1\n2\n3', { ...o, reverse: true }).text).toBe('3\n2\n1');
    expect(processLines('x\nX\nx', { ...o, sort: 'asc', ignoreCase: true }).text).toBe('x\nX\nx');
  });
});

describe('UUID', () => {
  it('v4 / v7 are well formed; a v7 batch is strictly increasing and carries the time', () => {
    for (let i = 0; i < 200; i++) expect(parseUuid(uuid4())).toMatchObject({ version: 4, variant: 'rfc' });
    const t = Date.UTC(2026, 9, 27, 1, 2, 3, 456);
    const batch = Array.from({ length: 500 }, () => uuid7(t));
    expect([...batch].sort()).toEqual(batch);
    expect(new Set(batch).size).toBe(500);
    for (const u of batch.slice(0, 20)) expect(parseUuid(u)).toMatchObject({ version: 7, variant: 'rfc', ms: t });
  });
  it('reads v1 / v6 times, nil / max, braces and urn forms', () => {
    // RFC 9562 test vectors: 2022-02-22 19:22:22 UTC.
    expect(parseUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846')).toMatchObject({ version: 1, ms: Date.UTC(2022, 1, 22, 19, 22, 22), clockSeq: 0x33c8, node: '9f:6b:de:ce:d8:46' });
    expect(parseUuid('1EC9414C-232A-6B00-B3C8-9F6BDECED846')).toMatchObject({ version: 6, ms: Date.UTC(2022, 1, 22, 19, 22, 22) });
    expect(parseUuid('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')).toMatchObject({ version: 7, ms: 0x017f22e279b0 });
    expect(parseUuid('{00000000-0000-0000-0000-000000000000}')).toMatchObject({ nil: true });
    expect(parseUuid('urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff')).toMatchObject({ max: true });
    expect(parseUuid('not-a-uuid')).toBeNull();
    expect(looksUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
});

describe('IDs with time', () => {
  it('ULID and Snowflake', () => {
    // The ULID spec's example: ulid(1469918176385) = 01ARYZ6S41TSV4RRFFQ69G5FAV.
    expect(ulidTime('01ARYZ6S41TSV4RRFFQ69G5FAV')).toBe(1469918176385);
    expect(looksUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    expect(looksUlid('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false);
    // By definition: (ms − epoch) << 22, then 10 bits of machine and 12 of sequence.
    const ms = Date.UTC(2026, 9, 27, 1, 2, 3, 456);
    const id = ((BigInt(ms - 1288834974657) << 22n) | (513n << 12n) | 4095n).toString();
    expect(snowflakeTime(id, 'twitter')).toBe(ms);
    // Discord's documented example: 175928847299117063 → 2016-04-30T11:18:25.796Z.
    expect(snowflakeTime('175928847299117063', 'discord')).toBe(Date.UTC(2016, 3, 30, 11, 18, 25, 796));
    expect(snowflakeTime('12', 'twitter')).toBeNull();
  });
});

describe('cron', () => {
  const NOW = Date.UTC(2026, 9, 27, 3, 4, 5);
  it('next runs agree with cron-parser (Unix expressions, several zones)', () => {
    for (const expr of ['* * * * *', '*/15 9-17 * * 1-5', '0 0 1,15 * *', '30 2 * * 0', '0 12 * JAN,JUL MON', '5 4 31 * *', '0 0 29 2 *', '0 9 1 * 1', '@weekly', '0 */3 * * *']) {
      for (const tz of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
        const ours = nextRuns(parseCron(expr, guessDialect(expr)), tz, NOW, 8).runs.map((r) => r.ms);
        const it = CronExpressionParser.parse(expr, { currentDate: new Date(NOW), tz });
        const ref = Array.from({ length: 8 }, () => it.next().getTime());
        expect(ours, expr + ' ' + tz).toEqual(ref);
      }
    }
  });
  it('DST: skipped wall times do not run, repeated ones run once', () => {
    // From 2026-03-07 00:00 in New York; 02:30 on the 8th doesn't exist (clocks go 02:00 → 03:00).
    const r = nextRuns(parseCron('30 2 * * *', 'unix'), 'America/New_York', Date.UTC(2026, 2, 7, 5), 3);
    expect(r.skipped).toBe(1);
    expect(r.runs.map((x) => new Date(x.ms).toISOString())).toEqual(['2026-03-07T07:30:00.000Z', '2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z']);
    const fall = nextRuns(parseCron('30 1 * * *', 'unix'), 'America/New_York', Date.UTC(2026, 9, 31, 12), 2);
    expect(fall.runs[0]).toEqual({ ms: Date.UTC(2026, 10, 1, 5, 30), repeated: true });
  });
  it('Spring (seconds) and Quartz (L, W, #, ?, Sunday = 1)', () => {
    const iso = (expr: string, d: 'spring' | 'quartz', n = 3) => nextRuns(parseCron(expr, d), 'UTC', NOW, n).runs.map((r) => new Date(r.ms).toISOString().slice(0, 19));
    expect(iso('*/20 * * * * *', 'spring')).toEqual(['2026-10-27T03:04:20', '2026-10-27T03:04:40', '2026-10-27T03:05:00']);
    expect(iso('0 0 0 L * ?', 'quartz')).toEqual(['2026-10-31T00:00:00', '2026-11-30T00:00:00', '2026-12-31T00:00:00']);
    expect(iso('0 0 0 ? * 6#3', 'quartz')).toEqual(['2026-11-20T00:00:00', '2026-12-18T00:00:00', '2027-01-15T00:00:00']);
    expect(iso('0 0 0 ? * 6L', 'quartz')).toEqual(['2026-10-30T00:00:00', '2026-11-27T00:00:00', '2026-12-25T00:00:00']);
    expect(iso('0 0 0 15W * ?', 'quartz')).toEqual(['2026-11-16T00:00:00', '2026-12-15T00:00:00', '2027-01-15T00:00:00']);
    expect(iso('0 0 0 LW * ?', 'quartz', 2)).toEqual(['2026-10-30T00:00:00', '2026-11-30T00:00:00']);
    // Spring: both day fields must match.
    expect(iso('0 0 0 13 * FRI', 'spring', 2)).toEqual(['2026-11-13T00:00:00', '2027-08-13T00:00:00']);
    // Unix: either.
    expect(nextRuns(parseCron('0 0 13 * 5', 'unix'), 'UTC', NOW, 2).runs.map((r) => new Date(r.ms).toISOString().slice(0, 10))).toEqual(['2026-10-30', '2026-11-06']);
  });
  it('describes in Chinese and English', () => {
    const zh = (e: string, d = guessDialect(e)) => describeCron(parseCron(e, d), 'zh');
    expect(zh('30 9 * * 1-5')).toBe('每个工作日（周一至周五） 09:30');
    expect(zh('*/5 * * * *')).toBe('每天 每 5 分钟');
    expect(zh('0 0 1 * *')).toBe('每月 1 日 00:00');
    expect(zh('0 8,12,18 * * *')).toBe('每天 08:00、12:00、18:00');
    expect(zh('0 0 0 ? * 6L', 'quartz')).toBe('每月最后一个周五 00:00');
    expect(zh('0 0 0 ? * 2#1', 'quartz')).toBe('每月第 1 个周一 00:00');
    expect(zh('0 0 1 1 *')).toBe('1 月 每月 1 日 00:00');
    expect(describeCron(parseCron('30 9 * * 1-5', 'unix'), 'en')).toBe('09:30, every weekday (Monday to Friday)');
    expect(zh('@reboot')).toBe('系统启动时运行一次');
  });
  it('errors say which field', () => {
    const e = (s: string, d: 'unix' | 'spring' | 'quartz' = 'unix') => { try { parseCron(s, d); return null; } catch (x) { return [(x as CronError).code, (x as CronError).field]; } };
    expect(e('* * * *')).toEqual(['count', 4]);
    expect(e('60 * * * *')).toEqual(['value', 0]);
    expect(e('* 5-1 * * *')).toEqual(['range', 1]);
    expect(e('*/0 * * * *')).toEqual(['step', 0]);
    expect(e('0 0 L * *')).toEqual(['special', 2]);
    expect(e('0 0 0 1 * MON', 'quartz')).toEqual(['quartzQ', 3]);
    expect(looksCron('*/5 * * * *')).toBe(true);
    expect(looksCron('1 2 3 4 5')).toBe(false);
  });
});

describe('colours', () => {
  it('translucent text is laid over the background before measuring contrast', () => {
    const white = { r: 1, g: 1, b: 1, a: 1 };
    expect(contrast({ r: 0, g: 0, b: 0, a: 0.5 }, white)).toBeCloseTo(contrast({ r: 0.5, g: 0.5, b: 0.5, a: 1 }, white), 10);
    expect(contrast({ r: 0, g: 0, b: 0, a: 0 }, white)).toBeCloseTo(1, 10);
  });
  const toRgb = converter('rgb');
  it('formats agree with culori', () => {
    for (const s of ['#ff8800', '#0a0b0c80', 'rgb(10 200 30)', 'rgba(10, 20, 30, 0.5)', 'hsl(210 50% 40%)', 'hsl(0deg, 100%, 50%)', 'oklch(70% 0.1 150)', 'rebeccapurple']) {
      const ours = parseColor(s)!;
      const ref = toRgb(culoriParse(s))!;
      expect(Math.abs(ours.c.r - ref.r) + Math.abs(ours.c.g - ref.g) + Math.abs(ours.c.b - ref.b), s).toBeLessThan(1e-3);
      expect(formats(ours.c).hex.slice(0, 7), s).toBe(formatHex(ref));
    }
    const [L, C, H] = toOklch(parseColor('#ff8800')!.c);
    const ref = converter('oklch')('#ff8800')!;
    expect([L, C, H]).toEqual([expect.closeTo(ref.l, 4), expect.closeTo(ref.c, 4), expect.closeTo(ref.h!, 2)]);
  });
  it('out-of-gamut OKLCH is mapped and says so', () => {
    const p = parseColor('oklch(70% 0.4 150)')!;
    expect(p.mapped).toBe(true);
    expect([p.c.r, p.c.g, p.c.b].every((x) => x >= 0 && x <= 1)).toBe(true);
    expect(parseColor('oklch(70% 0.05 150)')!.mapped).toBe(false);
  });
  it('contrast ratio as WCAG defines it', () => {
    for (const [a, b] of [['#000', '#fff'], ['#777', '#fff'], ['#3d6df2', '#f6f6f4']]) {
      expect(contrast(parseColor(a)!.c, parseColor(b)!.c)).toBeCloseTo(wcagContrast(a, b), 4);
    }
    expect(contrast(parseColor('#000')!.c, parseColor('#fff')!.c)).toBeCloseTo(21, 6);
    expect(looksColor('#abc')).toBe(true);
    expect(looksColor('#abcde')).toBe(false);
    expect(parseColor('rgb(1 2)')).toBeNull();
  });
});

describe('cron editor model', () => {
  // The same schedule: every field allows the same values (and the same L / W / # rules).
  const same = (a: string, b: string, d: Dialect) => {
    const x = parseCron(a, d).f, y = parseCron(b, d).f;
    for (const k of ['sec', 'min', 'hour', 'dom', 'mon', 'dow', 'year'] as const) {
      const pick = (f: typeof x.min) => JSON.stringify([f.vals, f.last, f.nearestW, f.lastW, f.nth, f.star]);
      expect(pick(y[k]), `${a} → ${b}: ${k}`).toBe(pick(x[k]));
    }
  };
  it('reading and writing back keeps the schedule', () => {
    const cases: [string, Dialect][] = [
      ['* * * * *', 'unix'], ['*/5 * * * *', 'unix'], ['30 9 * * 1-5', 'unix'], ['0 0 1,15 * *', 'unix'], ['0 0 1 1 *', 'unix'],
      ['5 */2 * * *', 'unix'], ['0 8-18/2 * * mon-fri', 'unix'], ['0 0 * * 7', 'unix'], ['15 3 1-7 jan,jul *', 'unix'], ['@daily', 'unix'], ['@weekly', 'unix'],
      ['0 30 9 * * MON-FRI', 'spring'], ['*/10 * * * * *', 'spring'], ['0 0 12 ? * 2-6', 'quartz'], ['0 0 12 L * ?', 'quartz'], ['0 15 10 ? * 6L', 'quartz'],
      ['0 0 12 1W * ?', 'quartz'], ['0 0 12 ? * 2#1 2030', 'quartz'], ['0 0/15 8-17 ? * MON-FRI', 'quartz'],
    ];
    for (const [e, d] of cases) same(e, writeExpr(readExpr(e, d)!, d), d);
  });
  it('recognises the simple forms', () => {
    const p = (e: string, d: Dialect = 'unix') => presetOf(readExpr(e, d)!);
    expect([p('* * * * *'), p('*/15 * * * *'), p('7 * * * *'), p('7 */3 * * *'), p('0 9 * * *'), p('0 9 * * 1-5'), p('0 9 1,15 * *'), p('0 9 1 1,7 *')])
      .toEqual(['minute', 'everyN', 'hourly', 'hourly', 'daily', 'weekly', 'monthly', 'yearly']);
    expect([p('0 9-17 * * *'), p('0 9 * * 1#2'), p('5 0 9 * * *', 'spring'), p('0 0 9 L * ?', 'quartz')]).toEqual(['custom', 'custom', 'custom', 'monthly']);
    expect(readExpr('* * *', 'unix')).toBeNull();
  });
  it('switching form keeps the time and chosen days; Quartz gets its "?" and Sunday = 1', () => {
    const w = (p: Parameters<typeof toPreset>[0], e: string, d: Dialect = 'unix') => writeExpr(toPreset(p, readExpr(e, d)), d);
    expect(w('weekly', '30 7 * * *')).toBe('30 7 * * 1');
    expect(w('daily', '30 7 * * 1-5')).toBe('30 7 * * *');
    expect(w('monthly', '30 7 * * *')).toBe('30 7 1 * *');
    expect(w('yearly', '30 7 15 * *')).toBe('30 7 15 1 *');
    expect(w('hourly', '30 7 * * *')).toBe('30 * * * *');
    expect(w('everyN', '30 7 * * *')).toBe('*/5 * * * *');
    expect(w('weekly', '0 30 7 * * ?', 'quartz')).toBe('0 30 7 ? * 2');
    expect(w('daily', '0 30 7 * * ?', 'quartz')).toBe('0 30 7 * * ?');
    expect(writePart({ k: 'list', v: [5, 1, 2, 3, 6] }, 'dom', 'unix')).toBe('1-3,5,6');
    expect(writePart({ k: 'list', v: [0, 6] }, 'dow', 'quartz')).toBe('1,7');
  });
});
