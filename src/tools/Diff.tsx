import { useMemo } from 'react';
import { SAMPLE_A, SAMPLE_B, f, type Dict } from '../i18n';
import { useApp } from '../store';
import { Seg, Toggle } from '../components/Seg';
import { useSettled } from '../components/useSettled';
import { Vis } from '../components/Vis';
import { ConvertError, changeNote, changePair, diffNode, errInfo, isCont, preview, prim, windowPair, type DiffNode, type ErrInfo } from '../lib/data';
import { jsonValue, parseJsonAst } from '../lib/json';
import { TomlMismatch, TomlSyntaxError, parseTomlDoc } from '../lib/toml';

type Parsed =
  | { empty: true }
  | { bad: ErrInfo }
  | { v: unknown; lang: 'JSON' | 'TOML'; raw: Map<string, string>; keys: Map<string, string>; bom: boolean };

const plainErr = (msg: string): ErrInfo => ({ msg, line: null, col: null, before: '', at: '', after: '' });

function parseAny(src: string, T: Dict): Parsed {
  if (!src.trim()) return { empty: true };
  let jsonErr: unknown;
  try {
    const { ast, bom } = parseJsonAst(src);
    try {
      const { v, raw, keys } = jsonValue(ast);
      return { v, raw, keys, lang: 'JSON', bom };
    } catch (e) {
      // Duplicate keys: which value counts is undefined, so don't guess.
      if (e instanceof ConvertError) return { bad: plainErr(f(T.cv.dupKey, { p: e.path })) };
      throw e;
    }
  } catch (e) { jsonErr = e; }
  try {
    const doc = parseTomlDoc(src);
    return { v: doc.value, raw: doc.raw, keys: doc.keys, lang: 'TOML', bom: doc.bom };
  } catch (e) {
    if (e instanceof TomlMismatch) return { bad: plainErr(f(T.tomlMismatch, { p: e.path })) };
    // Report the error from whichever parser got further — that's the format the text is meant to be.
    const j = errInfo(jsonErr, src), t = errInfo(e, src);
    if (e instanceof TomlSyntaxError) t.msg = f(T.tomlUnsupported, { m: t.msg });
    const at = (x: ErrInfo) => (x.line ?? 0) * 1e6 + (x.col ?? 0);
    return { bad: at(t) > at(j) ? t : j };
  }
}

const DIFF_CAP = 4000;

interface DRow {
  indent: number; keyText: string; keyColor: string; colon: string; mark: string; markColor: string; bg: string;
  caret: string; togglePath?: string; meta: string; deco: string; isChg: boolean; newText: string; newColor: string; valText: string; valColor: string;
}
interface DItem { mark: string; color: string; path: string; pathB: string | null; oldText: string | null; newText: string | null; fmt: boolean; note: string }

/** Why a change may look like none: a type change, or the same instant with another offset. */
function noteFor(a: unknown, b: unknown, typed: boolean, T: Dict): string {
  const n = changeNote(a, b, typed);
  return !n ? '' : 'sameInstant' in n ? T.sameInstant : f(T.typeChg, { a: T.vk[n.kinds[0]], b: T.vk[n.kinds[1]] });
}

