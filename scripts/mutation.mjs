// Mutation testing: plant one known bug at a time and check that the tests catch it.
// A mutant the tests miss means a guarantee nothing verifies.
//
//   npm run test:mutation            all mutants (unit ones via vitest, UI ones via Playwright)
//   npm run test:mutation -- --unit  only the vitest mutants (fast)
//   npm run test:mutation -- --check only check that every pattern still matches the code
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** [name, file, code, replacement, tests] — tests: 'unit', or a Playwright -g pattern. */
const M = [
  // Diff: nothing missed, nothing rounded.
  ['diff: added object keys ignored', 'src/lib/data.ts', 'Object.keys(b).forEach((k) => { if (!hasOwn(a, k)) ks.push(k); });', '', 'unit'],
  ['diff: numbers compared as doubles', 'src/lib/data.ts', "if (v instanceof Num) return 'n' + numKey(v)", "if (v instanceof Num) return 'n' + String(Number(v.raw.replace(/_/g, '')))", 'unit'],
  ['diff: trailing zeros not normalised', 'src/lib/data.ts', 'if (t) { digits = digits.slice(0, -t); exp += BigInt(t); }', '', 'unit'],
  ['diff: extra array elements dropped', 'src/lib/data.ts', 'for (let k = 0; k < Math.max(ei - pi, ej - pj); k++)', 'for (let k = 0; k < Math.min(ei - pi, ej - pj); k++)', 'unit'],
  ['diff: ignore-order reuses a match', 'src/lib/data.ts', 'const match = ka.map((k) => pool.get(k)?.shift());', 'const match = ka.map((k) => pool.get(k)?.[0]);', 'unit'],
  ['diff: written-differently never reported', 'src/lib/data.ts', 'if (ra !== undefined && rb !== undefined && ra !== rb) n.fmt = [ra, rb];', '', 'unit'],
  ['diff: key spelling never reported', 'src/lib/data.ts', 'c.keyFmt = [ka, kb];', '', 'unit'],
  ['diff: B paths wrong after insert', 'src/lib/data.ts', 'o, jb, cp(pathB, jb, true)));', 'o, jb, cp(pathB, ia, true)));', 'unit'],
  ['diff: dates compared as raw text', 'src/lib/data.ts', "if (v instanceof DateTime) return 'd' + dateKey(v.raw);", "if (v instanceof DateTime) return 'd' + v.raw;", 'unit'],
  ['diff: TOML int/float not distinguished', 'src/lib/data.ts', "+ (o.typed ? (v.kind === 'int' ? 'i' : 'f') : '')", '', 'unit'],
  ['diff: type change not explained', 'src/lib/data.ts', 'if (ka !== kb) return { kinds: [ka, kb] };', '', 'unit'],
  ['diff: same instant not recognised', 'src/lib/data.ts', 'if (ia !== null && ia === instant((b as DateTime).raw)) return { sameInstant: true };', '', 'unit'],
  ['diff: whitespace in values collapsed', 'src/tools/Diff.tsx', "<span style={{ color: r.valColor, wordBreak: 'break-all', whiteSpace: 'pre-wrap', textDecoration: r.deco }}>", "<span style={{ color: r.valColor, wordBreak: 'break-all', textDecoration: r.deco }}>", 'whitespace inside values'],
  ['diff: type note not shown', 'src/tools/Diff.tsx', "isChg: true, newText: tb, meta: [b.meta, noteFor(nd.a, nd.b, typed, T)].filter(Boolean).join(' · ') });", 'isChg: true, newText: tb });', 'look alike'],
  // Formatting: only whitespace changes.
  ['JSON: keys re-escaped on output', 'src/lib/json.ts', "? x.e.map((e) => e.kRaw + (gap ? ': ' : ':') + out(e.v, inner))", "? x.e.map((e) => JSON.stringify(e.k) + (gap ? ': ' : ':') + out(e.v, inner))", 'unit'],
  ['JSON: verify ignores number text', 'src/lib/json.ts', '  return x.raw === (y as typeof x).raw;', "  return x.t === 'num' || x.raw === (y as typeof x).raw;", 'unit'],
  ['JSON: sort not stable for duplicates', 'src/lib/json.ts', 'const byKey = (a: JEntry, b: JEntry) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);', 'const byKey = (a: JEntry, b: JEntry) => (a.k <= b.k ? -1 : 1);', 'unit'],
  ['JSON: duplicate keys not detected', 'src/lib/json.ts', '      if (seen.has(e.k)) out.push(p);', '', 'unit'],
  ['TOML→JSON: hex not converted', 'src/lib/json.ts', "return x.kind === 'int' ? BigInt(r).toString() : r;", 'return r;', 'unit'],
  ['TOML: trailing comments in arrays dropped', 'src/lib/toml.ts', "out.push(inner + one(p) + ',' + (p.after !== undefined ? ' ' + p.after : ''));", "out.push(inner + one(p) + ',');", 'unit'],
  ['TOML: extra quotes in multi-line strings lost', 'src/lib/toml.ts', '    return q.repeat(c - 3);', "    return '';", 'unit'],
  ['TOML: verify skips comments', 'src/lib/toml.ts', "  if (ca.length !== cb.length || ca.some((c, i) => c !== cb[i])) throw new VerifyError('#');", '', 'unit'],
  ['TOML: verify skips literals', 'src/lib/toml.ts', '  if (p) throw new VerifyError(p);', '', 'unit'],
  ['TOML: line-ending backslash not trimmed', 'src/lib/toml.ts', "          while (i < n && (s[i] === ' ' || s[i] === '\\t' || s[i] === '\\n' || s[i] === '\\r')) i++;", '', 'unit'],
  // Conversion refuses what the target can't hold exactly.
  ['JSON→TOML: precision check removed', 'src/lib/toml.ts', "    if (numKey(String(f)) !== numKey(x)) throw new ConvertError('floatPrecision', path, x.raw + ' → ' + String(f));", '', 'unit'],
  ['JSON→TOML: int64 check removed', 'src/lib/toml.ts', "      if (b < I64_MIN || b > I64_MAX) throw new ConvertError('intRange', path, x.raw);", '', 'unit'],
  // Errors are shown where they are, invisible characters named.
  ['error: marked character off by one', 'src/lib/data.ts', "before = (st ? '…' : '') + Ln.slice(st, i);", "before = (st ? '…' : '') + Ln.slice(st, i + 1);", 'unit'],
  ['error: invisible character in message not named', 'src/tools/Formatter.tsx', '<Vis text={err.msg} />', '{err.msg}', 'invisible character that breaks'],
  // Time.
  ['time: ns digits dropped', 'src/lib/time.ts', "  let sub = rest.replace(/0+$/, '');", "  let sub = '';", 'unit'],
  ['time: DST overlap not reported', 'src/lib/time.ts', 'if (hits.length) return hits.length > 1 ? { ms: hits[0], alt: hits[hits.length - 1] } : { ms: hits[0] };', 'if (hits.length) return { ms: hits[0] };', 'unit'],
  ['time: impossible dates accepted', 'src/lib/time.ts', 'if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { err: true };', 'if (mo < 1 || mo > 12 || d < 1 || d > 31) return { err: true };', 'unit'],
  ['time: English dates via browser zone', 'src/lib/time.ts', '    if (off === null) return wall(y, mo, d, t);', '    if (off === null) return { ms: utc(y, mo, d, t[0], t[1], t[2], t[3]) + new Date(utc(y, mo, d)).getTimezoneOffset() * 60000 };', 'unit'],
  ['time: Z offset not understood', 'src/lib/time.ts', "  if (o === 'z') return 0;", '', 'unit'],
  ['time: offset seconds rounded away', 'src/lib/time.ts', "(sec ? ':' + pad2(sec) : '')", "''", 'unit'],
  ['time: full-width digits not read', 'src/lib/time.ts', 'const s = halfWidth(String(raw)).trim()', 'const s = String(raw).trim()', 'unit'],
  // Input and output.
  ['time: current date-time not copyable', 'src/tools/Timestamp.tsx', '{[nowS, String(now), nowWall].map(', '{[nowS, String(now)].map(', 'current time'],
  ['UTF-8: invalid bytes accepted', 'src/lib/data.ts', "new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })", "new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })", 'unit'],
  ['clipboard: lone surrogates not detected', 'src/lib/data.ts', '      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;', '', 'unit'],
  ['copy: failure reported as success', 'src/App.tsx', '      if (ok) done();\n      else toast(t.copyFail, 5000);', '      done();', 'clipboard refuses'],
  ['focus: autofocus steals from another field', 'src/App.tsx', 'if (el && !typing && !ref.current.palette) el.focus();', 'if (el && !ref.current.palette) el.focus();', 'never steals'],
  ['toast: long message runs off a phone screen', 'src/styles.css', 'max-width: calc(100vw - 32px);', 'max-width: none; white-space: nowrap;', 'long message stays'],
  // Hashes and Base64.
  ['MD5: wrong shift', 'src/lib/hash.ts', 'const MD5_S = [7, 12, 17, 22,', 'const MD5_S = [7, 12, 17, 21,', 'unit'],
  ['SHA-1: wrong rotation', 'src/lib/hash.ts', '      c = rotl(B, 30);', '      c = rotl(B, 29);', 'unit'],
  ['SHA-256: wrong constant', 'src/lib/hash.ts', '0x428a2f98', '0x428a2f99', 'unit'],
  ['hash: length wraps after 512 MB', 'src/lib/hash.ts', 'return [Math.floor(n / 0x20000000) >>> 0, ((n % 0x20000000) * 8) >>> 0];', 'return [0, (n * 8) >>> 0];', 'unit'],
  ['hash: last full block of a chunk skipped', 'src/lib/hash.ts', 'for (; i + 64 <= d.length; i += 64) this.block(d, i);', 'for (; i + 64 < d.length; i += 64) this.block(d, i);', 'unit'],
  ['hash: check always says "matches"', 'src/lib/hash.ts', 'return { ok: d[algo].every((x, i) => x === bytes![i]), algo, form };', 'return { ok: true, algo, form };', 'unit'],
  ['Base64: non-canonical bits not reported', 'src/lib/b64.ts', "    if (vals[q + 1] & 15) notes.push({ k: 'bits' });", '', 'unit'],
  ['Base64: mixed alphabets accepted', 'src/lib/b64.ts', "if (url) throw new B64Error('mixed', p); std = true;", 'std = true;', 'unit'],
  ['Base64: data after = accepted', 'src/lib/b64.ts', "    if (pad) throw new B64Error('pad', padAt);", '', 'unit'],
  ['Base64: ignored whitespace not reported', 'src/lib/b64.ts', "  if (spaces) notes.push({ k: 'ws', n: spaces });", '', 'unit'],
  ['text: CRLF choice ignored', 'src/lib/data.ts', "eol === 'crlf' ? s.replace(/\\r?\\n/g, '\\r\\n') : s", 's', 'unit'],
  ['text: lone surrogates encoded as U+FFFD', 'src/lib/data.ts', '  if (!wellFormed(s)) return null;\n  return new TextEncoder()', '  return new TextEncoder()', 'unit'],
  ['paste: CRLF in pasted text not reported', 'src/components/Source.tsx', "if (t.includes('\\r')) p.onCr?.();", '', 'CRLF text says'],
  ['paste: a blank-area paste always leaves the current tool', 'src/App.tsx', 'if (!takeText(text)) routeText(text);', 'routeText(text);', 'blank area fills this tool'],
  // Shortest path: the result copies itself; pastes and files land where they are useful.
  ['copy: a result row is not clickable', 'src/components/Kv.tsx', '<button className="kv" title={T.clickCopy} onClick={() => copy(value)} {...rest}>', '<button className="kv" {...rest}>', 'click anywhere on a row'],
  ['copy: a result block does not copy on click', 'src/components/Kv.tsx', '    copy(value);\n  };\n  const onKey', '  };\n  const onKey', 'result block'],
  ['copy: dragging to select part still copies everything', 'src/components/Kv.tsx', '    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;\n', '', 'result block'],
  ['diff: every paste fills A', 'src/App.tsx', "const side = s.diffLast === 'diffA' ? 'diffB' : 'diffA';", "const side = 'diffA';", 'two pastes fill A'],
  ['hash: a pasted checksum is hashed, not checked', 'src/App.tsx', 'if (hashLike(n.text) && (s.hashFile || s.hashIn))', 'if (false)', 'pasted checksum is checked'],
  ['Base64: direction not chosen from the content', 'src/App.tsx', "const mode = looksB64(n.text) ? 'dec' : 'enc';", 'const mode = s.b64Mode;', 'direction follows the content'],
  ['undo: a replaced file cannot be brought back', 'src/App.tsx', '      if (FILE_KEYS.includes(k) && s[k] && s[k] !== patch[k]) lost = true;\n', '', 'Undo brings the file back'],
  ['Base64 guess: any Base64-shaped word taken for Base64', 'src/lib/b64.ts', "    return text !== null && !/[\\u0000-\\u0008\\u000e-\\u001f\\u007f]/.test(text);", '    return true;', 'unit'],
  // QR.
  ['QR: no feedback while an image is being copied', 'src/tools/Qr.tsx', '    toast(T.imgCopying, 60_000);\n', '', 'at once'],
  ['QR: huge text handed to the library (page freezes)', 'src/lib/qr.ts', "  if (text.length > QR_MAX_BYTES[ec] || new TextEncoder().encode(text).length > QR_MAX_BYTES[ec]) return { err: 'long' };", '', 'unit'],
  ['QR: GBK not tried', 'src/lib/qr.ts', "for (const enc of ['utf-8', 'gb18030', 'shift_jis']) {", "for (const enc of ['utf-8', 'shift_jis']) {", 'unit'],
  ['QR: no tiles (codes side by side missed)', 'src/lib/qr.ts', '  if (!tiles) return out;', '  return out;', 'several codes'],
  ['QR: files without a type refused', 'src/App.tsx', 'if (!file || (file.type && !/^image\\//.test(file.type)))', 'if (!file || !/^image\\//.test(file.type))', 'generate → download → scan'],
  // Second round of tools: encoders, formatters, text and time.
  ['URL: GB18030 fallback removed', 'src/lib/url.ts', "  try { return { text: new TextDecoder('gb18030', { fatal: true }).decode(b), enc: 'GB18030', plus }; } catch { /* neither */ }", '', 'unit'],
  ['Unicode: astral characters escaped as one \\u', 'src/lib/unicode.ts', "    else if (cp > 0xffff) out += '\\\\u' + hex(0xd800 + ((cp - 0x10000) >> 10)) + '\\\\u' + hex(0xdc00 + ((cp - 0x10000) & 0x3ff));", '', 'unit'],
  ['Hex: a stray letter reported as an odd digit count', 'src/lib/hex.ts', "    if (j < s.length && !/[\\s:,;\\-_]/.test(s[j]) && s[j] !== '\\\\' && !(s[j] === '0' && /[xX]/.test(s[j + 1] || ''))) throw new HexError('char', j, String.fromCodePoint(s.codePointAt(j)!));", '', 'unit'],
  ['bases: signed view wrong', 'src/lib/numbase.ts', '    const signed = unsigned >= max >> 1n ? unsigned - max : unsigned;', '    const signed = unsigned;', 'unit'],
  ['C escape: trigraphs written out', 'src/lib/escape.ts', "    } else if (lang === 'c' && c === '?' && s[i - 1] === '?') out += '\\\\?'; // never \"??\" (a trigraph)", '    }', 'unit'],
  ['JWT: any signature accepted', 'src/lib/jwt.ts', "    return (await subtle.verify(algo, k, j.sig as BufferSource, data)) ? 'ok' : 'bad';", "    return 'ok';", 'unit'],
  ['YAML: numbers re-spelled by the library', 'src/lib/yamlfmt.ts', 'uniqueKeys: true, customTags: keepSource,', 'uniqueKeys: true,', 'unit'],
  ['XML: output not verified', 'src/lib/xml.ts', '  if (canon(parse(src)) !== canon(again)) throw new XmlVerifyError();', '', 'unit'],
  ["SQL: PostgreSQL E'…' strings mis-read", 'src/lib/sqlfmt.ts', "    const bsHere = backslash || (q === \"'\" && !!prev && prev.k === 'w' && /^[eE]$/.test(prev.t) && prev.pos + 1 === i);", '    const bsHere = backslash;', 'unit'],
  ['Schema: inexact numbers not reported', 'src/lib/schema.ts', "  if (n.t === 'num' && numKey(n.raw) !== numKey(String(Number(n.raw)))) out.push(path + ' = ' + n.raw);", "  if (n.t === 'num') { /* not checked */ }", 'unit'],
  ['text diff: changed characters not marked', 'src/lib/textdiff.ts', "segs: cd.filter((c) => !c.removed).map((c) => ({ t: c.value, ch: !!c.added })) });", "segs: [{ t: y, ch: false }] });", 'unit'],
  ['line sort: equal lines reordered', 'src/lib/textproc.ts', '      return c || x[1] - y[1];', '      return c || y[1] - x[1];', 'unit'],
  ['count: characters counted as code points', 'src/lib/count.ts', "  const seg = new Intl.Segmenter(locale, { granularity: 'grapheme' });", "  const seg = { segment: (x: string) => [...x] };", 'unit'],
  ['UUID v7: a batch is not in order', 'src/lib/uuid.ts', '  if (ms <= last.ms) { ms = last.ms; rand = last.rand + 1n; }', '  if (false) { ms = last.ms; rand = last.rand + 1n; }', 'unit'],
  ['cron: Unix day-of-month OR day-of-week read as AND', 'src/lib/cron.ts', '    return domMatch(dom, y, m, d) || dowMatch(dow, y, m, d);', '    return domMatch(dom, y, m, d) && dowMatch(dow, y, m, d);', 'unit'],
  ['cron: times skipped by DST still listed', 'src/lib/cron.ts', '          if (w.gap) { skipped++; continue; }', '', 'unit'],
  ['contrast: translucent text not laid over the background', 'src/lib/color.ts', 'const over = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };', 'const over = { ...fg, a: 1 };', 'unit'],
  ['Snowflake: wrong shift', 'src/lib/ids.ts', '  return Number(v >> 22n) + SNOWFLAKE_EPOCHS[kind];', '  return Number(v >> 20n) + SNOWFLAKE_EPOCHS[kind];', 'unit'],
  // Their pages: pastes, keys, limits.
  ['JWT: the key is stored', 'src/store.tsx', "'colorIn', 'colorFg', 'colorBg'];", "'colorIn', 'colorFg', 'colorBg', 'jwtKey'];", 'never stored'],
  ['regex: a runaway pattern is never stopped', 'src/lib/regex.ts', 'repl: string | null, ms = 1500)', 'repl: string | null, ms = 600_000)', 'runaway patterns stop'],
  ['text diff: every paste fills A', 'src/App.tsx', "const side = s.tdLast === 'tdA' ? 'tdB' : 'tdA';", "const side = 'tdA';", 'pastes fill A, then B'],
  ['paste: escaped text not decoded when routed', 'src/App.tsx', "o: { ...ref.current.o, [d + '.mode']: 'dec' } };", '};', 'escaped text is opened decoded'],
  ['paste: a one-kind tool keeps any paste', 'src/App.tsx', '    if (ty && ty[1]()) { replace({ [ty[0]]: one }, msg()); return true; }', '    if (ty) { replace({ [ty[0]]: one }, msg()); return true; }', 'keeps only that kind'],
  ['escape: a pasted quoted literal is not unwrapped', 'src/tools/EncodeTools.tsx', "      const wrapped = !!q && /^[\"']$/.test(q) && t.length >= 2 && t[0] === q && t[t.length - 1] === q;", '      const wrapped = false;', 'pasted escaped text is unescaped'],
  ['contrast: ratio rounded up past a threshold', 'src/tools/CronColor.tsx', "const r2 = ratio === null ? '' : String(Math.floor(ratio * 100) / 100);", "const r2 = ratio === null ? '' : ratio.toFixed(1);", 'contrast checks'],
  // Layout and number bases.
  ['layout: one layout shared by every tool', 'src/components/Split.tsx', "useOpt<Mode>('lay.' + key, 'row', ['row', 'col'])", "useOpt<Mode>('lay', 'row', ['row', 'col'])", 'each tool remembers'],
  ['layout: stacked panes stay half width', 'src/components/Split.tsx', "{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', rowGap: GAP }", "{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', rowGap: GAP }", 'each tool remembers'],
  ['layout: a pane can be squeezed to nothing', 'src/components/Split.tsx', '    return Math.min(1 - lo, Math.max(lo, r));', '    return r;', 'share the width'],
  ['layout: narrow screens keep side by side', 'src/components/Split.tsx', "  const shown: Mode = narrow ? 'col' : mode;", '  const shown: Mode = mode;', 'always stacked'],
  ['bases: the other boxes do not follow', 'src/tools/BytesTools.tsx', '    if (!ok) return \'\';\n    const t = writeInt(ok.v, baseOf(k));', "    if (!ok) return '';\n    const t = writeInt(ok.v, Number(src === 'n' ? custom : src));", 'editing any one updates'],
  ['bases: a click does not select the number', 'src/tools/BytesTools.tsx', 'onFocus={(e) => { e.currentTarget.select(); fresh.current = true; }}', 'onFocus={() => { fresh.current = true; }}', 'editing any one updates'],
];

