// Two-way text tools: URL encoding, Unicode escapes, HTML entities, string escaping.
import { useMemo, type ReactNode } from 'react';
import { f } from '../i18n';
import { useApp, type State } from '../store';
import { Seg } from '../components/Seg';
import { useSettled } from '../components/useSettled';
import { Empty, ErrLine, Flag, Grid, OutCard, TextIn, TextOut, Toolbar, errStatus, useOpt } from '../components/Panes';
import { Vis, countInvisible } from '../components/Vis';
import { errInfo, wellFormed, type ErrInfo } from '../lib/data';
import { UrlError, looksPercent, urlDecode, urlEncode, type UrlMode } from '../lib/url';
import { UniError, charTable, escapeUnicode, looksUniEscaped, unescapeUnicode, type UniFmt } from '../lib/unicode';
import { decodeHtml, encodeHtml, looksHtmlEscaped, type HtmlEnc } from '../lib/htmlent';
import { EscError, escapeStr, unescapeStr, type EscLang } from '../lib/escape';

type Mode = 'enc' | 'dec';
interface Out { out?: string; err?: { msg: string; info: ErrInfo | null }; notes?: string[] }

/** Shared page: direction, input, result. The direction follows what is pasted into the empty box. */
function TwoWay(p: {
  id: string; inKey: keyof State; labels: [string, string]; placeholder: string;
  guess: (t: string) => boolean; options?: (m: Mode) => ReactNode; run: (t: string, m: Mode) => Out; below?: (t: string, m: Mode, o: Out) => ReactNode;
}) {
  const { S, set, T, replace, toast } = useApp();
  const [mode, setMode] = useOpt<Mode>(p.id + '.mode', 'enc', ['enc', 'dec']);
  const value = S[p.inKey] as string;
  const [text, pending] = useSettled(value);
  const r = useMemo(() => (text ? p.run(text, mode) : null), [text, mode, p.run]);
  const inv = r?.out ? countInvisible(r.out) : 0;
  const notes = [...(r?.notes ?? []), ...(inv && mode === 'dec' ? [f(T.invisibleChars, { n: inv })] : []), ...(r?.out && !wellFormed(r.out) ? [T.ui.loneSur] : [])];
  return (
    <div className="tool-stack">
      <Toolbar>
        <Seg value={mode} onChange={setMode} opts={[{ value: 'enc', label: p.labels[0] }, { value: 'dec', label: p.labels[1] }]} />
        {p.options?.(mode)}
      </Toolbar>
      <Grid>
        <TextIn title={T.input} value={value} placeholder={p.placeholder} size={value ? f(T.ui.chars, { n: [...value].length }) : ''}
          onChange={(v) => set({ [p.inKey]: v })} onClear={() => replace({ [p.inKey]: '' })}
          onFirstPaste={(t) => {
            const m: Mode = p.guess(t) ? 'dec' : 'enc';
            if (m !== mode) { setMode(m); toast(f(T.ui.switched, { m: m === 'dec' ? p.labels[1] : p.labels[0] }), 3000); }
          }} />
        <OutCard status={pending ? T.processing : r?.err ? errStatus(T, r.err.info) : r ? f(T.ui.chars, { n: [...(r.out ?? '')].length }) : T.result} bad={!!r?.err} notes={notes}>
          {r?.err ? <ErrLine msg={r.err.msg} info={r.err.info} /> : r && !pending ? <TextOut text={r.out ?? ''} /> : <Empty />}
        </OutCard>
      </Grid>
      {r && !pending && p.below?.(text, mode, r)}
    </div>
  );
}

const at = (e: { pos: number }, src: string) => errInfo({ pos: e.pos }, src);

export function UrlCodec() {
  const { T } = useApp();
  const [kind, setKind] = useOpt<UrlMode>('url.kind', 'component', ['component', 'uri', 'form']);
  const [plus, setPlus] = useOpt('url.plus', false);
  const run = useMemo(() => (t: string, m: Mode): Out => {
    if (m === 'enc') {
      const out = urlEncode(t, kind);
      return out === null ? { err: { msg: T.badText, info: null } } : { out };
    }
    try {
      const r = urlDecode(t, plus);
      const notes = [...(r.enc ? [T.url.gbk] : []), ...(!plus && r.plus ? [f(T.url.plusKept, { n: r.plus })] : [])];
      return { out: r.text, notes };
    } catch (e) {
      if (!(e instanceof UrlError)) throw e;
      return { err: { msg: e.code === 'pct' ? T.url.pct : T.url.utf8, info: at(e, t) } };
    }
  }, [kind, plus, T]);
  return (
    <TwoWay id="url" inKey="urlIn" labels={[T.ui.enc, T.ui.dec]} placeholder={T.url.ph} guess={looksPercent} run={run}
      options={(m) => (m === 'enc'
        ? <Seg value={kind} onChange={setKind} opts={[{ value: 'component', label: T.url.component, title: 'encodeURIComponent' }, { value: 'uri', label: T.url.uri, title: 'encodeURI' }, { value: 'form', label: T.url.form, title: 'application/x-www-form-urlencoded' }]} />
        : <Flag on={plus} label={T.url.plusSpace} onClick={() => setPlus(!plus)} />)} />
  );
}

