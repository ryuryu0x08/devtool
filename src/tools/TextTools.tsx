// Text tools: line diff, regular expressions, case conversion, counts, line processing.
import { Fragment, useEffect, useMemo, useState, type ClipboardEvent, type ReactNode } from 'react';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { Kv } from '../components/Kv';
import { CopyBlock } from '../components/Kv';
import { Vis } from '../components/Vis';
import { useSettled } from '../components/useSettled';
import { Empty, ErrLine, Flag, Grid, OutCard, TextIn, TextOut, Toolbar, useOpt } from '../components/Panes';
import { diffText, type DLine } from '../lib/textdiff';
import { runRegexAsync, splitLiteral, type ReResult } from '../lib/regex';
import { CASES, convertLines } from '../lib/caseconv';
import { countText, type Counts } from '../lib/count';
import { processLines, type SortKind } from '../lib/textproc';

const DIFF_CAP = 4000;
const CONTEXT = 3;

type Row = { line: DLine } | { gap: number };

export function TextDiff() {
  const { S, set, T, replace } = useApp();
  const [ignoreWs, setWs] = useOpt('tdiff.ws', false);
  const [ignoreCase, setCase] = useOpt('tdiff.case', false);
  const [onlyDiff, setOnly] = useOpt('tdiff.only', false);
  const [a, pa] = useSettled(S.tdA);
  const [b, pb] = useSettled(S.tdB);
  const lines = useMemo(() => (a || b ? diffText(a, b, { ignoreWs, ignoreCase }) : null), [a, b, ignoreWs, ignoreCase]);
  const added = lines?.filter((l) => l.k === 'add').length ?? 0;
  const removed = lines?.filter((l) => l.k === 'del').length ?? 0;
  const rows = useMemo<Row[]>(() => {
    if (!lines) return [];
    if (!onlyDiff) return lines.map((line) => ({ line }));
    const near = new Array(lines.length).fill(false);
    lines.forEach((l, i) => { if (l.k !== 'same') for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) near[k] = true; });
    const out: Row[] = [];
    let gap = 0;
    lines.forEach((line, i) => {
      if (near[i]) { if (gap) out.push({ gap }); gap = 0; out.push({ line }); } else gap++;
    });
    if (gap) out.push({ gap });
    return out;
  }, [lines, onlyDiff]);
  const unified = useMemo(() => (lines ?? []).map((l) => (l.k === 'add' ? '+ ' : l.k === 'del' ? '- ' : '  ') + l.text).join('\n'), [lines]);
  const shown = rows.slice(0, DIFF_CAP);
  const edit = (k: 'tdA' | 'tdB') => (v: string) => set({ [k]: v, tdLast: k });
  const same = lines && !added && !removed;
  return (
    <div className="tool-stack">
      <Toolbar>
        <Flag on={ignoreWs} label={T.tdiff.ignoreWs} onClick={() => setWs(!ignoreWs)} />
        <Flag on={ignoreCase} label={T.tdiff.ignoreCase} onClick={() => setCase(!ignoreCase)} />
        <Flag on={onlyDiff} label={T.tdiff.onlyDiff} onClick={() => setOnly(!onlyDiff)} />
        <button className="btn" onClick={() => set({ tdA: S.tdB, tdB: S.tdA })}>⇄ {T.ui.swap}</button>
      </Toolbar>
      <Grid>
        <TextIn title={T.tdiff.a} value={S.tdA} placeholder={T.tdiff.ph} minH={200} onChange={edit('tdA')} onClear={() => replace({ tdA: '' })} />
        <TextIn title={T.tdiff.b} value={S.tdB} placeholder={T.tdiff.ph} minH={200} focus={false} onChange={edit('tdB')} onClear={() => replace({ tdB: '' })} />
      </Grid>
      <OutCard className="tdiff-out" status={pa || pb ? T.processing : !lines ? T.tdiff.need : same ? T.tdiff.same : f(T.tdiff.removed, { n: removed }) + '  ' + f(T.tdiff.added, { n: added })}
        notes={rows.length > DIFF_CAP ? [f(T.tdiff.capped, { n: DIFF_CAP, t: rows.length })] : []}>
        {!lines ? <Empty>{T.tdiff.need}</Empty> : (
          <CopyBlock value={unified}>
            {shown.map((r, i) => ('gap' in r
              ? <div key={i} className="td-gap">{f(T.tdiff.hidden, { n: r.gap })}</div>
              : (
                <div key={i} className={'td-row ' + r.line.k}>
                  <span className="n">{r.line.k !== 'add' ? r.line.a : ''}</span>
                  <span className="n">{r.line.k !== 'del' ? r.line.b : ''}</span>
                  <span className="m">{r.line.k === 'add' ? '+' : r.line.k === 'del' ? '−' : ''}</span>
                  <span className="t">{r.line.segs ? r.line.segs.map((s, k) => <span key={k} className={s.ch ? 'ch' : undefined}><Vis text={s.t} /></span>) : <Vis text={r.line.text || ' '} />}</span>
                </div>
              )))}
          </CopyBlock>
        )}
      </OutCard>
    </div>
  );
}