function buildDiff(root: DiffNode, col: Record<string, boolean>, onlyDiff: boolean, typed: boolean, T: Dict) {
  const rows: DRow[] = [], list: DItem[] = [];
  let nA = 0, nD = 0, nC = 0, nF = 0;
  const moved = (nd: DiffNode) => (nd.pathB && nd.pathB !== nd.path ? nd.pathB : null);
  const coll = (nd: DiffNode) => {
    if (nd.keyFmt) {
      nF++;
      list.push({ mark: '≈', color: 'var(--mut)', path: nd.path, pathB: moved(nd), oldText: nd.keyFmt[0], newText: nd.keyFmt[1], fmt: true, note: T.keyFmtOnly });
    }
    if (nd.st === 'add') { nA++; list.push({ mark: '+', color: 'var(--add)', path: nd.path, pathB: null, oldText: null, newText: preview(nd.b), fmt: false, note: '' }); }
    else if (nd.st === 'del') { nD++; list.push({ mark: '−', color: 'var(--del)', path: nd.path, pathB: null, oldText: preview(nd.a), newText: null, fmt: false, note: '' }); }
    else if (nd.st === 'chg') {
      nC++;
      const [ta, tb] = changePair(nd.a, nd.b);
      // After array insertions / removals the element sits at a different index in B.
      list.push({ mark: '~', color: 'var(--chg)', path: nd.path, pathB: moved(nd), oldText: ta, newText: tb, fmt: false, note: noteFor(nd.a, nd.b, typed, T) });
    } else if (nd.fmt) {
      nF++;
      const [ta, tb] = windowPair(nd.fmt[0], nd.fmt[1]);
      list.push({ mark: '≈', color: 'var(--mut)', path: nd.path, pathB: moved(nd), oldText: ta, newText: tb, fmt: true, note: T.fmtOnly });
    }
    nd.ch?.forEach(coll);
  };
  coll(root);
  const cnt = (nd: DiffNode): number =>
    (nd.keyFmt ? 1 : 0) + (nd.ch ? nd.ch.reduce((a, c) => a + cnt(c), 0) : nd.st === 'same' ? (nd.fmt ? 1 : 0) : 1);
  const base = (key: DiffNode['key'], depth: number, isIdx: boolean, keyB: DiffNode['key'] = key): DRow => ({
    indent: depth * 18, keyText: key === null ? '' : !isIdx ? JSON.stringify(key) : keyB === key || keyB == null ? String(key) : key + '→' + keyB,
    keyColor: isIdx ? 'var(--faint)' : 'var(--ink)', colon: key === null ? '' : ': ', mark: '', markColor: 'var(--faint)', bg: 'transparent',
    caret: '', meta: '', deco: 'none', isChg: false, newText: '', newColor: 'var(--add)', valText: '', valColor: 'var(--ink)',
  });
  const walk = (nd: DiffNode, depth: number, isIdx: boolean) => {
    const b = base(nd.key, depth, isIdx, nd.keyB);
    if (nd.keyFmt) Object.assign(b, { keyText: nd.keyFmt[0] + ' → ' + nd.keyFmt[1], mark: '≈', markColor: 'var(--mut)', meta: T.keyFmtOnly });
    // Containers with changes, or with values only written differently, are expanded.
    if (nd.ch && (nd.st === 'mod' || nd.hasFmt)) {
      const arr = nd.kind === 'arr';
      const isC = !!col[nd.path];
      rows.push({ ...b, caret: isC ? '▶' : '▼', togglePath: nd.path, valText: isC ? (arr ? '[ … ]' : '{ … }') : arr ? '[' : '{', valColor: 'var(--faint)', meta: isC ? f(T.diffs, { n: cnt(nd) }) : '' });
      if (!isC) {
        let hidden = 0;
        nd.ch.forEach((c) => {
          if (onlyDiff && c.st === 'same' && !c.hasFmt) { hidden++; return; }
          walk(c, depth + 1, arr);
        });
        if (hidden) rows.push({ ...base(null, depth + 1, false), meta: f(T.unchanged, { n: hidden }) });
        rows.push({ ...b, keyText: '', colon: '', valText: arr ? ']' : '}', valColor: 'var(--faint)' });
      }
      return;
    }
    if (nd.st === 'same') {
      if (nd.fmt) {
        const [ta, tb] = windowPair(nd.fmt[0], nd.fmt[1]);
        rows.push({ ...b, mark: '≈', markColor: 'var(--mut)', bg: 'var(--sub)', valText: ta, valColor: 'var(--mut)', isChg: true, newText: tb, newColor: 'var(--mut)', meta: [b.meta, T.fmtOnly].filter(Boolean).join(' · ') });
        return;
      }
      const [t, c] = isCont(nd.a) ? [preview(nd.a), 'var(--mut)'] : prim(nd.a);
      rows.push({ ...b, valText: t, valColor: c });
      return;
    }
    if (nd.st === 'add') { rows.push({ ...b, mark: '+', markColor: 'var(--add)', bg: 'var(--addBg)', valText: preview(nd.b), valColor: 'var(--add)' }); return; }
    if (nd.st === 'del') { rows.push({ ...b, mark: '−', markColor: 'var(--del)', bg: 'var(--delBg)', valText: preview(nd.a), valColor: 'var(--del)', deco: 'line-through' }); return; }
    const [ta, tb] = changePair(nd.a, nd.b);
    rows.push({ ...b, mark: '~', markColor: 'var(--chg)', bg: 'var(--chgBg)', valText: ta, valColor: 'var(--del)', deco: 'line-through', isChg: true, newText: tb, meta: [b.meta, noteFor(nd.a, nd.b, typed, T)].filter(Boolean).join(' · ') });
  };
  walk(root, 0, false);
  // Rendering is capped (a huge diff would freeze the page); the totals stay exact and are shown.
  const total = { rows: rows.length, list: list.length };
  return { rows: rows.slice(0, DIFF_CAP), list: list.slice(0, DIFF_CAP), total, nA, nD, nC, nF };
}