export function UnicodeTool() {
  const { T } = useApp();
  const [fmt, setFmt] = useOpt<UniFmt>('uni.fmt', 'u4', ['u4', 'ubrace', 'html', 'cp']);
  const [all, setAll] = useOpt('uni.all', false);
  const run = useMemo(() => (t: string, m: Mode): Out => {
    if (m === 'enc') {
      const out = escapeUnicode(t, fmt, all);
      let back = '';
      try { back = unescapeUnicode(out).text; } catch { /* reported below */ }
      return { out, notes: back !== t && fmt !== 'cp' ? [T.uni.roundtrip] : [] };
    }
    try {
      const r = unescapeUnicode(t);
      return { out: r.text, notes: [f(T.uni.n, { n: r.n })] };
    } catch (e) {
      if (!(e instanceof UniError)) throw e;
      return { err: { msg: T.uni.bad, info: at(e, t) } };
    }
  }, [fmt, all, T]);
  return (
    <TwoWay id="uni" inKey="uniIn" labels={[T.ui.escape, T.ui.unescape]} placeholder={T.uni.ph} guess={looksUniEscaped} run={run}
      options={(m) => m === 'enc' && (<>
        <Seg value={fmt} onChange={setFmt} opts={[{ value: 'u4', label: '\\uXXXX' }, { value: 'ubrace', label: '\\u{…}' }, { value: 'html', label: '&#x…;' }, { value: 'cp', label: 'U+XXXX' }]} />
        <Flag on={all} label={T.uni.all} onClick={() => setAll(!all)} />
      </>)}
      below={(t, m, o) => {
        const src = m === 'enc' ? t : o.out ?? '';
        const rows = charTable(src);
        if (!rows.length) return null;
        return (
          <section className="card" style={{ padding: '10px 16px', overflow: 'auto' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, margin: '4px 0 8px' }}>{f(T.uni.table, { n: rows.length })}</div>
            <table className="tbl uni-table">
              <thead><tr><th>{T.uni.ch}</th><th>{T.uni.cp}</th><th>UTF-8</th><th>UTF-16</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}><td><Vis text={r.ch} /></td><td>{r.cp}</td><td>{r.utf8}</td><td>{r.utf16}</td></tr>)}</tbody>
            </table>
          </section>
        );
      }} />
  );
}

export function HtmlEntities() {
  const { T } = useApp();
  const [mode, setMode] = useOpt<HtmlEnc>('html.enc', 'min', ['min', 'nonascii', 'named']);
  const run = useMemo(() => (t: string, m: Mode): Out => {
    if (m === 'enc') return { out: encodeHtml(t, mode) };
    const r = decodeHtml(t);
    return { out: r.text, notes: [f(T.html.n, { n: r.n }), ...(r.legacy ? [f(T.html.legacy, { n: r.legacy })] : [])] };
  }, [mode, T]);
  return (
    <TwoWay id="html" inKey="htmlIn" labels={[T.ui.enc, T.ui.dec]} placeholder={T.html.ph} guess={looksHtmlEscaped} run={run}
      options={(m) => m === 'enc' && <Seg value={mode} onChange={setMode} opts={[{ value: 'min', label: T.html.min }, { value: 'nonascii', label: T.html.nonascii }, { value: 'named', label: T.html.named }]} />} />
  );
}

const LANGS: { value: EscLang; label: string }[] = [
  { value: 'json', label: 'JSON' }, { value: 'js', label: 'JavaScript' }, { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' }, { value: 'sql', label: 'SQL' }, { value: 'shell', label: 'Shell' },
];

/** Text that is clearly escaped (backslash escapes, a quoted shell word): pasted, it is unescaped. */
export const looksEscaped = (t: string, lang: string) => /\\[nrt"'\\u]/.test(t) || (lang === 'shell' && /^'.*'$/s.test(t.trim()));

export function EscapeTool() {
  const { T } = useApp();
  const [lang, setLang] = useOpt<EscLang>('esc.lang', 'json', LANGS.map((l) => l.value));
  const label = LANGS.find((l) => l.value === lang)!.label;
  const run = useMemo(() => (t: string, m: Mode): Out => {
    const note = lang === 'sql' ? [T.esc.sqlNote] : lang === 'shell' && m === 'enc' ? [T.esc.shellNote] : [];
    try {
      if (m === 'enc') {
        if (!wellFormed(t) && (lang === 'shell' || lang === 'c')) return { err: { msg: T.badText, info: null } };
        return { out: escapeStr(t, lang), notes: note };
      }
      // A whole string literal pasted with its quotes: the quotes are the syntax, not the text.
      const q = lang === 'json' || lang === 'java' || lang === 'c' ? '"' : lang === 'sql' ? "'" : lang === 'js' ? t[0] : '';
      const wrapped = !!q && /^["']$/.test(q) && t.length >= 2 && t[0] === q && t[t.length - 1] === q;
      try {
        const r = unescapeStr(wrapped ? t.slice(1, -1) : t, lang);
        return { out: r.text, notes: [...note, ...(r.words && r.words > 1 ? [f(T.esc.words, { n: r.words })] : [])] };
      } catch (e) {
        if (e instanceof EscError && wrapped) throw new EscError(e.code, e.pos + 1);
        throw e;
      }
    } catch (e) {
      if (!(e instanceof EscError)) throw e;
      return { err: { msg: f(T.esc.e[e.code], { l: label }), info: e.code === 'utf8' ? null : at(e, t) } };
    }
  }, [lang, label, T]);
  const guess = (t: string) => looksEscaped(t, lang);
  return (
    <TwoWay id="esc" inKey="escIn" labels={[T.ui.escape, T.ui.unescape]} placeholder={T.esc.ph} guess={guess} run={run}
      options={() => <Seg value={lang} onChange={setLang} opts={LANGS} />} />
  );
}
