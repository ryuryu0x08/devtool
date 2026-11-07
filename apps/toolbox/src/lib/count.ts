// Text statistics. "Characters" are what a reader sees (grapheme clusters: 👨‍👩‍👧 is one).

export interface Counts {
  graphemes: number; codePoints: number; utf16: number; utf8: number; lines: number; nonEmptyLines: number;
  words: number; cjk: number; latinWords: number; spaces: number; paragraphs: number;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function countText(s: string, locale = 'zh'): Counts {
  const seg = new Intl.Segmenter(locale, { granularity: 'grapheme' });
  let graphemes = 0;
  for (const _ of seg.segment(s)) graphemes++;
  let words = 0, latinWords = 0;
  for (const w of new Intl.Segmenter(locale, { granularity: 'word' }).segment(s)) {
    if (!w.isWordLike) continue;
    words++;
    if (/[A-Za-z0-9]/.test(w.segment) && !CJK.test(w.segment)) latinWords++;
  }
  const lines = s ? s.split('\n') : [];
  return {
    graphemes, codePoints: [...s].length, utf16: s.length, utf8: new TextEncoder().encode(s).length,
    lines: lines.length, nonEmptyLines: lines.filter((l) => l.trim()).length,
    words, latinWords, cjk: (s.match(new RegExp(CJK.source, 'gu')) || []).length,
    spaces: (s.match(/\s/g) || []).length,
    paragraphs: s.trim() ? s.trim().split(/\n\s*\n/).length : 0,
  };
}
