import { useMemo } from 'react';
import * as TOML from 'smol-toml';
import { SAMPLE_JSON, SAMPLE_TOML, f } from '../i18n';
import { useApp, type FmtLang } from '../store';
import { Seg } from '../components/Seg';
import { bytesLabel, byteLen, cp, errInfo, isCont, isObj, prim, sortDeep, stats, type ErrInfo } from '../lib/data';

const TREE_CAP = 4000;
const SAMPLE = { json: SAMPLE_JSON, toml: SAMPLE_TOML };

type Result =
  | { empty: true }
  | { err: ErrInfo }
  | { v: unknown; text: string; st: { n: number; d: number } };

function compute(lang: FmtLang, src: string, indent: string, sortKeys: boolean): Result {
  if (!src.trim()) return { empty: true };
  let v: unknown;
  try {
    v = lang === 'json' ? JSON.parse(src) : TOML.parse(src);
  } catch (e) {
    return { err: errInfo(e, src, lang) };
  }
  if (sortKeys) v = sortDeep(v);
  let text: string;
  try {
    text = lang === 'json' ? JSON.stringify(v, null, indent === 'tab' ? '\t' : +indent) : TOML.stringify(v as Record<string, unknown>);
  } catch (e) {
    text = String((e as Error).message || e);
  }
  return { v, text, st: stats(v) };
}

interface Row {
  n: number; indent: number; caret: string; path: string; keyText: string; keyColor: string; colon: string;
  valText: string; valColor: string; comma: string; meta: string; selectable: boolean; foldable: boolean;
}

function buildTree(v: unknown, lang: FmtLang, col: Record<string, boolean>, T: ReturnType<typeof useApp>['T']) {
  const rows: Row[] = [], pv: Record<string, unknown> = {};
  let n = 0;
  const keyFmt = (k: string | number, isIdx: boolean) =>
    isIdx ? String(k) : lang === 'json' ? JSON.stringify(k) : /^[A-Za-z0-9_-]+$/.test(String(k)) ? String(k) : JSON.stringify(k);
  const walk = (x: unknown, key: string | number | null, path: string, depth: number, last: boolean, isIdx: boolean) => {
    if (rows.length >= TREE_CAP) return;
    pv[path] = x;
    const comma = last || lang === 'toml' ? '' : ',';
    const keyText = key === null ? '' : keyFmt(key, isIdx);
    const colon = key === null ? '' : lang === 'toml' && !isIdx ? ' = ' : ': ';
    const keyColor = isIdx ? 'var(--faint)' : 'var(--ink)';
    const base = { indent: depth * 18, path, keyText, keyColor, colon, selectable: true, foldable: false, caret: '', meta: '' };
    if (isCont(x)) {
      const arr = Array.isArray(x);
      const ents: [string | number, unknown][] = arr ? x.map((y, i) => [i, y]) : Object.entries(x);
      const o = arr ? '[' : '{', c = arr ? ']' : '}';
      if (!ents.length) {
        rows.push({ ...base, n: ++n, valText: o + c, valColor: 'var(--faint)', comma });
        return;
      }
      const isC = !!col[path];
      rows.push({
        ...base, n: ++n, caret: isC ? '▶' : '▼', foldable: true, valText: isC ? o + ' … ' + c : o, valColor: 'var(--faint)',
        comma: isC ? comma : '', meta: isC || depth === 0 ? f(arr ? T.items : T.keys, { n: ents.length }) : '',
      });
      if (!isC) {
        ents.forEach(([k, y], i) => walk(y, k, cp(path, k, arr), depth + 1, i === ents.length - 1, arr));
        if (rows.length < TREE_CAP) rows.push({ ...base, n: ++n, keyText: '', colon: '', valText: c, valColor: 'var(--faint)', comma, selectable: false });
      }
    } else {
      const [t, c] = prim(x);
      rows.push({ ...base, n: ++n, valText: t, valColor: c, comma });
    }
  };
  walk(v, null, '$', 0, true, false);
  return { rows, pv, capped: rows.length >= TREE_CAP };
}

