// The find bar (⌘F / Ctrl+F, in the browser and the desktop app alike): finds text in the tool
// shown, its text boxes and its results, in the order they are on the page. Every match is marked,
// the current one more strongly, and scrolled to; Enter / ⌘G go to the next, Shift+Enter / ⇧⌘G to
// the one before; Esc closes, leaving the current match selected in its text box.
//
// Text in the page is marked with the CSS Custom Highlight API (no change to the page). A text
// box can't be marked inside, so a copy of its text, laid out the same, lies over it with the
// matches marked and the rest transparent; it follows the box's scrolling and size.
import { useCallback, useEffect, useRef, useState } from 'react';
import { findAll, findInPieces, FIND_MAX } from '../lib/find';
import { useApp } from '../store';

type Match =
  | { kind: 'box'; box: HTMLTextAreaElement; start: number; end: number }
  | { kind: 'text'; range: Range };

/** Elements whose text isn't searched (and that aren't descended into). */
const SKIP = new Set(['INPUT', 'SELECT', 'BUTTON', 'SCRIPT', 'STYLE', 'IFRAME', 'svg', 'CANVAS', 'OPTION']);
/** The element that holds a piece of text as a block of its own: a match doesn't run past it. */
const BLOCK = 'div, pre, p, li, td, th, h1, h2, h3, h4, section, label, summary, dd, dt';

const highlights = (): Map<string, unknown> | null => (globalThis.CSS as unknown as { highlights?: Map<string, unknown> })?.highlights ?? null;
const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;

/** Every match of `q` in `root`, in page order. */
function collect(root: Element, q: string, cs: boolean): Match[] {
  const out: Match[] = [];
  let nodes: Text[] = [];
  let block: Element | null = null;
  const flush = () => {
    if (nodes.length) {
      for (const m of findInPieces(nodes.map((n) => n.data), q, cs, FIND_MAX - out.length)) {
        const r = document.createRange();
        r.setStart(nodes[m.start.piece], m.start.offset);
        r.setEnd(nodes[m.end.piece], m.end.offset);
        out.push({ kind: 'text', range: r });
      }
    }
    nodes = [];
    block = null;
  };
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      // (A text box's own child text is its first value, not what it shows: the box is searched by its value.)
      if (n.nodeType === Node.TEXT_NODE) return n.parentElement?.tagName === 'TEXTAREA' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      const el = n as Element;
      if (SKIP.has(el.tagName) || el.classList.contains('find-mirror') || el.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;
      if (el.tagName === 'TEXTAREA') return visible(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      return visible(el) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walk.nextNode(); n && out.length < FIND_MAX; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      const b = t.parentElement?.closest(BLOCK) ?? null;
      if (b !== block) { flush(); block = b; }
      nodes.push(t);
    } else {
      flush();
      const box = n as HTMLTextAreaElement;
      for (const i of findAll(box.value, q, cs, FIND_MAX - out.length)) out.push({ kind: 'box', box, start: i, end: i + q.length });
    }
  }
  flush();
  return out;
}

