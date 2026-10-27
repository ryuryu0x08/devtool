// Line diff of two texts, with the changed characters marked inside changed lines. The work is
// bounded so two large, very different texts can't freeze the page: line alignment has a time
// budget, and characters are marked only where two lines differ by a few edits.
import { diffArrays, diffChars, type ChangeObject } from 'diff';

export interface DiffOpts { ignoreWs: boolean; ignoreCase: boolean }
export type Seg = { t: string; ch: boolean };
export interface DLine { k: 'same' | 'del' | 'add'; a?: number; b?: number; text: string; segs?: Seg[] }
export interface DiffOut {
  lines: DLine[];
  /** Line alignment ran out of time: the lines between the common start and end are shown as
   *  all removed, then all added (a correct diff, not the smallest). */
  approx: boolean;
  /** Pairs of changed lines whose characters were not compared because time ran out. */
  unmarked: number;
}

/** Time for aligning lines (the slow part when the texts are very different). */
const LINE_MS = 1500;
/** Characters are marked only when two lines differ by at most this many edits. */
const CHAR_EDITS = 64;
/** Time for marking characters in all changed lines together. */
const CHAR_MS = 1000;

const key = (l: string, o: DiffOpts) => {
  let k = o.ignoreWs ? l.replace(/\s+/g, ' ').trim() : l;
  if (o.ignoreCase) k = k.toLowerCase();
  return k;
};

/** Lines of A and B in order: unchanged, removed (from A), added (in B). A removed block followed
 *  by an added one is paired line by line and the differing characters are marked. */
export function diffText(a: string, b: string, o: DiffOpts): DiffOut {
  const la = a.split('\n'), lb = b.split('\n');
  const ka = la.map((l) => key(l, o)), kb = lb.map((l) => key(l, o));
  // Equal lines at the start and end are found directly; they stay aligned even if the middle can't be.
  let pre = 0;
  while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++;
  let suf = 0;
  while (suf < ka.length - pre && suf < kb.length - pre && ka[ka.length - 1 - suf] === kb[kb.length - 1 - suf]) suf++;
  const ma = ka.slice(pre, ka.length - suf), mb = kb.slice(pre, kb.length - suf);
  let parts: ChangeObject<string[]>[] | undefined = ma.length && mb.length ? diffArrays(ma, mb, { timeout: LINE_MS }) : [];
  const approx = !parts;
  if (!parts || (!ma.length || !mb.length)) {
    parts = [];
    if (ma.length) parts.push({ value: ma, count: ma.length, added: false, removed: true });
    if (mb.length) parts.push({ value: mb, count: mb.length, added: true, removed: false });
  }

  const out: DLine[] = [];
  let ia = 0, ib = 0;
  const same = (n: number) => { for (let k = 0; k < n; k++) out.push({ k: 'same', a: ++ia, b: ++ib, text: lb[ib - 1] }); };
  const t0 = performance.now();
  let unmarked = 0;
  const chars = (x: string, y: string) => {
    if (performance.now() - t0 > CHAR_MS) { unmarked++; return undefined; }
    // undefined when they differ by more edits than are worth marking.
    return diffChars(x, y, { ignoreCase: o.ignoreCase, maxEditLength: CHAR_EDITS });
  };

  same(pre);
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const n = part.count ?? part.value.length;
    if (!part.added && !part.removed) { same(n); continue; }
    if (part.removed && parts[p + 1]?.added) {
      const m = parts[p + 1].count ?? parts[p + 1].value.length;
      const dels: DLine[] = [], adds: DLine[] = [];
      for (let k = 0; k < Math.max(n, m); k++) {
        const x = k < n ? la[ia + k] : undefined, y = k < m ? lb[ib + k] : undefined;
        if (x !== undefined && y !== undefined) {
          const cd = chars(x, y);
          dels.push({ k: 'del', a: ia + k + 1, text: x, segs: cd?.filter((c) => !c.added).map((c) => ({ t: c.value, ch: !!c.removed })) });
          adds.push({ k: 'add', b: ib + k + 1, text: y, segs: cd?.filter((c) => !c.removed).map((c) => ({ t: c.value, ch: !!c.added })) });
        } else if (x !== undefined) dels.push({ k: 'del', a: ia + k + 1, text: x });
        else adds.push({ k: 'add', b: ib + k + 1, text: y! });
      }
      for (const l of dels) out.push(l);
      for (const l of adds) out.push(l);
      ia += n; ib += m; p++;
      continue;
    }
    for (let k = 0; k < n; k++) {
      if (part.removed) out.push({ k: 'del', a: ++ia, text: la[ia - 1] });
      else out.push({ k: 'add', b: ++ib, text: lb[ib - 1] });
    }
  }
  same(suf);
  return { lines: out, approx, unmarked };
}
