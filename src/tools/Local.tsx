// Local plugins: dashboards the user defines in JSON, kept in this browser only. Each one calls its
// URL with every key on a timer (lib/pluginRun) and shows a card per key — values and used / limit
// bars — and the trends over time. Loaded only when opened (the chart library).
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { f } from '../i18n';
import { useApp } from '../store';
import { Seg } from '../components/Seg';
import { useOpt } from '../components/Panes';
import { TEMPLATE, loadPlugins, newId, parseDef, savePlugins, type DashDef, type Plugin, type PluginKey, type Reading } from '../lib/plugins';
import * as run from '../lib/pluginRun';

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, ''));
const time = (t?: number) => (t ? new Date(t).toLocaleTimeString() : '');
const mask = (k: string) => (k.length > 10 ? k.slice(0, 6) + '…' + k.slice(-4) : '••••');
const RANGES = { h1: 3600e3, h24: 86400e3, d7: run.KEEP_MS } as const;
type Range = keyof typeof RANGES;

function useRun() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => run.subscribe(bump), []);
}

export default function Local() {
  const { T } = useApp();
  const L = T.local;
  const [plugins, setPlugins] = useState<Plugin[]>(loadPlugins);
  const [sel, setSel] = useOpt<string>('local.sel', '');
  const [editing, setEditing] = useState<string | null>(null);
  const cur = plugins.find((p) => p.id === sel) ?? plugins[0];
  const apply = (ps: Plugin[]) => { setPlugins(ps); savePlugins(ps); run.sync(ps); };

  const create = (src: string) => {
    const r = parseDef(src);
    if (!('def' in r)) return;
    const p: Plugin = { id: newId(), src, def: r.def, keys: [] };
    apply([...plugins, p]);
    setSel(p.id);
    setEditing(null);
  };

  return (
    <div className="tool-stack local">
      <div className="toolbar">
        {plugins.length > 0 && <Seg value={cur?.id ?? ''} onChange={(v) => { setSel(v); setEditing(null); }} opts={plugins.map((p) => ({ value: p.id, label: p.def.name }))} />}
        <button className={'btn' + (editing === 'new' ? ' on' : '')} onClick={() => setEditing(editing === 'new' ? null : 'new')}>＋ {L.create}</button>
      </div>
      {editing === 'new'
        ? <Editor key="new" initial={TEMPLATE} onSave={create} onCancel={plugins.length ? () => setEditing(null) : undefined} />
        : !cur
          ? <Intro onStart={() => setEditing('new')} />
          : editing === cur.id
            ? <Editor key={cur.id} initial={cur.src} onCancel={() => setEditing(null)}
                onSave={(src) => { const r = parseDef(src); if ('def' in r) { apply(plugins.map((p) => (p.id === cur.id ? { ...p, src, def: r.def } : p))); setEditing(null); } }}
                onRemove={() => { void run.forget(cur.id); apply(plugins.filter((p) => p.id !== cur.id)); setEditing(null); }} />
            : <Dashboard key={cur.id} p={cur} onEdit={() => setEditing(cur.id)} onKeys={(keys) => apply(plugins.map((p) => (p.id === cur.id ? { ...p, keys } : p)))} />}
      <Proxy />
    </div>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  const { T } = useApp();
  return (
    <section className="card local-intro">
      <p>{T.local.intro}</p>
      <button className="btn inv" onClick={onStart}>{T.local.template}</button>
    </section>
  );
}

function Proxy() {
  const { T } = useApp();
  const L = T.local;
  return <div className="local-proxy">{L.proxy} <code>{L.proxyCmd}</code> {L.proxyThen}</div>;
}

function Editor({ initial, onSave, onCancel, onRemove }: { initial: string; onSave: (src: string) => void; onCancel?: () => void; onRemove?: () => void }) {
  const { T } = useApp();
  const L = T.local;
  const [src, setSrc] = useState(initial);
  const [sure, setSure] = useState(false);
  const r = parseDef(src);
  return (
    <section className="card local-editor">
      <div className="card-head"><span style={{ fontWeight: 600 }}>{L.def}</span></div>
      <textarea className="area mono" value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false} aria-label={L.def} rows={18} />
      {'errors' in r && (
        <div className="local-errors">
          <div>{f(L.errors, { n: r.errors.length })}</div>
          <ul>{r.errors.map((e) => <li key={e} className="mono">{e}</li>)}</ul>
        </div>
      )}
      <div className="local-editor-btns">
        <button className="btn inv" disabled={'errors' in r} onClick={() => onSave(src)}>{L.save}</button>
        {onCancel && <button className="btn" onClick={onCancel}>{L.cancel}</button>}
        <span className="spacer" />
        {onRemove && <button className="btn danger" onClick={() => (sure ? onRemove() : setSure(true))}>{sure ? L.removeAsk : L.remove}</button>}
      </div>
    </section>
  );
}

