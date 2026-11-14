// The capture: the backend's flows as they come (a long list is drawn only where it is seen), the
// filter box, and the selected request in detail.
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { f } from '../../i18n';
import { useApp } from '../../store';
import { useFillHeight } from '../../components/useFillHeight';
import { fmtWall } from '../../lib/time';
import type { BackendInfo, Flow, FlowEvent, ProxyBackend } from '../../lib/proxy/backend';
import { EMPTY, applyEvents, compileFilter, contentType, duration, formatDuration, formatSize, state, type FlowList } from '../../lib/proxy/flows';
import { useBackendError } from './errors';
import Detail from './Detail';

/** Events are applied in batches (a busy proxy sends hundreds a second). */
const FLUSH_MS = 50;
/** A row's height in CSS px of the tool area (matches .px-tr). */
const ROW = 28;
/** Rows drawn beyond the visible ones, above and below. */
const OVERSCAN = 12;
/** How long "clear" can be undone before the flows are dropped from the backend. */
const UNDO_MS = 6000;

/** Kept while the page is open: switching tools keeps the filter, and a clear still being undone. */
const mem = { filter: '', hidden: new Set<string>() };

export default function Capture({ b, info, onLive }: { b: ProxyBackend; info: BackendInfo; onLive: (live: boolean) => void }) {
  const { T, S, toast } = useApp();
  const P = T.px;
  const errText = useBackendError();
  const [list, setList] = useState<FlowList>(EMPTY);
  const [frozen, setFrozen] = useState<FlowList | null>(null);
  const [hiddenV, bump] = useReducer((n: number) => n + 1, 0);
  const [q, setQState] = useState(mem.filter);
  const setQ = (v: string) => { mem.filter = v; setQState(v); };
  const [sel, setSel] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const height = useFillHeight(box, 420);

  useEffect(() => {
    let queue: FlowEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => { timer = undefined; const ev = queue; queue = []; setList((s) => applyEvents(s, ev)); };
    const stop = b.watch((e) => { queue.push(e); timer ??= setTimeout(flush, FLUSH_MS); }, onLive);
    return () => { stop(); clearTimeout(timer); };
  }, [b, onLive]);

  const source = frozen ?? list;
  const match = useMemo(() => compileFilter(q), [q]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kept = useMemo(() => source.list.filter((x) => !mem.hidden.has(x.id)), [source, hiddenV]);
  const rows = useMemo(() => kept.filter(match), [kept, match]);
  // The detail follows the live flow (its response arrives), even while the list is paused.
  const selected = sel === null ? null : list.list[list.index.get(sel) ?? -1] ?? null;
  const fresh = frozen ? list.list.filter((x) => !mem.hidden.has(x.id)).length - kept.length : 0;

  const unhide = (ids: string[]) => { for (const id of ids) mem.hidden.delete(id); bump(); };
  const clear = () => {
    const ids = list.list.filter((x) => !mem.hidden.has(x.id)).map((x) => x.id);
    if (!ids.length) return;
    for (const id of ids) mem.hidden.add(id);
    bump();
    setSel(null);
    setFrozen(null);
    const t = setTimeout(() => {
      b.remove(ids).then(() => { for (const id of ids) mem.hidden.delete(id); }, (e) => { unhide(ids); toast(errText(e), 6000); });
    }, UNDO_MS);
    toast(f(P.cleared, { n: ids.length }), UNDO_MS, () => { clearTimeout(t); unhide(ids); });
  };

  return (
    <section ref={box} className="card px-cap" style={height ? { height } : undefined}>
      <div className="card-head px-cap-head">
        <input className="field px-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder={P.filterPh} spellCheck={false} aria-label={P.filterPh} />
        <span className="px-count">{q.trim() ? f(P.countOf, { m: rows.length, n: kept.length }) : f(P.count, { n: kept.length })}</span>
        <button className={'btn sm' + (frozen ? ' on' : '')} onClick={() => setFrozen(frozen ? null : list)} aria-pressed={!!frozen}>{frozen ? P.resume : P.pause}</button>
        <button className="btn sm" onClick={clear} disabled={!kept.length && !frozen}>{P.clear}</button>
      </div>
      {frozen && <div className="px-paused">{f(P.paused, { n: Math.max(0, fresh) })}</div>}
      <div className="px-cap-body">
        <FlowTable rows={rows} sel={sel} onSel={setSel} tz={S.tz}
          empty={kept.length ? P.noMatch : f(P.empty, { p: `127.0.0.1:${info.proxyPort}` })} />
        <div className="px-detail">
          {selected ? <Detail key={selected.id} b={b} flow={selected} /> : <div className="px-pick">{P.pick}</div>}
        </div>
      </div>
    </section>
  );
}

const time = (ms: number, tz: string) => fmtWall(ms, tz).slice(11) + '.' + String(Math.floor(ms) % 1000).padStart(3, '0');

function FlowTable({ rows, sel, onSel, tz, empty }: { rows: Flow[]; sel: string | null; onSel: (id: string) => void; tz: string; empty: string }) {
  const { T } = useApp();
  const C = T.px.col;
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState({ first: 0, count: 2 * OVERSCAN });
  const atEnd = useRef(true);

  // Row size from the layout itself (the tool area may be zoomed), in the units scrollTop uses.
  const rowPx = useCallback(() => (rows.length && spacer.current ? spacer.current.offsetHeight / rows.length : ROW), [rows.length]);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const r = rowPx();
    const first = Math.max(0, Math.floor(el.scrollTop / r) - OVERSCAN);
    const count = Math.ceil(el.clientHeight / r) + 2 * OVERSCAN;
    setWin((w) => (w.first === first && w.count === count ? w : { first, count }));
    atEnd.current = el.scrollTop + el.clientHeight >= el.scrollHeight - r;
  }, [rowPx]);

  // New rows keep the list at its end, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
    measure();
  }, [rows.length, measure]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = sel === null ? -1 : rows.findIndex((x) => x.id === sel);
    const j = Math.min(rows.length - 1, Math.max(0, i < 0 ? (e.key === 'ArrowDown' ? 0 : rows.length - 1) : i + (e.key === 'ArrowDown' ? 1 : -1)));
    if (j < 0) return;
    onSel(rows[j].id);
    const el = scroller.current!, r = rowPx();
    if (j * r < el.scrollTop) el.scrollTop = j * r;
    else if ((j + 1) * r > el.scrollTop + el.clientHeight) el.scrollTop = (j + 1) * r - el.clientHeight;
  };

  const shown = rows.slice(win.first, win.first + win.count);
  return (
    <div className="px-table">
      <div className="px-tr px-th" aria-hidden="true">
        <span>{C.time}</span><span>{C.method}</span><span>{C.status}</span><span>{C.host}</span><span>{C.path}</span><span className="px-c-type">{C.type}</span><span className="px-c-num">{C.size}</span><span className="px-c-num">{C.duration}</span>
      </div>
      <div ref={scroller} className="px-tbody" role="listbox" aria-label={T.px.tabs.capture} tabIndex={0} onScroll={measure} onKeyDown={key}>
        {!rows.length && <div className="px-empty">{empty}</div>}
        <div ref={spacer} style={{ height: rows.length * ROW, position: 'relative' }}>
          {shown.map((x, i) => {
            const st = state(x);
            return (
              <div key={x.id} role="option" aria-selected={x.id === sel} className={'px-tr' + (x.id === sel ? ' sel' : '')}
                style={{ position: 'absolute', top: (win.first + i) * ROW, left: 0, right: 0 }} onClick={() => onSel(x.id)}>
                <span className="px-c-time">{time(x.created, tz)}</span>
                <span className="px-c-method">{x.method}</span>
                <span className={'px-c-status ' + st}>{x.response?.status ?? (st === 'error' ? '✕' : st === 'pending' ? '…' : '')}</span>
                <span className="px-c-host" title={x.host}>{x.host}</span>
                <span className="px-c-path" title={x.path}>{x.path}</span>
                <span className="px-c-type">{contentType(x).replace(/^application\//, '')}</span>
                <span className="px-c-num">{formatSize(x.response?.size)}</span>
                <span className="px-c-num">{formatDuration(duration(x))}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
