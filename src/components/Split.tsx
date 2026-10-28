// Input and result side by side or stacked, chosen per tool and remembered. The gap between them
// is dragged to share the width. The result is picked up by its handle and carried: it follows
// the pointer, and the layout switches as soon as it is carried a short way down (below) or up
// or right (beside), the input pane moving to make room; a label on it says where it will land.
// On release it settles into its place, scrolled into view. A click on the handle switches too.
// The input has one height in both layouts, so switching doesn't change it (a longer result can be
// taller). Side by side, the bar below sets it for both panes; stacked, the bar between them sets it
// and the bar below the result sets the result's own (all remembered).
// Narrow screens always stack.
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useApp } from '../store';
import { useOpt } from './Panes';
import { useZoom } from './Zoom';

/** Below this width the two panes don't fit side by side. */
const STACK_BELOW = 720;
/** Neither pane gets narrower than this when the width is shared. */
const MIN_PANE = 280;
const GAP = 16;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Screen px the result is carried, from where it was picked up or last switched, to switch:
 *  down for below; up, or right (a bit farther), for beside. */
const SWITCH = 72;
/** Stacked, the input and the result are never shorter than these (px at 100 %). */
const MIN_H = 120;
const MIN_OUT = 160;

type Mode = 'row' | 'col';

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export function Split({ a, b, id }: { a: ReactNode; b: ReactNode; id?: string }) {
  const { S, T } = useApp();
  const key = id ?? S.tool;
  const [mode, setMode] = useOpt<Mode>('lay.' + key, 'row', ['row', 'col']);
  const [ratio, setRatio] = useOpt('split.' + key, 0.5);
  /** Input height in px at 100 %, in both layouts (0: the default, set by the stylesheet). */
  const [inH, setInH] = useOpt('hsplit.' + key, 0);
  const [liveH, setLiveH] = useState<number | null>(null);
  /** Stacked result height, the same way. */
  const [outH, setOutH] = useOpt('hsplit.' + key + '.out', 0);
  const [liveOut, setLiveOut] = useState<number | null>(null);
  // Rects and the pointer are in screen px; lengths written into styles here are scaled by the
  // tool area's zoom, so they are divided by it.
  const z = useZoom()[0] / 100;
  const box = useRef<HTMLDivElement>(null);
  const paneA = useRef<HTMLDivElement>(null);
  const slotB = useRef<HTMLDivElement>(null);
  const floatB = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  /** Layout while the result is being carried (null when it isn't). */
  const [target, setTarget] = useState<Mode | null>(null);
  /** Where the result was grabbed (fraction of its width, px from its top), its width then, and the pointer now. */
  const grab = useRef<{ fx: number; oy: number; w: number; x: number; y: number } | null>(null);
  /** Pane rects of the layout on screen: measured after each layout change and again right before
   *  one is asked for (not on every render: each keystroke re-renders the tool). */
  const prev = useRef<{ shown: Mode; a: DOMRect; b: DOMRect } | null>(null);
  /** The next layout change was asked for here (click, key, carry), so it slides; a narrower window just switches. */
  const animate = useRef(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width > 0 && width < STACK_BELOW;
  const shown: Mode = narrow ? 'col' : target ?? mode;
  const clamp = (r: number) => {
    const lo = width > GAP ? Math.min(0.5, MIN_PANE / (width - GAP)) : 0.25;
    return Math.min(1 - lo, Math.max(lo, r));
  };
  const r = clamp(live ?? (Number.isFinite(ratio) ? ratio : 0.5));

  /** Keep the carried result under the pointer, wherever its slot is now; sideways it stays within
   *  the tool area (as wide as it, when it would land below, it only moves up and down). */
  const place = () => {
    const g = grab.current, f = floatB.current, s = slotB.current, c = box.current;
    if (!g || !f || !s || !c) return;
    const rs = s.getBoundingClientRect(), rc = c.getBoundingClientRect();
    const left = Math.max(rc.left, Math.min(rc.right - g.w, g.x - g.fx * g.w));
    f.style.transform = `translate(${(left - rs.left) / z}px, ${(g.y - g.oy - rs.top) / z}px)`;
  };

  const measure = () => {
    const A = paneA.current, B = slotB.current;
    if (A && B) prev.current = { shown, a: A.getBoundingClientRect(), b: B.getBoundingClientRect() };
  };
  /** Switch side by side ⇄ stacked, sliding from where the panes are now. */
  const toggle = () => {
    measure();
    animate.current = true;
    setMode(shown === 'row' ? 'col' : 'row');
  };

  // After a layout change, the panes move from where they were (width and position animate).
  useLayoutEffect(() => {
    const A = paneA.current, B = slotB.current, F = floatB.current;
    if (!A || !B || !F) return;
    const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect();
    const p = prev.current;
    const g = grab.current;
    const slide = animate.current && !!p && p.shown !== shown && !reduced();
    const opts = { duration: 260, easing: EASE };
    if (slide) {
      A.animate([{ width: p.a.width / z + 'px', transform: `translate(${(p.a.left - ra.left) / z}px, ${(p.a.top - ra.top) / z}px)` }, { width: ra.width / z + 'px', transform: 'none' }], opts);
      // A result that isn't carried moves with the layout.
      if (!g) F.animate([{ width: p.b.width / z + 'px', transform: `translate(${(p.b.left - rb.left) / z}px, ${(p.b.top - rb.top) / z}px)` }, { width: rb.width / z + 'px', transform: 'none' }], opts);
    }
    animate.current = false;
    // Carried: as wide as the slot it would land in, so it lands at the size it shows. It grows or
    // shrinks from where it was.
    if (g && g.w !== rb.width) {
      const was = F.getBoundingClientRect();
      g.w = rb.width;
      F.style.width = g.w / z + 'px';
      place();
      if (slide) F.animate([{ width: was.width / z + 'px', marginLeft: (was.left - F.getBoundingClientRect().left) / z + 'px' }, { width: g.w / z + 'px', marginLeft: '0px' }], opts);
    }
    if (g) place();
    prev.current = { shown, a: ra, b: rb };
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gap between the panes: drag to share the width; double-click to share it equally.
  const onGutter = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = box.current!.getBoundingClientRect();
    const at = (x: number) => clamp((x - rect.left - GAP / 2) / (rect.width - GAP));
    let last = r;
    const move = (ev: PointerEvent) => { last = at(ev.clientX); setLive(last); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging-x');
      setLive(null);
      setRatio(Math.round(last * 1000) / 1000);
    };
    document.body.classList.add('dragging-x');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Bars of stacked panes (between them, and below the result): drag to set the height of the pane
  // above; double-click for the default.
  const dragHeight = (e: RPointerEvent<HTMLDivElement>, pane: HTMLElement, min: number, setLive: (h: number | null) => void, commit: (h: number) => void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY, h0 = pane.getBoundingClientRect().height / z;
    let last = h0;
    const move = (ev: PointerEvent) => { last = Math.max(min, h0 + (ev.clientY - y0) / z); setLive(last); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging-y');
      setLive(null);
      if (last !== h0) commit(Math.round(last));
    };
    document.body.classList.add('dragging-y');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** The layout for the result carried by (dx, dy) since it was picked up or last switched. Measured
   *  from the last switch, so going back takes the same deliberate move and it doesn't flicker. */
  const decide = (cur: Mode, dx: number, dy: number): Mode => {
    if (cur === 'row') return dy > SWITCH ? 'col' : 'row';
    return dy < -SWITCH || dx > SWITCH * 1.5 ? 'row' : 'col';
  };

  /** A stacked result that landed mostly below the window is scrolled up into view. */
  const reveal = () => {
    const s = slotB.current;
    if (!s) return;
    const top = s.getBoundingClientRect().top, h = innerHeight;
    if (top > h * 0.6) scrollBy({ top: top - h * 0.35, behavior: reduced() ? 'auto' : 'smooth' });
  };

  const onGrip = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rf = floatB.current!.getBoundingClientRect();
    const g = { fx: (e.clientX - rf.left) / rf.width, oy: e.clientY - rf.top, w: rf.width, x: e.clientX, y: e.clientY };
    let moved = false, tgt: Mode = shown;
    /** Where it was picked up or last switched. */
    const from = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 5) return;
        moved = true;
        measure();
        grab.current = g;
        floatB.current!.style.width = g.w / z + 'px';
        document.body.classList.add('dragging-move');
        setTarget(tgt);
      }
      g.x = ev.clientX;
      g.y = ev.clientY;
      const next = decide(tgt, ev.clientX - from.x, ev.clientY - from.y);
      if (next !== tgt) { tgt = next; from.x = ev.clientX; from.y = ev.clientY; animate.current = true; setTarget(next); }
      place();
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved) { if (ev.type === 'pointerup') toggle(); return; }
      document.body.classList.remove('dragging-move');
      // Let go: it settles into its slot, taking the slot's width. Cancelled (a system gesture took
      // the pointer): the layout it was carried from comes back.
      const cancel = ev.type === 'pointercancel';
      const f = floatB.current, t = f?.style.transform, w = f?.style.width;
      grab.current = null;
      if (!cancel) setMode(tgt);
      else if (tgt !== mode) animate.current = true;
      setTarget(null);
      if (f) {
        f.style.transform = '';
        f.style.width = '';
        if (!cancel && t && !reduced()) f.animate([{ transform: t, width: w }, { transform: 'none', width: slotB.current!.getBoundingClientRect().width / z + 'px' }], { duration: 260, easing: EASE });
      }
      if (!cancel && tgt === 'col') requestAnimationFrame(reveal);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** A stored height, or 0 for the default. */
  const stored = (v: number, min: number) => (Number.isFinite(v) && v > 0 ? Math.max(min, v) : 0);
  const h = liveH ?? stored(inH, MIN_H);
  const ho = liveOut ?? stored(outH, MIN_OUT);
  const outSized = shown === 'col' && ho > 0;
  const rowSized = shown === 'row' && h > 0;
  const grid: CSSProperties = shown === 'row'
    ? { display: 'grid', gridTemplateColumns: `minmax(0, ${r}fr) ${GAP}px minmax(0, ${1 - r}fr)`, gridTemplateRows: rowSized ? `${h}px auto` : undefined, alignItems: 'stretch' }
    : { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' };
  const carrying = target !== null;
  // Stacked: the input has its height (by default, the shared default height); the result is at
  // least as tall unless it has its own.
  const inStyle: CSSProperties | undefined = shown === 'col' ? { height: h || 'var(--pane-h)' } : undefined;
  const outStyle: CSSProperties | undefined = shown === 'col' ? (outSized ? { height: ho } : { minHeight: h || 'var(--pane-h)' }) : undefined;

  return (
    <div ref={box} className={'split ' + shown + (outSized ? ' out-sized' : '') + (rowSized ? ' row-sized' : '')} style={grid} data-layout={shown}>
      <div ref={paneA} className="split-pane" style={inStyle}>{a}</div>
      {shown === 'col' && (
        <div className="split-hgutter" role="separator" aria-orientation="horizontal" title={T.ui.resizeH}
          onPointerDown={(e) => dragHeight(e, paneA.current!, MIN_H, setLiveH, setInH)} onDoubleClick={() => setInH(0)}><span /></div>
      )}
      {shown === 'row' && (
        <div className="split-gutter" role="separator" aria-orientation="vertical" title={T.ui.resize}
          onPointerDown={onGutter} onDoubleClick={() => setRatio(0.5)}><span /></div>
      )}
      <div ref={slotB} className={'split-pane result' + (carrying ? ' holding' : '')} style={outStyle}>
        <div ref={floatB} className={'split-float' + (carrying ? ' carried' : '')}>
          {!narrow && (
            <button className="split-grip" title={T.ui.grip} aria-label={T.ui.grip} onPointerDown={onGrip}
              onClick={(e) => { if (e.detail === 0) toggle(); }}>
              <svg width="16" height="6" viewBox="0 0 16 6" aria-hidden="true">
                {[1.5, 6, 10.5, 15].flatMap((x) => [<circle key={x + 'a'} cx={x - 0.5} cy="1.2" r="1.1" />, <circle key={x + 'b'} cx={x - 0.5} cy="4.8" r="1.1" />])}
              </svg>
            </button>
          )}
          {carrying && <div className="split-hint" aria-hidden="true">{shown === 'row' ? T.ui.dropBeside : T.ui.dropBelow}</div>}
          {b}
        </div>
      </div>
      {shown === 'col' && (
        <div className="split-hgutter end" role="separator" aria-orientation="horizontal" title={T.ui.resizeOut}
          onPointerDown={(e) => dragHeight(e, slotB.current!, MIN_OUT, setLiveOut, setOutH)} onDoubleClick={() => setOutH(0)}><span /></div>
      )}
      {shown === 'row' && (
        <div className="split-hgutter end" role="separator" aria-orientation="horizontal" title={T.ui.resizeRow} style={{ gridColumn: '1 / -1' }}
          onPointerDown={(e) => dragHeight(e, paneA.current!, MIN_H, setLiveH, setInH)} onDoubleClick={() => setInH(0)}><span /></div>
      )}
    </div>
  );
}

/** <Pair>{input}{result}</Pair>: the same, with the two panes as children. */
export function Pair({ children, id }: { children: ReactNode[]; id?: string }) {
  return <Split id={id} a={children[0]} b={children[1]} />;
}