function Keys({ keys, onChange }: { keys: PluginKey[]; onChange: (k: PluginKey[]) => void }) {
  const { T } = useApp();
  const L = T.local;
  // Edited here; saved (and refreshed) when a box loses focus, not on every keystroke.
  const [draft, setDraft] = useState(keys);
  useEffect(() => setDraft(keys), [keys]);
  const commit = (d: PluginKey[]) => { if (JSON.stringify(d) !== JSON.stringify(keys)) onChange(d); };
  const edit = (i: number, patch: Partial<PluginKey>) => setDraft(draft.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  // Opens folded when every key is filled in, open otherwise; then the user opens and closes it.
  const [open, setOpen] = useState(() => !keys.length || keys.some((k) => !k.key));
  return (
    <details className="card local-keys" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{f(L.keysCount, { n: keys.filter((k) => k.key).length })}</summary>
      {draft.map((k, i) => (
        <div key={k.id} className="local-key-row">
          <input className="field" value={k.name} placeholder={L.keyName} onChange={(e) => edit(i, { name: e.target.value })} onBlur={() => commit(draft)} aria-label={L.keyName} />
          <input className="field mono" type="password" value={k.key} placeholder={L.keyValue} onChange={(e) => edit(i, { key: e.target.value.trim() })} onBlur={() => commit(draft)} autoComplete="off" spellCheck={false} aria-label={L.keyValue} />
          <button className="ghost" title={L.removeKey} aria-label={L.removeKey} onClick={() => { const d = draft.filter((_, j) => j !== i); setDraft(d); commit(d); }}>×</button>
        </div>
      ))}
      <div className="local-key-foot">
        <button className="btn sm" onClick={() => setDraft([...draft, { id: newId(), name: '', key: '' }])}>＋ {L.addKey}</button>
        <span>{L.keysNote}</span>
      </div>
    </details>
  );
}

function Bar({ label, used, limit }: { label: string; used: number | null; limit: number | null }) {
  const { T } = useApp();
  if (used === null && limit === null) return null;
  if (!limit || limit <= 0) {
    if (!used) return null;
    return <div className="local-bar"><div className="local-bar-text"><span>{label}</span><span className="mono">{f(T.local.noLimit, { u: fmt(used) })}</span></div></div>;
  }
  const pct = ((used ?? 0) / limit) * 100;
  const level = pct >= 100 ? 'full' : pct >= 80 ? 'high' : '';
  return (
    <div className={'local-bar ' + level}>
      <div className="local-bar-text"><span>{label}</span><span className="mono">{fmt(used)} / {fmt(limit)} · {pct.toFixed(1)}%</span></div>
      <div className="local-bar-track"><div className="local-bar-fill" style={{ width: Math.min(100, pct) + '%' }} /></div>
    </div>
  );
}

function Card({ def, k, r }: { def: DashDef; k: PluginKey; r?: Reading }) {
  const { T } = useApp();
  const L = T.local;
  const title = k.name || r?.title || mask(k.key);
  return (
    <section className={'card local-card' + (r && !r.ok ? ' bad' : '')}>
      <div className="local-card-head">
        <span className={'local-dot' + (!r ? '' : r.ok ? ' ok' : ' bad')} />
        <span className="local-card-title">{title}</span>
        {k.name && r?.title && r.title !== k.name && <span className="local-card-sub">{r.title}</span>}
        <span className="local-card-time">{time(r?.at)}</span>
      </div>
      {!r ? <div className="local-wait">{L.waiting}</div> : !r.ok && <div className="local-err">{r.error === 'connect' ? L.connect : r.error === 'timeout' ? L.timeout : r.error}</div>}
      {r?.ok && (
        <>
          {def.values.length > 0 && (
            <div className="local-values">
              {def.values.map((v) => <div key={v.path}><span>{v.label}</span><b className="mono">{fmt(r.values[v.path])}</b></div>)}
            </div>
          )}
          {def.bars.map((b) => <Bar key={b.label + b.used} label={b.label} used={r.values[b.used] ?? null} limit={r.values[b.limit] ?? null} />)}
        </>
      )}
    </section>
  );
}

const PALETTE = ['--acc', '--str', '--bool', '--date', '--num', '--del', '--chg'];

function Chart({ title, xs, series }: { title: string; xs: number[]; series: { label: string; ys: (number | null)[] }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const color = (i: number) => css.getPropertyValue(PALETTE[i % PALETTE.length]).trim() || '#3d6df2';
    const axis = { stroke: css.getPropertyValue('--faint').trim(), grid: { stroke: css.getPropertyValue('--line').trim(), width: 1 }, ticks: { stroke: css.getPropertyValue('--line').trim() } };
    const u = new uPlot({
      width: el.clientWidth, height: 220, title,
      series: [{}, ...series.map((s, i) => ({ label: s.label, stroke: color(i), width: 2, spanGaps: false, value: (_u: uPlot, v: number | null) => fmt(v) }))],
      axes: [axis, { ...axis, size: 60 }],
      scales: { x: { time: true } },
      legend: { live: true },
    }, [xs.map((t) => t / 1000), ...series.map((s) => s.ys)] as uPlot.AlignedData, el);
    plot.current = u;
    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height: 220 }));
    ro.observe(el);
    return () => { ro.disconnect(); u.destroy(); plot.current = null; };
  }, [title, xs, series]);
  return <div ref={box} className="local-chart" />;
}