const FLAGS = ['g', 'i', 'm', 's', 'u', 'y'] as const;

export function Regex() {
  const { S, set, T, replace } = useApp();
  const [flags, setFlags] = useOpt<string>('re.flags', 'g');
  const [res, setRes] = useState<{ key: string; r: ReResult | 'timeout' } | null>(null);
  const [text] = useSettled(S.reText);
  const key = JSON.stringify([S.reSrc, flags, text, S.reRepl]);
  useEffect(() => {
    if (!S.reSrc) return;
    let live = true;
    const t = setTimeout(() => {
      runRegexAsync(S.reSrc, flags, text, S.reRepl ? S.reRepl : null).then((r) => live && setRes({ key, r }));
    }, 60);
    return () => { live = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = S.reSrc && res?.key === key ? res.r : null;
  const ok = r && r !== 'timeout' && !r.err ? r : null;
  const toggle = (c: string) => setFlags(flags.includes(c) ? flags.replace(c, '') : flags + c);
  const onPattern = (e: ClipboardEvent<HTMLInputElement>) => {
    const lit = splitLiteral(e.clipboardData.getData('text'));
    if (!lit || S.reSrc) return;
    e.preventDefault();
    set({ reSrc: lit.pattern });
    setFlags(lit.flags.replace('d', ''));
  };

  // Matches marked in the text, alternating colours so neighbours stay apart.
  const marked = useMemo(() => {
    if (!ok) return null;
    const out: ReactNode[] = [];
    let at = 0;
    ok.matches.forEach((m, k) => {
      if (m.i < at) return;
      out.push(<Vis key={'t' + k} text={text.slice(at, m.i)} />);
      out.push(<mark key={'m' + k} className={k % 2 ? 'mark-b' : 'mark-a'}>{m.text ? <Vis text={m.text} /> : '​'}</mark>);
      at = m.i + m.text.length;
    });
    out.push(<Vis key="end" text={text.slice(at)} />);
    return out;
  }, [ok, text]);

  const status = !S.reSrc ? T.result : !r ? T.processing : r === 'timeout' ? T.invalid : r.err ? T.invalid : r.total ? f(T.regex.matches, { n: r.total }) : T.regex.none;
  const notes = ok ? [...(!flags.includes('g') && !flags.includes('y') ? [T.regex.first] : []), ...(ok.total > ok.matches.length ? [f(T.regex.more, { n: ok.matches.length, t: ok.total })] : [])] : [];
  return (
    <div className="tool-stack">
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="mono" style={{ color: 'var(--faint)' }}>/</span>
          <input data-autofocus="1" className="field line mono" value={S.reSrc} spellCheck={false} placeholder={T.regex.patternPh} aria-label={T.regex.pattern}
            onChange={(e) => set({ reSrc: e.target.value })} onPaste={onPattern} style={{ flex: 1, minWidth: 0, fontFamily: "'Geist Mono', monospace" }} />
          <span className="mono" style={{ color: 'var(--faint)' }}>/{flags}</span>
          {S.reSrc && <button className="btn sm" onClick={() => replace({ reSrc: '' })}>{T.clear}</button>}
        </div>
        <Toolbar>
          {FLAGS.map((c) => <Flag key={c} on={flags.includes(c)} label={c + ' · ' + T.regex.flags[c]} onClick={() => toggle(c)} />)}
        </Toolbar>
        <input className="field line mono" value={S.reRepl} spellCheck={false} placeholder={T.regex.replPh} aria-label={T.regex.repl}
          onChange={(e) => set({ reRepl: e.target.value })} style={{ fontFamily: "'Geist Mono', monospace" }} />
      </section>
      <Grid>
        <TextIn title={T.regex.text} value={S.reText} placeholder={T.regex.textPh} focus={false} minH={200} onChange={(v) => set({ reText: v })} onClear={() => replace({ reText: '' })}>
          {marked && text && (
            <pre className="re-marked" style={{ margin: 0, padding: '12px 16px', borderTop: '1px solid var(--line)', font: "13px/1.65 'Geist Mono', 'PingFang SC', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 320, overflow: 'auto' }}>{marked}</pre>
          )}
        </TextIn>
        <OutCard className="re-out" status={status} bad={r === 'timeout' || !!r?.err} notes={notes}>
          {!S.reSrc ? <Empty /> : r === 'timeout' ? <ErrLine msg={T.regex.timeout} /> : r?.err ? <ErrLine msg={r.err} /> : ok && ok.matches.length ? (
            <div className="re-matches">
              {ok.matches.map((m, k) => (
                <Fragment key={k}>
                  <Kv label={'#' + (k + 1) + ' · ' + f(T.regex.at, { i: m.i })} value={m.text} />
                  {m.groups.map((g, gi) => (
                    <Kv key={gi} label={'  ' + T.regex.group + ' ' + g.name} value={g.value ?? ''} style={{ paddingLeft: 28 }} title={g.value === undefined ? T.regex.undef : undefined} />
                  ))}
                </Fragment>
              ))}
            </div>
          ) : ok ? <Empty>{T.regex.none}</Empty> : null}
        </OutCard>
      </Grid>
      {ok && ok.replaced !== undefined && S.reRepl && (
        <OutCard className="re-replaced" status={T.regex.replaced}><TextOut text={ok.replaced} /></OutCard>
      )}
    </div>
  );
}

export function CaseConv() {
  const { S, set, T, replace } = useApp();
  return (
    <Grid>
      <TextIn title={T.input} value={S.caseIn} placeholder={T.caseConv.ph} minH={260} onChange={(v) => set({ caseIn: v })} onClear={() => replace({ caseIn: '' })} />
      <OutCard status={T.result}>
        {S.caseIn.trim() ? <div className="case-rows">{CASES.map((k) => <Kv key={k} label={T.caseConv.names[k]} value={convertLines(S.caseIn, k)} />)}</div> : <Empty />}
      </OutCard>
    </Grid>
  );
}

const COUNT_KEYS: (keyof Counts)[] = ['graphemes', 'words', 'cjk', 'latinWords', 'lines', 'nonEmptyLines', 'paragraphs', 'spaces', 'codePoints', 'utf16', 'utf8'];

export function Count() {
  const { S, set, T, replace, lang } = useApp();
  const [text, pending] = useSettled(S.countIn);
  const c = useMemo(() => countText(text, lang), [text, lang]);
  return (
    <Grid>
      <TextIn title={T.input} value={S.countIn} placeholder={T.count.ph} mono={false} minH={300} onChange={(v) => set({ countIn: v })} onClear={() => replace({ countIn: '' })} />
      <OutCard status={pending ? T.processing : T.result}>
        <div className="count-rows">{COUNT_KEYS.map((k) => <Kv key={k} label={T.count[k]} value={c[k].toLocaleString('en-US')} />)}</div>
      </OutCard>
    </Grid>
  );
}

export function TextProc() {
  const { S, set, T, replace, lang } = useApp();
  const [trim, setTrim] = useOpt('proc.trim', true);
  const [dropBlank, setBlank] = useOpt('proc.blank', true);
  const [dedupe, setDedupe] = useOpt('proc.dedupe', false);
  const [ignoreCase, setCase] = useOpt('proc.case', false);
  const [sort, setSort] = useOpt<SortKind>('proc.sort', 'none', ['none', 'asc', 'desc', 'natural', 'length']);
  const [reverse, setReverse] = useOpt('proc.reverse', false);
  const [text, pending] = useSettled(S.procIn);
  const r = useMemo(() => (text ? processLines(text, { trim, dropBlank, dedupe, ignoreCase, sort, reverse }, lang) : null), [text, trim, dropBlank, dedupe, ignoreCase, sort, reverse, lang]);
  const inLines = text ? text.split('\n').length : 0;
  const notes = r ? [...(r.dupes ? [f(T.proc.dupes, { n: r.dupes })] : []), ...(r.blank ? [f(T.proc.blank, { n: r.blank })] : [])] : [];
  return (
    <div className="tool-stack">
      <Toolbar>
        <Flag on={trim} label={T.proc.trim} onClick={() => setTrim(!trim)} />
        <Flag on={dropBlank} label={T.proc.dropBlank} onClick={() => setBlank(!dropBlank)} />
        <Flag on={dedupe} label={T.proc.dedupe} onClick={() => setDedupe(!dedupe)} />
        <Flag on={ignoreCase} label={T.proc.ignoreCase} onClick={() => setCase(!ignoreCase)} />
        <Seg value={sort} onChange={setSort} opts={(['none', 'asc', 'desc', 'natural', 'length'] as const).map((k) => ({ value: k, label: T.proc.sort[k] }))} />
        <Flag on={reverse} label={T.proc.reverse} onClick={() => setReverse(!reverse)} />
      </Toolbar>
      <Grid>
        <TextIn title={T.input} value={S.procIn} placeholder={T.proc.ph} minH={300} size={S.procIn ? f(T.ui.lines, { n: S.procIn.split('\n').length }) : ''}
          onChange={(v) => set({ procIn: v })} onClear={() => replace({ procIn: '' })} />
        <OutCard status={pending ? T.processing : r ? f(T.proc.stats, { a: inLines, b: r.lines }) : T.result} notes={notes}>
          {r && !pending ? <TextOut text={r.text} /> : <Empty />}
        </OutCard>
      </Grid>
    </div>
  );
}
