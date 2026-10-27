// Input and result side by side or stacked, chosen per tool and remembered. The gap between them
// is dragged to share the width. The result is picked up by its handle and carried: it follows
// the pointer, and the layout switches as soon as it crosses over, the input pane moving to
// make room; on release it settles into its place. A click on the handle switches too.
// Narrow screens always stack.
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useApp } from '../store';
import { useOpt } from './Panes';

/** Below this width the two panes don't fit side by side. */
const STACK_BELOW = 720;
/** Neither pane gets narrower than this when the width is shared. */
const MIN_PANE = 280;
const GAP = 16;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

type Mode = 'row' | 'col';

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export function Split({ a, b, id }: { a: ReactNode; b: ReactNode; id?: string }) {
  const { S, T } = useApp();
  const key = id ?? S.tool;
  const [mode, setMode] = useOpt<Mode>('lay.' + key, 'row', ['row', 'col']);
  const [ratio, setRatio] = useOpt('split.' + key, 0.5);
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

  /** Keep the carried result under the pointer, wherever its slot is now. */
  const place = () => {
    const g = grab.current, f = floatB.current, s = slotB.current;
    if (!g || !f || !s) return;
    const rs = s.getBoundingClientRect();
    f.style.transform = `translate(${g.x - g.fx * g.w - rs.left}px, ${g.y - g.oy - rs.top}px)`;
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
    if (animate.current && p && p.shown !== shown && !reduced()) {
      const opts = { duration: 260, easing: EASE };
      A.animate([{ width: p.a.width + 'px', transform: `translate(${p.a.left - ra.left}px, ${p.a.top - ra.top}px)` }, { width: ra.width + 'px', transform: 'none' }], opts);
      // A carried result follows the pointer; it shrinks to fit a narrower slot, and grows only
      // when dropped. Otherwise it moves with the layout.
      const g = grab.current;
      if (g && rb.width < g.w) {
        F.animate([{ width: g.w + 'px' }, { width: rb.width + 'px' }], opts);
        g.w = rb.width;
        F.style.width = g.w + 'px';
      }
      if (!g) F.animate([{ width: p.b.width + 'px', transform: `translate(${p.b.left - rb.left}px, ${p.b.top - rb.top}px)` }, { width: rb.width + 'px', transform: 'none' }], opts);
    }
    animate.current = false;
    if (grab.current) place();
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

  /** The layout for the carried result's top edge here: pulled about 120 px down, it goes below;
   *  brought back up level with the input (within 80 px of its top) on the right, it goes beside.
   *  The two thresholds differ, so it doesn't flicker between them. */
  const decide = (cur: Mode, x: number, top: number): Mode => {
    const ra = prev.current?.a ?? paneA.current!.getBoundingClientRect();
    const rc = box.current!.getBoundingClientRect();
    const down = Math.min(ra.height * 0.45, 120);
    if (cur === 'row') return top > ra.top + down ? 'col' : 'row';
    return top < ra.top + down - 40 && x > rc.left + rc.width * 0.4 ? 'row' : 'col';
  };

  const onGrip = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rf = floatB.current!.getBoundingClientRect();
    const g = { fx: (e.clientX - rf.left) / rf.width, oy: e.clientY - rf.top, w: rf.width, x: e.clientX, y: e.clientY };
    let moved = false, tgt: Mode = shown;
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 5) return;
        moved = true;
        measure();
        grab.current = g;
        floatB.current!.style.width = g.w + 'px';
        document.body.classList.add('dragging-move');
        setTarget(tgt);
      }
      g.x = ev.clientX;
      g.y = ev.clientY;
      const next = decide(tgt, ev.clientX, ev.clientY - g.oy);
      if (next !== tgt) { tgt = next; animate.current = true; setTarget(next); }
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
        if (!cancel && t && !reduced()) f.animate([{ transform: t, width: w }, { transform: 'none', width: slotB.current!.getBoundingClientRect().width + 'px' }], { duration: 260, easing: EASE });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const grid: CSSProperties = shown === 'row'
    ? { display: 'grid', gridTemplateColumns: `minmax(0, ${r}fr) ${GAP}px minmax(0, ${1 - r}fr)`, alignItems: 'stretch' }
    : { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', rowGap: GAP };
  const carrying = target !== null;

  return (
    <div ref={box} className={'split ' + shown} style={grid} data-layout={shown}>
      <div ref={paneA} className="split-pane">{a}</div>
      {shown === 'row' && (
        <div className="split-gutter" role="separator" aria-orientation="vertical" title={T.ui.resize}
          onPointerDown={onGutter} onDoubleClick={() => setRatio(0.5)}><span /></div>
      )}
      <div ref={slotB} className={'split-pane result' + (carrying ? ' holding' : '')}>
        <div ref={floatB} className={'split-float' + (carrying ? ' carried' : '')}>
          {!narrow && (
            <button className="split-grip" title={T.ui.grip} aria-label={T.ui.grip} onPointerDown={onGrip}
              onClick={(e) => { if (e.detail === 0) toggle(); }}>
              <svg width="16" height="6" viewBox="0 0 16 6" aria-hidden="true">
                {[1.5, 6, 10.5, 15].flatMap((x) => [<circle key={x + 'a'} cx={x - 0.5} cy="1.2" r="1.1" />, <circle key={x + 'b'} cx={x - 0.5} cy="4.8" r="1.1" />])}
              </svg>
            </button>
          )}
          {b}
        </div>
      </div>
    </div>
  );
}

/** <Pair>{input}{result}</Pair>: the same, with the two panes as children. */
export function Pair({ children, id }: { children: ReactNode[]; id?: string }) {
  return <Split id={id} a={children[0]} b={children[1]} />;
}
