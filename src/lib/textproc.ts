// Line operations, applied in this order: trim → drop blank lines → dedupe → sort → reverse.

export type SortKind = 'none' | 'asc' | 'desc' | 'natural' | 'length';
export interface ProcOpts { trim: boolean; dropBlank: boolean; dedupe: boolean; ignoreCase: boolean; sort: SortKind; reverse: boolean }
export interface ProcOut { text: string; lines: number; blank: number; dupes: number }

export function processLines(s: string, o: ProcOpts, locale = 'zh'): ProcOut {
  let lines = s.split('\n');
  if (o.trim) lines = lines.map((l) => l.trim());
  let blank = 0, dupes = 0;
  if (o.dropBlank) {
    const before = lines.length;
    lines = lines.filter((l) => l.trim() !== '');
    blank = before - lines.length;
  }
  if (o.dedupe) {
    const seen = new Set<string>();
    lines = lines.filter((l) => {
      const k = o.ignoreCase ? l.toLowerCase() : l;
      if (seen.has(k)) { dupes++; return false; }
      seen.add(k);
      return true;
    });
  }
  if (o.sort !== 'none') {
    const coll = new Intl.Collator(locale, { numeric: o.sort === 'natural', sensitivity: o.ignoreCase ? 'accent' : 'variant' });
    // A stable sort: equal lines keep their order.
    lines = lines.map((l, i) => [l, i] as const).sort((x, y) => {
      if (o.sort === 'length') return [...x[0]].length - [...y[0]].length || x[1] - y[1];
      const c = o.sort === 'desc' ? coll.compare(y[0], x[0]) : coll.compare(x[0], y[0]);
      return c || x[1] - y[1];
    }).map(([l]) => l);
  }
  if (o.reverse) lines.reverse();
  return { text: lines.join('\n'), lines: lines.length, blank, dupes };
}