const args = process.argv.slice(2);
const only = args.includes('--unit') ? 'unit' : null;
const run = (cmd, a) => {
  try { execFileSync(cmd, a, { stdio: 'ignore', timeout: 600_000 }); return true; } catch { return false; }
};

let bad = 0;
for (const [name, file, from] of M) {
  const n = readFileSync(file, 'utf8').split(from).length - 1;
  if (n !== 1) { console.log(`PATTERN ${n === 0 ? 'NOT FOUND' : 'AMBIGUOUS'}: ${name} (${file})`); bad++; }
}
// A test pattern that matches nothing would make Playwright fail and count the mutant as caught.
const greps = [...new Set(M.map((m) => m[4]).filter((t) => t !== 'unit'))];
for (const g of greps) {
  const out = execFileSync('npx', ['playwright', 'test', '--list', '-g', g], { encoding: 'utf8' });
  if (!/Total: [1-9]/.test(out)) { console.log(`NO E2E TEST MATCHES: ${g}`); bad++; }
}
if (bad) process.exit(1);
if (args.includes('--check')) { console.log(`${M.length} patterns OK, ${greps.length} e2e test patterns OK`); process.exit(0); }

// Every mutant must be caught by tests that pass on the unmodified code.
const base = only ? run('npx', ['vitest', 'run']) : run('npx', ['vitest', 'run']) && run('npx', ['playwright', 'test', '-g', greps.join('|')]);
if (!base) { console.log('The tests fail on the unmodified code; fix that first.'); process.exit(1); }

const missed = [];
let ran = 0;
for (const [name, file, from, to, tests] of M) {
  if (only && tests !== only) continue;
  const src = readFileSync(file, 'utf8');
  writeFileSync(file, src.replace(from, () => to));
  let passed;
  try {
    passed = tests === 'unit' ? run('npx', ['vitest', 'run', '--bail=1']) : run('npx', ['playwright', 'test', '-g', tests, '--max-failures=1']);
  } finally {
    writeFileSync(file, src);
  }
  ran++;
  console.log((passed ? 'MISSED  ' : 'caught  ') + name);
  if (passed) missed.push(name);
}
console.log(`\n${ran} mutants, ${missed.length} missed`);
process.exit(missed.length ? 1 : 0);
