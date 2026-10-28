import { useMemo } from 'react';
import { SAMPLE_JSON, SAMPLE_TOML, f, type Dict } from '../i18n';
import { Pair } from '../components/Split';
import { useApp, type FmtLang } from '../store';
import { Seg } from '../components/Seg';
import { useSettled } from '../components/useSettled';
import { Vis, countInvisible } from '../components/Vis';
import { Hl } from '../components/Hl';
import { CopyBlock } from '../components/Kv';
import { SHOW_CHARS, head } from '../components/Panes';
import { ConvertError, DateTime, Num, bytesLabel, byteLen, clipboardUnsafe, cp, errInfo, isCont, isObj, sortDeep, stats, type ErrInfo, type Obj } from '../lib/data';
import { astEqual, dupKeys, jsonValue, parseJsonAst, printJson, sortAst, statsAst, toJsonText, type JNode } from '../lib/json';
import { TomlMismatch, TomlSyntaxError, VerifyError, bareKey, formatToml, parseTomlDoc, toTomlText, tomlStr, tomlValue, verifyToml, walkToml, type TomlDoc } from '../lib/toml';

const TREE_CAP = 4000;
const SAMPLE = { json: SAMPLE_JSON, toml: SAMPLE_TOML };

/** Message for a value that can't be converted / represented. */
export function convertMsg(e: unknown, T: Dict): string {
  if (e instanceof ConvertError) return f(T.cv[e.code], { p: e.path, d: e.detail });
  return String((e as Error)?.message || e);
}

type Result =
  | { empty: true }
  | { err: ErrInfo }
  | { lang: 'json'; ast: JNode; text: string; st: { n: number; d: number }; dupes: string[]; bom: boolean }
  | { lang: 'toml'; doc: TomlDoc; value: Obj; text: string; st: { n: number; d: number }; bom: boolean };

const plainErr = (msg: string): ErrInfo => ({ msg, line: null, col: null, before: '', at: '', after: '' });

/**
 * Parse, re-print and verify. The output is only shown if re-parsing it gives back the
 * identical document (every token / literal / comment); anything else is an error.
 */
/** The indent setting as the JSON printers take it ('' minifies). */
const gapOf = (indent: string) => (indent === 'tab' ? '\t' : indent === 'min' ? '' : +indent);

function compute(lang: FmtLang, src: string, indent: string, sortKeys: boolean, T: Dict): Result {
  if (!src.trim()) return { empty: true };
  if (lang === 'json') {
    let ast: JNode, bom: boolean;
    try { ({ ast, bom } = parseJsonAst(src)); } catch (e) { return { err: errInfo(e, src) }; }
    if (sortKeys) ast = sortAst(ast);
    const text = printJson(ast, gapOf(indent));
    let back: JNode | null = null;
    try { back = parseJsonAst(text).ast; } catch { /* reported below */ }
    if (!back || !astEqual(back, ast)) return { err: plainErr(f(T.verifyFail, { p: '$' })) };
    return { lang, ast, text, st: statsAst(ast), dupes: dupKeys(ast), bom };
  }
  let doc: TomlDoc;
  try { doc = parseTomlDoc(src); } catch (e) {
    if (e instanceof TomlMismatch) return { err: plainErr(f(T.tomlMismatch, { p: e.path })) };
    const info = errInfo(e, src);
    // smol-toml accepted it but our lossless parser can't represent it: say so.
    if (e instanceof TomlSyntaxError) info.msg = f(T.tomlUnsupported, { m: info.msg });
    return { err: info };
  }
  const text = formatToml(doc, sortKeys);
  try { verifyToml(doc, text, sortKeys); } catch (e) {
    return { err: plainErr(f(T.verifyFail, { p: e instanceof VerifyError ? e.path : '$' })) };
  }
  return { lang, doc, value: (sortKeys ? sortDeep(doc.value) : doc.value) as Obj, text, st: stats(doc.value), bom: doc.bom };
}

interface Row {
  n: number; id: string; path: string; indent: number; caret: string; keyText: string; keyColor: string; colon: string;
  valText: string; valColor: string; comma: string; meta: string; selectable: boolean; foldable: boolean;
}

const COLOR = { str: 'var(--str)', num: 'var(--num)', bool: 'var(--bool)', date: 'var(--date)', faint: 'var(--faint)' };

