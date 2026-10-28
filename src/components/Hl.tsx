// Formatted text with syntax colours (lib/highlight). The colours are only spans around pieces of
// the text, so copying and selecting work as on plain text.
import { useMemo } from 'react';
import { highlight, type HlLang } from '../lib/highlight';
import { Vis } from './Vis';

/** Longer text is shown without colours, to stay quick. */
export const HL_MAX = 100_000;

export function Hl({ lang, text }: { lang?: HlLang; text: string }) {
  const toks = useMemo(() => (lang && text.length <= HL_MAX ? highlight(lang, text) : null), [lang, text]);
  if (!toks) return <Vis text={text} />;
  return <>{toks.map((t, i) => (t.k ? <span key={i} className={'hl-' + t.k}><Vis text={t.t} /></span> : <Vis key={i} text={t.t} />))}</>;
}
