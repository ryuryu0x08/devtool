// Finding text (the find bar, ⌘F / Ctrl+F): where a query occurs in a text, and in text split
// over pieces (the spans of highlighted output), mapped back to the piece and offset each match
// starts and ends in.

/** At most this many matches are found (the rest aren't counted). */
export const FIND_MAX = 10_000;

/** Where `q` occurs in `text` (start offsets, not overlapping), in order. */
export function findAll(text: string, q: string, caseSensitive = false, max = FIND_MAX): number[] {
  if (!q) return [];
  let hay = text, needle = q;
  if (!caseSensitive) {
    hay = text.toLowerCase();
    needle = q.toLowerCase();
    // A letter whose lower case is longer (İ → i̇) would shift the offsets: compare as typed then.
    if (hay.length !== text.length || needle.length !== q.length) { hay = text; needle = q; }
  }
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i !== -1 && out.length < max; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

/** A spot in text split into pieces: which piece, and the offset in it. */
export interface Spot { piece: number; offset: number }

/**
 * The matches of `q` in pieces read as one text: each match's start and end as spots. A match's
 * end is in the piece its last character is in (so that a range ending there covers it).
 */
export function findInPieces(pieces: string[], q: string, caseSensitive = false, max = FIND_MAX): { start: Spot; end: Spot }[] {
  const starts: number[] = [];
  let all = '';
  for (const p of pieces) { starts.push(all.length); all += p; }
  const at = (pos: number, isEnd: boolean): Spot => {
    // The last piece starting at or before `pos` (for an end: before it), skipping empty ones.
    let lo = 0, hi = pieces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (isEnd ? starts[mid] < pos : starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    while (lo > 0 && !pieces[lo].length) lo--;
    return { piece: lo, offset: pos - starts[lo] };
  };
  return findAll(all, q, caseSensitive, max).map((i) => ({ start: at(i, false), end: at(i + q.length, true) }));
}