/** JSON tree straight from the syntax tree: tokens as written, duplicate keys flagged. */
function buildJsonTree(ast: JNode, col: Record<string, boolean>, T: Dict) {
  const rows: Row[] = [], sel: Record<string, { path: string; node: JNode }> = {};
  let n = 0;
  const walk = (x: JNode, keyText: string, id: string, path: string, depth: number, last: boolean, isIdx: boolean, dup: boolean) => {
    if (rows.length >= TREE_CAP) return;
    sel[id] = { path, node: x };
    const comma = last ? '' : ',';
    const base = {
      id, path, indent: depth * 18, keyText, keyColor: dup ? 'var(--chg)' : isIdx ? 'var(--faint)' : 'var(--ink)',
      colon: keyText ? ': ' : '', selectable: true, foldable: false, caret: '', meta: dup ? T.dupMark : '',
    };
    if (x.t === 'obj' || x.t === 'arr') {
      const [o, c] = x.t === 'arr' ? ['[', ']'] : ['{', '}'];
      if (!x.e.length) { rows.push({ ...base, n: ++n, valText: o + c, valColor: COLOR.faint, comma }); return; }
      const isC = !!col[id];
      const cnt = f(x.t === 'arr' ? T.items : T.keys, { n: x.e.length });
      rows.push({ ...base, n: ++n, caret: isC ? '▶' : '▼', foldable: true, valText: isC ? o + ' … ' + c : o, valColor: COLOR.faint, comma: isC ? comma : '', meta: [base.meta, isC || depth === 0 ? cnt : ''].filter(Boolean).join(' · ') });
      if (isC) return;
      if (x.t === 'arr') x.e.forEach((y, i) => walk(y, String(i), id + '/' + i, cp(path, i, true), depth + 1, i === x.e.length - 1, true, false));
      else {
        const seen = new Set<string>();
        x.e.forEach((e, i) => {
          const d = seen.has(e.k);
          seen.add(e.k);
          walk(e.v, e.kRaw, id + '/' + i, cp(path, e.k, false), depth + 1, i === x.e.length - 1, false, d);
        });
      }
      if (rows.length < TREE_CAP) rows.push({ ...base, n: ++n, keyText: '', colon: '', meta: '', valText: c, valColor: COLOR.faint, comma, selectable: false });
      return;
    }
    const color = x.t === 'str' ? COLOR.str : x.t === 'num' ? COLOR.num : x.raw === 'null' ? COLOR.faint : COLOR.bool;
    rows.push({ ...base, n: ++n, valText: x.raw, valColor: color, comma });
  };
  walk(ast, '', '$', '$', 0, true, false, false);
  return { rows, sel, capped: rows.length >= TREE_CAP };
}

function scalarColor(y: unknown) {
  return typeof y === 'string' ? COLOR.str : y instanceof Num ? COLOR.num : y instanceof DateTime ? COLOR.date : COLOR.bool;
}

/** TOML tree laid out as tables; every scalar shown exactly as written in the source. */
function buildTomlTree(v: Obj, raw: Map<string, string>, col: Record<string, boolean>, T: Dict) {
  const rows: Row[] = [], sel: Record<string, { path: string; value: unknown }> = { $: { path: '$', value: v } };
  let n = 0;
  const row = (r: Partial<Row> & Pick<Row, 'path'>) => {
    if (rows.length >= TREE_CAP) return;
    rows.push({ n: ++n, id: r.path, indent: 0, caret: '', keyText: '', keyColor: 'var(--ink)', colon: '', valText: '', valColor: 'var(--ink)', comma: '', meta: '', selectable: true, foldable: false, ...r });
  };
  walkToml(
    v,
    (k, y, path, depth) => {
      sel[path] = { path, value: y };
      row({ path, indent: depth * 18, keyText: bareKey(k), colon: ' = ', valText: tomlValue(y, path, raw), valColor: isCont(y) ? 'var(--ink)' : scalarColor(y) });
    },
    (label, obj, path, depth) => {
      sel[path] = { path, value: obj };
      const cnt = Object.keys(obj).length;
      const isC = cnt > 0 && !!col[path];
      row({ path, indent: depth * 18, caret: cnt ? (isC ? '▶' : '▼') : '', foldable: cnt > 0, keyText: label, keyColor: 'var(--acc)', meta: isC ? f(T.keys, { n: cnt }) : '' });
      return !isC && rows.length < TREE_CAP;
    },
  );
  return { rows, sel, capped: rows.length >= TREE_CAP };
}