/** Collapse every container at depth ≥ level (Infinity = expand all). */
function levelMap(v: unknown, level: number) {
  const out: Record<string, boolean> = {};
  const w = (x: unknown, path: string, dep: number) => {
    if (!isCont(x)) return;
    if (dep >= level) out[path] = true;
    const arr = Array.isArray(x);
    (arr ? x.map((y, i) => [i, y] as [number, unknown]) : Object.entries(x)).forEach(([k, y]) => w(y, cp(path, k, arr), dep + 1));
  };
  if (level < Infinity) w(v, '$', 0);
  return out;
}

export function Formatter({ lang }: { lang: FmtLang }) {
  const { S, set, T, copy, toast } = useApp();
  const L = lang === 'json' ? 'JSON' : 'TOML';
  const src = S[lang];
  const r = useMemo(() => compute(lang, src, S.indent, S.sortKeys), [lang, src, S.indent, S.sortKeys]);
  const ok = 'v' in r ? r : null;
  const err = 'err' in r ? r.err : null;
  const isTree = !!ok && S.view === 'tree';
  const col = S.collapsed[lang];
  const tree = useMemo(() => (isTree && ok ? buildTree(ok.v, lang, col, T) : null), [isTree, ok, lang, col, T]);
  const sel = S.sel[lang];
  const hasSel = !!tree && !!sel && sel in tree.pv;

  const status = ok ? f(T.valid, { L, n: ok.st.n, d: ok.st.d }) : err ? (err.line ? f(T.errAt, { l: err.line, c: err.col ?? 1 }) : T.errNoPos) : T.empty;
  const statusColor = ok ? 'var(--add)' : err ? 'var(--del)' : 'var(--faint)';
  const taH = S.wide ? 480 : 220;

  const convert = () => {
    if (!ok) return;
    if (lang === 'json') {
      if (!isObj(ok.v)) { toast(T.tomlTop); return; }
      try { set({ toml: TOML.stringify(ok.v), tool: 'toml' }); } catch (e) { toast(String((e as Error).message || e)); }
    } else {
      set({ json: JSON.stringify(ok.v, null, S.indent === 'tab' ? '\t' : +S.indent), tool: 'json' });
    }
  };
  const toggleFold = (path: string) =>
    set((s) => ({ collapsed: { ...s.collapsed, [lang]: { ...s.collapsed[lang], [path]: !s.collapsed[lang][path] } } }));
  const setSel = (path: string) => set((s) => ({ sel: { ...s.sel, [lang]: path } }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <button className="btn" onClick={() => set({ [lang]: lang === 'json' ? SAMPLE.json : SAMPLE.toml })}>{T.sample}</button>
        <button className="btn" onClick={() => set((s) => ({ [lang]: '', sel: { ...s.sel, [lang]: '' } }))}>{T.clear}</button>
        <span className="sep" />
        {lang === 'json' && (
          <Seg value={S.indent} onChange={(k) => set({ indent: k })}
            opts={[{ value: '2', label: T.indent2 }, { value: '4', label: T.indent4 }, { value: 'tab', label: 'Tab' }]} />
        )}
        <button className={'btn' + (S.sortKeys ? ' on' : '')} onClick={() => set((s) => ({ sortKeys: !s.sortKeys }))}>{S.sortKeys ? '✓' : '○'} {T.sortKeys}</button>
        {lang === 'json' && <button className="btn" onClick={() => { if (ok) copy(JSON.stringify(ok.v), T.minCopied); }}>{T.minify}</button>}
        <button className="btn" onClick={convert}>{lang === 'json' ? T.toToml : T.toJson}</button>
        <span className="spacer" />
        <Seg value={S.view} onChange={(k) => set({ view: k })} opts={[{ value: 'tree', label: T.viewTree }, { value: 'text', label: T.viewText }]} />
        <button className="btn inv" onClick={() => { if (ok) copy(ok.text); }} style={{ padding: '0 14px' }}>{T.copyResult}</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', alignItems: 'stretch' }}>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-head" style={{ height: 44 }}>
            <span style={{ fontWeight: 600 }}>{T.input} {L}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>{bytesLabel(byteLen(src))}</span>
          </div>
          <textarea data-autofocus="1" className="area" value={src} onChange={(e) => set({ [lang]: e.target.value })} spellCheck={false}
            placeholder={f(T.fmtPh, { L })}
            style={{ flex: 1, minHeight: taH, padding: '14px 16px', font: "13px/1.65 'Geist Mono', monospace", whiteSpace: 'pre', overflow: 'auto' }} />
        </section>

        <section className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="card-head" style={{ padding: '6px 10px 6px 16px', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />{status}
            </span>
            {isTree && ok && (
              <div style={{ display: 'flex', gap: 2 }}>
                {([[T.expandAll, Infinity], [f(T.level, { n: 1 }), 1], [f(T.level, { n: 2 }), 2], [f(T.level, { n: 3 }), 3]] as [string, number][]).map(([label, lv]) => (
                  <button key={label} className="ghost" onClick={() => set((s) => ({ collapsed: { ...s.collapsed, [lang]: levelMap(ok.v, lv) } }))}
                    style={{ height: 28, padding: '0 9px', borderRadius: 6, fontSize: 12, color: 'var(--mut)' }}>{label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="code" style={{ flex: 1, maxHeight: S.wide ? 'calc(100vh - 250px)' : '70vh', minHeight: taH, overflow: 'auto', padding: '10px 0' }}>
            {tree && (
              <>
                {tree.rows.map((row) => (
                  <div key={row.n} className="trow click" onClick={row.selectable ? () => setSel(row.path) : undefined}
                    style={{ background: row.selectable && sel === row.path ? 'var(--accSoft2)' : undefined }}>
                    <span className="gut">{row.n}</span>
                    <div className="body" style={{ paddingLeft: row.indent }}>
                      <span className="caret" onClick={row.foldable ? (e) => { e.stopPropagation(); toggleFold(row.path); } : undefined}>{row.caret}</span>
                      <span style={{ color: row.keyColor, whiteSpace: 'pre' }}>{row.keyText}</span>
                      <span style={{ color: 'var(--faint)', whiteSpace: 'pre' }}>{row.colon}</span>
                      <span style={{ color: row.valColor, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{row.valText}</span>
                      <span style={{ color: 'var(--faint)' }}>{row.comma}</span>
                      <span className="meta">{row.meta}</span>
                    </div>
                  </div>
                ))}
                {tree.capped && <div style={{ padding: '8px 16px', fontSize: 12, fontFamily: "'Geist Sans', 'Geist', sans-serif", color: 'var(--faint)' }}>{f(T.truncated, { n: tree.rows.length })}</div>}
              </>
            )}
            {ok && S.view === 'text' && <pre style={{ margin: 0, padding: '4px 16px', font: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{ok.text}</pre>}
            {err && (
              <div style={{ margin: '6px 16px', padding: '14px 16px', borderRadius: 10, background: 'var(--delBg)', color: 'var(--del)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, fontFamily: "'Geist Sans', 'Geist', sans-serif" }}>{status}</span>
                <span style={{ font: "12.5px/1.5 'Geist Mono', monospace", color: 'var(--ink)', opacity: 0.8, wordBreak: 'break-word' }}>{err.msg}</span>
                <pre style={{ margin: 0, font: "12.5px/1.5 'Geist Mono', monospace", color: 'var(--ink)', whiteSpace: 'pre', overflow: 'auto' }}>
                  {err.lineText + '\n'}<span style={{ color: 'var(--del)', fontWeight: 700 }}>{err.caret}</span>
                </pre>
              </div>
            )}
            {'empty' in r && (
              <div style={{ padding: '30px 16px', textAlign: 'center', fontSize: 13, fontFamily: "'Geist Sans', 'Geist', sans-serif", color: 'var(--faint)' }}>{f(T.waiting, { L })}</div>
            )}
          </div>
          {hasSel ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 16px', borderTop: '1px solid var(--line)', background: 'var(--sub)', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--acc)', wordBreak: 'break-all', flex: 1, minWidth: 120 }}>{sel}</span>
              <button className="btn" onClick={() => copy(sel)} style={{ height: 28, padding: '0 10px', borderRadius: 7, fontSize: 12, fontWeight: 400 }}>{T.copyPath}</button>
              <button className="btn" onClick={() => { const x = tree!.pv[sel]; copy(typeof x === 'string' ? x : JSON.stringify(x, null, 2)); }}
                style={{ height: 28, padding: '0 10px', borderRadius: 7, fontSize: 12, fontWeight: 400 }}>{T.copyValue}</button>
              <button className="ghost" onClick={() => setSel('')} style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--faint)' }}>×</button>
            </div>
          ) : (
            isTree && <div style={{ padding: '8px 16px', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--faint)' }}>{T.pathHint}</div>
          )}
        </section>
      </div>
    </div>
  );
}