function Trends({ p }: { p: Plugin }) {
  const { T } = useApp();
  const L = T.local;
  const [range, setRange] = useOpt<Range>('local.range', 'h24', ['h1', 'h24', 'd7']);
  const [hist, setHist] = useState<run.Sample[]>([]);
  const stamp = run.lastRefresh(p.id);
  useEffect(() => { let live = true; void run.history(p.id).then((h) => { if (live) setHist(h); }); return () => { live = false; }; }, [p.id, stamp]);
  // Rebuilt when the history or the range changes, not on every refresh tick.
  const names = p.keys.map((k, i) => k.name || run.readingOf(p.id, k.id)?.title || `#${i + 1}`).join('\u0000');
  const charts = useMemo(() => {
    const from = Date.now() - RANGES[range];
    const shown = hist.filter((s) => s.t >= from && p.keys.some((k) => k.id === s.k));
    const xs = [...new Set(shown.map((s) => s.t))].sort((a, b) => a - b);
    const idx = new Map(xs.map((t, i) => [t, i]));
    const labels = names.split('\u0000');
    return { xs, list: p.def.trends.map((tr) => ({ tr, series: p.keys.map((k, i) => {
      const ys: (number | null)[] = xs.map(() => null);
      for (const s of shown) if (s.k === k.id) ys[idx.get(s.t)!] = s.v[tr.path] ?? null;
      return { label: labels[i], ys };
    }) })) };
  }, [hist, range, p.keys, p.def.trends, names]);
  if (!p.def.trends.length) return null;
  return (
    <section className="card local-trends">
      <div className="card-head">
        <span style={{ fontWeight: 600 }}>{L.trends}</span>
        <Seg size="sm" value={range} onChange={setRange} opts={(['h1', 'h24', 'd7'] as const).map((r) => ({ value: r, label: L.range[r] }))} />
      </div>
      {!charts.xs.length ? <div className="local-wait" style={{ padding: 16 }}>{L.noData}</div>
        : charts.list.map(({ tr, series }) => <Chart key={tr.path + range} title={tr.label} xs={charts.xs} series={series} />)}
    </section>
  );
}

function Dashboard({ p, onEdit, onKeys }: { p: Plugin; onEdit: () => void; onKeys: (k: PluginKey[]) => void }) {
  const { T } = useApp();
  const L = T.local;
  useRun();
  const busy = run.refreshing(p.id);
  const keys = useMemo(() => p.keys.filter((k) => k.key), [p.keys]);
  const withKeys = useMemo(() => ({ ...p, keys }), [p, keys]);
  return (
    <>
      <div className="local-bar-line">
        <span>{f(L.every, { s: p.def.interval })}{run.lastRefresh(p.id) ? ' · ' + f(L.updated, { t: time(run.lastRefresh(p.id)) }) : ''}</span>
        <span className="spacer" />
        <button className="btn sm" disabled={busy || !keys.length} onClick={() => void run.refresh(p)}>{busy ? L.refreshing : L.refresh}</button>
        <button className="btn sm" onClick={onEdit}>{L.edit}</button>
      </div>
      <Keys keys={p.keys} onChange={onKeys} />
      {!keys.length ? <div className="local-wait">{L.noKeys}</div> : (
        <div className="local-cards">{keys.map((k) => <Card key={k.id} def={p.def} k={k} r={run.readingOf(p.id, k.id)} />)}</div>
      )}
      {keys.length > 0 && <Trends p={withKeys} />}
    </>
  );
}
