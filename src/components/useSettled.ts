import { useEffect, useState } from 'react';

/** Inputs larger than this are processed once typing pauses instead of on every keystroke. */
export const BIG_INPUT = 40_000;

/**
 * The value to process: `v` itself when small, otherwise the last value that stayed
 * unchanged for `ms`. `pending` is true while the shown result is for older input.
 */
export function useSettled(v: string): [string, boolean] {
  const ms = v.length > 1_000_000 ? 500 : 250;
  const [settled, setSettled] = useState(v);
  useEffect(() => {
    if (v.length < BIG_INPUT) { setSettled(v); return; }
    const t = setTimeout(() => setSettled(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  const cur = v.length < BIG_INPUT ? v : settled;
  return [cur, cur !== v];
}