export function Diff() {
  const { S, set, T, copy, replace } = useApp();
  const [srcA, pendA] = useSettled(S.diffA);
  const [srcB, pendB] = useSettled(S.diffB);
  const pending = pendA || pendB;
  const A = useMemo(() => parseAny(srcA, T), [srcA, T]);
  const B = useMemo(() => parseAny(srcB, T), [srcB, T]);
  const st = (x: Parsed): [string, string, string] =>
    'empty' in x ? [T.empty, 'var(--faint)', '']
      : 'bad' in x ? [T.invalid + (x.bad.line ? ' · ' + f(T.errAt, { l: x.bad.line, c: x.bad.col ?? 1 }) : ''), 'var(--del)', x.bad.msg]
        : ['✓ ' + x.lang + (x.bom ? ' · ' + T.bomRemoved : ''), x.bom ? 'var(--chg)' : 'var(--add)', ''];
  const [aS, aC, aM] = st(A), [bS, bC, bM] = st(B);
  const ready = 'v' in A && 'v' in B && !pending;
  // TOML on both sides: integers and floats are different types.
  const typed = 'v' in A && 'v' in B && A.lang === 'TOML' && B.lang === 'TOML';
  const root = useMemo(() => {
    if (pending || !('v' in A) || !('v' in B)) return null;
    const same = A.lang === B.lang;
    // TOML distinguishes 1 from 1.0; JSON doesn't. Value spellings are compared across formats too
    // (1.0 vs 1, 'x' vs "x"); key spellings only within one format (bare TOML keys vs quoted JSON keys).
    return diffNode(A.v, B.v, null, '$', {
      io: S.ignoreOrder, typed, rawA: A.raw, rawB: B.raw,
      keysA: same ? A.keys : undefined, keysB: same ? B.keys : undefined,
    });
  }, [A, B, S.ignoreOrder, typed, pending]);
  const d = useMemo(() => (root && (root.st !== 'same' || root.hasFmt) ? buildDiff(root, S.dCol, S.onlyDiff, typed, T) : null), [root, S.dCol, S.onlyDiff, typed, T]);

  const pane = (label: string, status: string, color: string, msg: string, value: string, key: 'diffA' | 'diffB', auto?: boolean) => (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="card-head" style={{ height: 42, minHeight: 42 }}>
        <span style={{ fontWeight: 600 }}>{label}</span><span style={{ fontSize: 12, color }}>{status}</span>
      </div>
      {msg && <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--del)', background: 'var(--delBg)', wordBreak: 'break-word' }}><Vis text={msg} /></div>}
      <textarea data-autofocus={auto ? '1' : undefined} className="area" value={value} onChange={(e) => set({ [key]: e.target.value, diffLast: key })}
        spellCheck={false} placeholder="JSON / TOML" style={{ minHeight: 200, padding: '12px 16px', whiteSpace: 'pre', overflow: 'auto' }} />
    </section>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Toggle on={S.ignoreOrder} label={T.ignoreOrder} onClick={() => set((s) => ({ ignoreOrder: !s.ignoreOrder }))} />
        <Toggle on={S.onlyDiff} label={T.onlyDiff} onClick={() => set((s) => ({ onlyDiff: !s.onlyDiff }))} />
        <span className="sep" />
        <button className="btn" onClick={() => set((s) => ({ diffA: s.diffB, diffB: s.diffA, diffLast: s.diffLast === 'diffA' ? 'diffB' : s.diffLast === 'diffB' ? 'diffA' : null }))}>⇄ {T.swap}</button>
        <button className="btn" onClick={() => replace({ diffA: SAMPLE_A, diffB: SAMPLE_B })}>{T.sample}</button>
        <button className="btn" onClick={() => replace({ diffA: '', diffB: '' })}>{T.clear}</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', alignItems: 'stretch' }}>
        {pane(T.a, aS, aC, aM, S.diffA, 'diffA', true)}
        {pane(T.b, bS, bC, bM, S.diffB, 'diffB')}
      </div>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 10px 10px 16px', borderBottom: '1px solid var(--line)' }}>
          {root && root.st !== 'same' && d && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="badge" style={{ background: 'var(--addBg)', color: 'var(--add)' }}>+ {d.nA} {T.added}</span>
              <span className="badge" style={{ background: 'var(--delBg)', color: 'var(--del)' }}>− {d.nD} {T.removed}</span>
              <span className="badge" style={{ background: 'var(--chgBg)', color: 'var(--chg)' }}>~ {d.nC} {T.changed}</span>
              {d.nF > 0 && <span className="badge" style={{ background: 'var(--sub)', color: 'var(--mut)' }}>≈ {d.nF} {T.fmtOnly}</span>}
            </div>
          )}
          {root && root.st === 'same' && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--add)' }}>✓ {T.same}</span>
              <span style={{ fontSize: 12.5, color: d ? 'var(--chg)' : 'var(--mut)' }}>{d ? f(T.sameButFmt, { n: d.nF }) : T.sameSub}</span>
            </div>
          )}
          {!ready && <span style={{ fontSize: 13, color: 'var(--faint)' }}>{pending ? T.processing : T.needBoth}</span>}
          {d && <Seg value={S.diffView} onChange={(k) => set({ diffView: k })} opts={[{ value: 'tree', label: T.diffTree }, { value: 'list', label: T.diffList }]} />}
        </div>
        {d && (S.diffView === 'tree' ? d.total.rows : d.total.list) > DIFF_CAP && (
          <div style={{ padding: '8px 16px', fontSize: 12.5, color: 'var(--chg)', background: 'var(--chgBg)' }}>
            {f(T.diffTruncated, { n: DIFF_CAP, t: S.diffView === 'tree' ? d.total.rows : d.total.list })}
          </div>
        )}
        {d && S.diffView === 'tree' && (
          <div className="code" style={{ padding: '8px 0', lineHeight: '24px', maxHeight: '70vh', overflow: 'auto' }}>
            {d.rows.map((r, i) => (
              <div key={i} className="trow" style={{ background: r.bg }}>
                <span style={{ width: 30, flex: 'none', textAlign: 'center', color: r.markColor, fontWeight: 700, userSelect: 'none' }}>{r.mark}</span>
                <div className="body" style={{ flexWrap: 'wrap', paddingLeft: r.indent }}>
                  {r.togglePath ? (
                    <button className="caret" aria-label={T.foldRow} aria-expanded={r.caret === '▼'}
                      onClick={() => { const p = r.togglePath!; set((s) => ({ dCol: { ...s.dCol, [p]: !s.dCol[p] } })); }}>{r.caret}</button>
                  ) : <span className="caret" />}
                  <span style={{ color: r.keyColor, whiteSpace: 'pre' }}><Vis text={r.keyText} /></span>
                  <span style={{ color: 'var(--faint)', whiteSpace: 'pre' }}>{r.colon}</span>
                  <span style={{ color: r.valColor, wordBreak: 'break-all', whiteSpace: 'pre-wrap', textDecoration: r.deco }}><Vis text={r.valText} /></span>
                  {r.isChg && (
                    <>
                      <span style={{ color: 'var(--faint)', padding: '0 8px' }}>→</span>
                      <span style={{ color: r.newColor, wordBreak: 'break-all', whiteSpace: 'pre-wrap', fontWeight: 500 }}><Vis text={r.newText} /></span>
                    </>
                  )}
                  <span className="meta" style={{ lineHeight: '24px', whiteSpace: 'normal' }}>{r.meta}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {d && S.diffView === 'list' && (
          <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
            {d.list.map((it, i) => (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px', padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flex: '0 1 280px', minWidth: 0, flexWrap: 'wrap' }}>
                  <span className="mono" style={{ width: 14, flex: 'none', fontSize: 13, fontWeight: 700, color: it.color }}>{it.mark}</span>
                  <button className="mono path-btn" onClick={() => copy(it.path)} title={T.copyPath}
                    style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 500, textAlign: 'left', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}><Vis text={it.path} /></button>
                  {it.pathB && (
                    <button className="mono path-btn" onClick={() => copy(it.pathB!)} title={T.copyPath}
                      style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontSize: 12, color: 'var(--faint)', textAlign: 'left', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>→ <Vis text={it.pathB} /></button>
                  )}
                </span>
                <span className="mono" style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 8px', fontSize: 13 }}>
                  {it.oldText != null && <span style={{ color: it.fmt ? 'var(--mut)' : 'var(--del)', textDecoration: it.fmt ? 'none' : 'line-through', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}><Vis text={it.oldText} /></span>}
                  {it.oldText != null && it.newText != null && <span style={{ color: 'var(--faint)' }}>→</span>}
                  {it.newText != null && <span style={{ color: it.fmt ? 'var(--mut)' : 'var(--add)', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}><Vis text={it.newText} /></span>}
                  {it.note && <span style={{ color: 'var(--faint)', fontSize: 12, fontFamily: "'Geist Sans', 'Geist', sans-serif" }}>{it.note}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