/** Fold JSON containers `level` deep or more (Infinity = expand all). */
function jsonLevelMap(ast: JNode, level: number) {
  const out: Record<string, boolean> = {};
  const w = (x: JNode, id: string, dep: number) => {
    if (x.t !== 'obj' && x.t !== 'arr') return;
    if (dep >= level) out[id] = true;
    if (x.t === 'arr') x.e.forEach((y, i) => w(y, id + '/' + i, dep + 1));
    else x.e.forEach((e, i) => w(e.v, id + '/' + i, dep + 1));
  };
  if (level < Infinity) w(ast, '$', 0);
  return out;
}

/** Fold TOML sections nested `level` deep or more (Infinity = expand all). */
function tomlLevelMap(v: Obj, level: number) {
  const out: Record<string, boolean> = {};
  if (level < Infinity) walkToml(v, () => {}, (_l, _o, path, depth) => { if (depth + 1 >= level) out[path] = true; return true; });
  return out;
}

export function Formatter({ lang }: { lang: FmtLang }) {
  const { S, set, T, copy, toast, replace } = useApp();
  const L = lang === 'json' ? 'JSON' : 'TOML';
  const src = S[lang];
  // Large inputs are processed when typing pauses; until then nothing can be copied or converted,
  // so a result is never used for text it wasn't made from.
  const [settled, pending] = useSettled(src);
  const r = useMemo(() => compute(lang, settled, S.indent, S.sortKeys, T), [lang, settled, S.indent, S.sortKeys, T]);
  const ok = 'text' in r && !pending ? r : null;
  const err = 'err' in r && !pending ? r.err : null;
  const isTree = !!ok && S.view === 'tree';
  const col = S.collapsed[lang];
  const tree = useMemo(() => {
    if (!isTree || !ok) return null;
    return ok.lang === 'json' ? buildJsonTree(ok.ast, col, T) : buildTomlTree(ok.value, ok.doc.raw, col, T);
  }, [isTree, ok, col, T]);
  const sel = S.sel[lang];
  const hasSel = !!tree && !!sel && sel in tree.sel;

  // Anything the user should know about the input, even though the output is unchanged.
  const notices: string[] = [];
  if (ok?.lang === 'json' && ok.dupes.length) notices.push(f(T.dupKeysKept, { n: ok.dupes.length, p: ok.dupes[0] }));
  if (ok?.bom) notices.push(T.bomRemoved);
  const invisible = useMemo(() => (ok ? countInvisible(settled) : 0), [ok, settled]);
  if (invisible) notices.push(f(T.invisibleChars, { n: invisible }));
  const status = pending ? T.processing : ok ? [f(T.valid, { L, n: ok.st.n, d: ok.st.d }), ...notices].join(' · ')
    : err ? (err.line ? f(T.errAt, { l: err.line, c: err.col ?? 1 }) : T.errNoPos) : T.empty;
  const statusColor = ok ? (notices.length ? 'var(--chg)' : 'var(--add)') : err ? 'var(--del)' : 'var(--faint)';
  const taH = S.wide ? 480 : 220;

  const convert = () => {
    if (!ok) return;
    try {
      if (ok.lang === 'json') {
        const { v } = jsonValue(ok.ast);
        if (!isObj(v)) { toast(T.cvFail + T.tomlTop, 6000); return; }
        replace({ toml: toTomlText(v), sel: { ...S.sel, toml: '' }, tool: 'toml' });
      } else {
        const dates: string[] = [];
        const text = toJsonText(ok.value, gapOf(S.indent), dates);
        replace({ json: text, sel: { ...S.sel, json: '' }, tool: 'json' }, dates.length ? f(T.datesToStr, { n: dates.length }) : undefined);
      }
    } catch (e) {
      toast(T.cvFail + convertMsg(e, T), 6000);
    }
  };
  const copySelValue = () => {
    if (!tree || !hasSel || !ok) return;
    if (ok.lang === 'json') {
      const node = (tree.sel[sel] as { node: JNode }).node;
      if (node.t !== 'str') copy(printJson(node, 2));
      // The clipboard can't hold NUL / lone surrogates faithfully: copy the escaped form instead.
      else if (clipboardUnsafe(node.v)) copy(JSON.stringify(node.v), T.copiedEscaped);
      else copy(node.v);
    } else {
      const { value, path } = tree.sel[sel] as { path: string; value: unknown };
      if (typeof value !== 'string') copy(tomlValue(value, path, ok.doc.raw));
      else if (clipboardUnsafe(value)) copy(tomlStr(value), T.copiedEscaped);
      else copy(value);
    }
  };
  // Keyboard: ↑ ↓ Home End move (selection follows focus), → expands, ← collapses.
  const focusId = tree && sel && sel in tree.sel ? sel : tree?.rows.find((r) => r.selectable)?.id;
  const onRowKey = (e: React.KeyboardEvent<HTMLDivElement>, row: Row) => {
    const rows = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
    const i = rows.indexOf(e.currentTarget);
    const go = (j: number) => { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, j))]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (row.foldable && ((e.key === 'ArrowRight' && row.caret === '▶') || (e.key === 'ArrowLeft' && row.caret === '▼'))) {
      e.preventDefault();
      toggleFold(row.id);
    }
  };
  const toggleFold = (id: string) =>
    set((s) => ({ collapsed: { ...s.collapsed, [lang]: { ...s.collapsed[lang], [id]: !s.collapsed[lang][id] } } }));
  const setSel = (id: string) => set((s) => ({ sel: { ...s.sel, [lang]: id } }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <button className="btn" onClick={() => replace({ [lang]: SAMPLE[lang], sel: { ...S.sel, [lang]: '' } })}>{T.sample}</button>
        <button className="btn" onClick={() => replace({ [lang]: '', sel: { ...S.sel, [lang]: '' } })}>{T.clear}</button>
        <span className="sep" />
        {lang === 'json' && (
          // Minified text shows only in the text view, so choosing it goes there.
          <Seg value={S.indent} onChange={(k) => set(k === 'min' ? { indent: k, view: 'text' } : { indent: k })}
            opts={[{ value: '2', label: T.indent2 }, { value: '4', label: T.indent4 }, { value: 'tab', label: 'Tab' }, { value: 'min', label: T.ui.minify }]} />
        )}
        <button className={'btn' + (S.sortKeys ? ' on' : '')} onClick={() => set((s) => ({ sortKeys: !s.sortKeys }))}>{S.sortKeys ? '✓' : '○'} {T.sortKeys}</button>
        <button className="btn" onClick={convert}>{lang === 'json' ? T.toToml : T.toJson}</button>
        <span className="spacer" />
        <Seg value={S.view} onChange={(k) => set({ view: k })} opts={[{ value: 'tree', label: T.viewTree }, { value: 'text', label: T.viewText }]} />
        <button className="btn inv" onClick={() => { if (ok) copy(ok.text); }} style={{ padding: '0 14px' }}>{T.copyResult}</button>
      </div>

      <Pair>
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, minWidth: 0 }}>
              <span style={{ width: 7, height: 7, flex: 'none', borderRadius: '50%', background: statusColor }} />
              <span style={{ wordBreak: 'break-word' }}><Vis text={status} /></span>
            </span>
            {isTree && ok && (
              <div style={{ display: 'flex', gap: 2 }}>
                {([[T.expandAll, Infinity], [f(T.level, { n: 1 }), 1], [f(T.level, { n: 2 }), 2], [f(T.level, { n: 3 }), 3]] as [string, number][]).map(([label, lv]) => (
                  <button key={label} className="ghost"
                    onClick={() => set((s) => ({ collapsed: { ...s.collapsed, [lang]: ok.lang === 'json' ? jsonLevelMap(ok.ast, lv) : tomlLevelMap(ok.value, lv) } }))}
                    style={{ height: 28, padding: '0 9px', borderRadius: 6, fontSize: 12, color: 'var(--mut)' }}>{label}</button>
                ))}
              </div>
            )}
          </div>
          <div className="code pane-scroll" style={{ flex: 1, maxHeight: S.wide ? 'calc(100vh - 250px)' : '70vh', minHeight: taH, overflow: 'auto', padding: '10px 0' }}>
            {tree && (
              <>
                {tree.rows.map((row) => (
                  <div key={row.n} className="trow click" onClick={row.selectable ? () => setSel(row.id) : undefined}
                    data-row={row.selectable ? row.id : undefined} role={row.selectable ? 'treeitem' : undefined}
                    aria-expanded={row.foldable ? row.caret === '▼' : undefined} aria-selected={row.selectable ? sel === row.id : undefined}
                    tabIndex={row.selectable ? (row.id === focusId ? 0 : -1) : undefined}
                    onFocus={row.selectable && sel !== row.id ? () => setSel(row.id) : undefined}
                    onKeyDown={row.selectable ? (e) => onRowKey(e, row) : undefined}
                    style={{ background: row.selectable && sel === row.id ? 'var(--accSoft2)' : undefined }}>
                    <span className="gut">{row.n}</span>
                    <div className="body" style={{ paddingLeft: row.indent }}>
                      <span className="caret" onClick={row.foldable ? (e) => { e.stopPropagation(); toggleFold(row.id); } : undefined}>{row.caret}</span>
                      <span style={{ color: row.keyColor, whiteSpace: 'pre' }}><Vis text={row.keyText} /></span>
                      <span style={{ color: 'var(--faint)', whiteSpace: 'pre' }}>{row.colon}</span>
                      <span style={{ color: row.valColor, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}><Vis text={row.valText} /></span>
                      <span style={{ color: 'var(--faint)' }}>{row.comma}</span>
                      <span className="meta">{row.meta}</span>
                    </div>
                  </div>
                ))}
                {tree.capped && <div style={{ padding: '8px 16px', fontSize: 12, fontFamily: "'Geist Sans', 'Geist', sans-serif", color: 'var(--faint)' }}>{f(T.truncated, { n: tree.rows.length })}</div>}
              </>
            )}
            {ok && S.view === 'text' && (
              <CopyBlock value={ok.text} style={{ margin: '0 8px' }}>
                <pre style={{ margin: 0, padding: '0 8px', font: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}><Hl lang={ok.lang} text={head(ok.text, SHOW_CHARS)} /></pre>
                {ok.text.length > SHOW_CHARS && <div className="shown-first" style={{ margin: '10px 8px 0', fontSize: 12, fontFamily: "'Geist Sans', 'Geist', sans-serif", color: 'var(--faint)' }}>{f(T.ui.shownFirst, { n: SHOW_CHARS.toLocaleString('en-US') })}</div>}
              </CopyBlock>
            )}
            {err && (
              <div style={{ margin: '6px 16px', padding: '14px 16px', borderRadius: 10, background: 'var(--delBg)', color: 'var(--del)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, fontFamily: "'Geist Sans', 'Geist', sans-serif" }}><Vis text={status} /></span>
                <span style={{ font: "12.5px/1.5 'Geist Mono', monospace", color: 'var(--ink)', opacity: 0.8, wordBreak: 'break-word' }}><Vis text={err.msg} /></span>
                {err.line && (
                  <pre style={{ margin: 0, font: "12.5px/1.5 'Geist Mono', monospace", color: 'var(--ink)', whiteSpace: 'pre', overflow: 'auto', padding: '2px 0' }}>
                    <Vis text={err.before} /><mark className="err-at">{err.at ? <Vis text={err.at} /> : ' '}</mark><Vis text={err.after} />
                  </pre>
                )}
              </div>
            )}
            {'empty' in r && !pending && (
              <div style={{ padding: '30px 16px', textAlign: 'center', fontSize: 13, fontFamily: "'Geist Sans', 'Geist', sans-serif", color: 'var(--faint)' }}>{f(T.waiting, { L })}</div>
            )}
          </div>
          {hasSel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 16px', borderTop: '1px solid var(--line)', background: 'var(--sub)', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--acc)', wordBreak: 'break-all', whiteSpace: 'pre-wrap', flex: 1, minWidth: 120 }}><Vis text={tree!.sel[sel].path} /></span>
              <button className="btn" onClick={() => copy(tree!.sel[sel].path)} style={{ height: 28, padding: '0 10px', borderRadius: 7, fontSize: 12, fontWeight: 400 }}>{T.copyPath}</button>
              <button className="btn" onClick={copySelValue} style={{ height: 28, padding: '0 10px', borderRadius: 7, fontSize: 12, fontWeight: 400 }}>{T.copyValue}</button>
              <button className="ghost" onClick={() => setSel('')} aria-label={T.closeSel} title={T.closeSel} style={{ width: 28, height: 28, borderRadius: 7, color: 'var(--faint)' }}>×</button>
            </div>
          )}
        </section>
      </Pair>
    </div>
  );
}
