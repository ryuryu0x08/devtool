// Input and result side by side or stacked, chosen per tool and remembered. The gap between them
// is dragged to share the width; the handle on the result is dragged to the right or below
// (a click on it switches too). Narrow screens always stack.
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useApp } from '../store';
import { useOpt } from './Panes';

/** Below this width the two panes don't fit side by side. */
const STACK_BELOW = 720;
/** Neither pane gets narrower than this when the width is shared. */
const MIN_PANE = 280;
const GAP = 16;

type Mode = 'row' | 'col';
interface Drag { target: Mode; zone: { left: number; top: number; width: number; height: number } }

export function Split({ a, b, id }: { a: ReactNode; b: ReactNode; id?: string }) {
  const { S, T } = useApp();
  const key = id ?? S.tool;
  const [mode, setMode] = useOpt<Mode>('lay.' + key, 'row', ['row', 'col']);
  const [ratio, setRatio] = useOpt('split.' + key, 0.5);
  const box = useRef<HTMLDivElement>(null);
  const paneA = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [live, setLive] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width > 0 && width < STACK_BELOW;
  const shown: Mode = narrow ? 'col' : mode;
  const clamp = (r: number) => {
    const lo = width > GAP ? Math.min(0.5, MIN_PANE / (width - GAP)) : 0.25;
    return Math.min(1 - lo, Math.max(lo, r));
  };
  const r = clamp(live ?? (Number.isFinite(ratio) ? ratio : 0.5));

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
      document.body.classList.remove('dragging-x');
      setLive(null);
      setRatio(Math.round(last * 1000) / 1000);
    };
    document.body.classList.add('dragging-x');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Handle on the result: drag it up / right or down; a click without moving switches.
  const zoneFor = (y: number): Drag => {
    const rect = box.current!.getBoundingClientRect();
    const ra = paneA.current!.getBoundingClientRect();
    const target: Mode = y > ra.top + ra.height * 0.7 ? 'col' : 'row';
    const zone = target === 'row'
      ? { left: rect.left + rect.width / 2 + GAP / 2, top: ra.top, width: rect.width / 2 - GAP / 2, height: ra.height }
      : shown === 'row'
        ? { left: rect.left, top: rect.top + rect.height * 0.62, width: rect.width, height: rect.height * 0.38 }
        : { left: rect.left, top: ra.bottom + GAP, width: rect.width, height: Math.max(80, rect.bottom - ra.bottom - GAP) };
    return { target, zone };
  };
  const onGrip = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, last: Drag | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true;
      last = zoneFor(ev.clientY);
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-move');
      setDrag(null);
      if (!moved) setMode(shown === 'row' ? 'col' : 'row');
      else if (last) setMode(last.target);
    };
    document.body.classList.add('dragging-move');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const grid: CSSProperties = shown === 'row'
    ? { display: 'grid', gridTemplateColumns: `minmax(0, ${r}fr) ${GAP}px minmax(0, ${1 - r}fr)`, alignItems: 'stretch' }
    : { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', rowGap: GAP };

  return (
    <div ref={box} className={'split ' + shown} style={grid} data-layout={shown}>
      <div ref={paneA} className="split-pane">{a}</div>
      {shown === 'row' && (
        <div className="split-gutter" role="separator" aria-orientation="vertical" title={T.ui.resize}
          onPointerDown={onGutter} onDoubleClick={() => setRatio(0.5)}><span /></div>
      )}
      <div className={'split-pane result' + (drag ? ' moving' : '')}>
        {!narrow && (
          <button className="split-grip" title={T.ui.grip} aria-label={T.ui.grip} onPointerDown={onGrip}
            onClick={(e) => { if (e.detail === 0) setMode(shown === 'row' ? 'col' : 'row'); }}>
            <svg width="16" height="6" viewBox="0 0 16 6" aria-hidden="true">
              {[1.5, 6, 10.5, 15].flatMap((x) => [<circle key={x + 'a'} cx={x - 0.5} cy="1.2" r="1.1" />, <circle key={x + 'b'} cx={x - 0.5} cy="4.8" r="1.1" />])}
            </svg>
          </button>
        )}
        {b}
      </div>
      {drag && (
        <div className="split-zone" style={{ position: 'fixed', left: drag.zone.left, top: drag.zone.top, width: drag.zone.width, height: drag.zone.height }}>
          <span>{drag.target === 'row' ? T.ui.toRight : T.ui.toBottom}</span>
        </div>
      )}
    </div>
  );
}

/** <Pair>{input}{result}</Pair>: the same, with the two panes as children. */
export function Pair({ children, id }: { children: ReactNode[]; id?: string }) {
  return <Split id={id} a={children[0]} b={children[1]} />;
}
