// Line diff of two texts, with the changed characters marked inside changed lines.
import { diffArrays, diffChars } from 'diff';

export interface DiffOpts { ignoreWs: boolean; ignoreCase: boolean }
export type Seg = { t: string; ch: boolean };
export interface DLine { k: 'same' | 'del' | 'add'; a?: number; b?: number; text: string; segs?: Seg[] }

const key = (l: string, o: DiffOpts) => {
  let k = o.ignoreWs ? l.replace(/\s+/g, ' ').trim() : l;
  if (o.ignoreCase) k = k.toLowerCase();
  return k;
};

/** Lines of A and B in order: unchanged, removed (from A), added (in B). A removed block followed
 *  by an added one is paired line by line and the differing characters are marked. */
export function diffText(a: string, b: string, o: DiffOpts): DLine[] {
  const la = a.split('\n'), lb = b.split('\n');
  const ka = la.map((l) => key(l, o)), kb = lb.map((l) => key(l, o));
  const parts = diffArrays(ka, kb);
  const out: DLine[] = [];
  let ia = 0, ib = 0;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    const n = part.count ?? part.value.length;
    if (!part.added && !part.removed) {
      for (let k = 0; k < n; k++) out.push({ k: 'same', a: ++ia, b: ++ib, text: lb[ib - 1] });
      continue;
    }
    if (part.removed && parts[p + 1]?.added) {
      const m = parts[p + 1].count ?? parts[p + 1].value.length;
      const dels: DLine[] = [], adds: DLine[] = [];
      for (let k = 0; k < Math.max(n, m); k++) {
        const x = k < n ? la[ia + k] : undefined, y = k < m ? lb[ib + k] : undefined;
        if (x !== undefined && y !== undefined) {
          const cd = diffChars(x, y, { ignoreCase: o.ignoreCase });
          dels.push({ k: 'del', a: ia + k + 1, text: x, segs: cd.filter((c) => !c.added).map((c) => ({ t: c.value, ch: !!c.removed })) });
          adds.push({ k: 'add', b: ib + k + 1, text: y, segs: cd.filter((c) => !c.removed).map((c) => ({ t: c.value, ch: !!c.added })) });
        } else if (x !== undefined) dels.push({ k: 'del', a: ia + k + 1, text: x });
        else adds.push({ k: 'add', b: ib + k + 1, text: y! });
      }
      out.push(...dels, ...adds);
      ia += n; ib += m; p++;
      continue;
    }
    for (let k = 0; k < n; k++) {
      if (part.removed) out.push({ k: 'del', a: ++ia, text: la[ia - 1] });
      else out.push({ k: 'add', b: ++ib, text: lb[ib - 1] });
    }
  }
  return out;
}