/** The copy of a text box's text over it, with its matches marked (the current one too). */
function mirror(box: HTMLTextAreaElement, marks: { start: number; end: number; cur: boolean }[]): HTMLDivElement | null {
  const host = box.offsetParent as HTMLElement | null;
  if (!host) return null;
  const m = document.createElement('div');
  m.className = 'find-mirror';
  m.setAttribute('aria-hidden', 'true');
  const cs = getComputedStyle(box);
  for (const p of ['font', 'letterSpacing', 'wordSpacing', 'lineHeight', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize', 'textIndent', 'textAlign', 'direction',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
    (m.style as unknown as Record<string, string>)[p] = cs[p] as string;
  }
  place(box, m);
  const f = document.createDocumentFragment();
  let at = 0;
  for (const k of marks) {
    if (k.start > at) f.append(box.value.slice(at, k.start));
    const mk = document.createElement('mark');
    if (k.cur) mk.className = 'cur';
    mk.textContent = box.value.slice(k.start, k.end);
    f.append(mk);
    at = k.end;
  }
  f.append(box.value.slice(at) + '​');
  m.append(f);
  host.append(m);
  m.scrollTop = box.scrollTop;
  m.scrollLeft = box.scrollLeft;
  return m;
}

/** Puts a mirror where its text box is (in the box's positioned ancestor, so zoom applies to both). */
function place(box: HTMLTextAreaElement, m: HTMLDivElement) {
  Object.assign(m.style, {
    left: box.offsetLeft + box.clientLeft + 'px',
    top: box.offsetTop + box.clientTop + 'px',
    width: box.clientWidth + 'px',
    height: box.clientHeight + 'px',
  });
}

export function FindBar() {
  const { T, S } = useApp();
  const L = T.find;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cs, setCs] = useState(false);
  const [count, setCount] = useState(0);
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useRef<Match[]>([]);
  const mirrors = useRef(new Map<HTMLTextAreaElement, HTMLDivElement>());
  const back = useRef<HTMLElement | null>(null);
  const curRef = useRef(0);
  curRef.current = cur;
  const openRef = useRef(open);
  openRef.current = open;

  const clear = useCallback(() => {
    highlights()?.delete('tb-find');
    highlights()?.delete('tb-find-cur');
    for (const m of mirrors.current.values()) m.remove();
    mirrors.current.clear();
  }, []);

  /** Marks the matches, the current one (`i`) strongly, and with `scroll` brings it into view. */
  const paint = useCallback((i: number, scroll: boolean) => {
    const all = matches.current;
    const hl = highlights();
    if (hl && Highlight) {
      hl.set('tb-find', new Highlight(...all.flatMap((m) => (m.kind === 'text' ? [m.range] : []))));
      const c = all[i];
      if (c?.kind === 'text') hl.set('tb-find-cur', new Highlight(c.range)); else hl.delete('tb-find-cur');
    }
    for (const m of mirrors.current.values()) m.remove();
    mirrors.current.clear();
    const boxes = new Map<HTMLTextAreaElement, { start: number; end: number; cur: boolean }[]>();
    all.forEach((m, j) => { if (m.kind === 'box') boxes.set(m.box, [...(boxes.get(m.box) ?? []), { start: m.start, end: m.end, cur: j === i }]); });
    for (const [box, marks] of boxes) {
      const mm = mirror(box, marks);
      if (mm) mirrors.current.set(box, mm);
    }
    const c = all[i];
    if (!scroll || !c) return;
    if (c.kind === 'text') {
      c.range.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
    } else {
      const mk = mirrors.current.get(c.box)?.querySelector('mark.cur') as HTMLElement | null;
      if (mk) {
        c.box.scrollTop = Math.max(0, mk.offsetTop - c.box.clientHeight / 2);
        const m = mirrors.current.get(c.box)!;
        m.scrollTop = c.box.scrollTop;
      }
      c.box.setSelectionRange(c.start, c.end);
      c.box.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  /** Finds again (the query, the page, or the text changed), keeping to the current match's place. */
  const search = useCallback((query: string, caseS: boolean, keep: boolean) => {
    const root = document.querySelector('.content');
    matches.current = root && query ? collect(root, query, caseS) : [];
    const n = matches.current.length;
    const i = n ? (keep ? Math.min(curRef.current, n - 1) : 0) : 0;
    setCount(n);
    setCur(i);
    paint(i, !keep);
  }, [paint]);

  const go = useCallback((d: number) => {
    const n = matches.current.length;
    if (!n) return;
    const i = (curRef.current + d + n) % n;
    setCur(i);
    paint(i, true);
  }, [paint]);

  const close = useCallback(() => {
    const c = matches.current[curRef.current];
    setOpen(false);
    clear();
    matches.current = [];
    if (c?.kind === 'box') { c.box.focus(); c.box.setSelectionRange(c.start, c.end); }
    else back.current?.focus?.();
  }, [clear]);

  // ⌘F / Ctrl+F opens it (with the selected text, if short); ⌘G / ⇧⌘G go on while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && !e.altKey && !e.shiftKey && k === 'f') {
        e.preventDefault();
        const a = document.activeElement as HTMLElement | null;
        if (a !== input.current) back.current = a;
        let sel = '';
        if (a instanceof HTMLTextAreaElement && a.selectionStart !== a.selectionEnd) sel = a.value.slice(a.selectionStart, a.selectionEnd);
        else if (!(a instanceof HTMLInputElement)) sel = String(window.getSelection() ?? '');
        if (sel && sel.length <= 200 && !sel.includes('\n')) setQ(sel);
        setOpen(true);
        requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
        return;
      }
      if (mod && !e.altKey && k === 'g' && openRef.current) { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go]);

  // A new query or case: find from the first match.
  useEffect(() => { if (open) search(q, cs, false); }, [open, q, cs, search]);

  // While open: the text and the page change (typing, a new result, another tool), the boxes
  // scroll and change size; the matches follow.
  useEffect(() => {
    if (!open) return;
    let t = 0;
    const again = () => { clearTimeout(t); t = window.setTimeout(() => search(q, cs, true), 150); };
    const root = document.querySelector('.content');
    const mo = new MutationObserver((recs) => {
      if (recs.some((r) => !(r.target as Element).closest?.('.find-mirror') && ![...r.addedNodes, ...r.removedNodes].every((n) => (n as Element).classList?.contains('find-mirror')))) again();
    });
    if (root) mo.observe(root, { childList: true, subtree: true, characterData: true });
    const onInput = (e: Event) => { if (e.target instanceof HTMLTextAreaElement) again(); };
    const onScroll = (e: Event) => {
      const m = e.target instanceof HTMLTextAreaElement ? mirrors.current.get(e.target) : undefined;
      if (m) { m.scrollTop = (e.target as HTMLTextAreaElement).scrollTop; m.scrollLeft = (e.target as HTMLTextAreaElement).scrollLeft; }
    };
    const ro = new ResizeObserver(() => { for (const [box, m] of mirrors.current) place(box, m); });
    for (const box of mirrors.current.keys()) ro.observe(box);
    const onResize = () => { for (const [box, m] of mirrors.current) place(box, m); };
    document.addEventListener('input', onInput, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      mo.disconnect();
      ro.disconnect();
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, q, cs, count, search]);

  // Another tool or the settings: find there.
  useEffect(() => { if (open) requestAnimationFrame(() => search(q, cs, false)); }, [S.tool, S.settings]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => clear, [clear]);

  if (!open) return null;
  return (
    <div className="find-bar" role="search">
      <input ref={input} className="find-q" value={q} placeholder={L.ph} aria-label={L.ph} spellCheck={false}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }} />
      <span className="find-n mono" aria-live="polite">{q ? (count ? `${cur + 1}/${count}${count >= FIND_MAX ? '+' : ''}` : L.none) : ''}</span>
      <button className={'find-btn' + (cs ? ' on' : '')} onClick={() => setCs(!cs)} title={L.case} aria-pressed={cs}>Aa</button>
      <button className="find-btn" onClick={() => go(-1)} disabled={!count} title={L.prev} aria-label={L.prev}>↑</button>
      <button className="find-btn" onClick={() => go(1)} disabled={!count} title={L.next} aria-label={L.next}>↓</button>
      <button className="find-btn" onClick={close} title={L.close} aria-label={L.close}>✕</button>
    </div>
  );
}
