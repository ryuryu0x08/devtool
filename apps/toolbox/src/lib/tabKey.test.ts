import { describe, expect, it } from 'vitest';
import { tabEdit, type TabEdit } from './tabKey';

/** The text after the edit, with the selection marked as [ ]. */
const run = (value: string, start: number, end: number, shift = false) => {
  const e = tabEdit(value, start, end, shift) as TabEdit | null;
  if (!e) return null;
  const v = value.slice(0, e.from) + e.insert + value.slice(e.to);
  return v.slice(0, e.selStart) + '[' + v.slice(e.selStart, e.selEnd) + ']' + v.slice(e.selEnd);
};

describe('tabEdit', () => {
  it('types a tab at the caret, or in place of a selection within a line', () => {
    expect(run('ab', 1, 1)).toBe('a\t[]b');
    expect(run('abcd', 1, 3)).toBe('a\t[]d');
    expect(run('', 0, 0)).toBe('\t[]');
  });

  it('several lines selected: Tab indents each, Shift+Tab takes one level off each', () => {
    expect(run('a\nb\nc', 0, 3)).toBe('\t[a\n\tb]\nc');
    // Ending at the start of a line leaves that line out.
    expect(run('a\nb\nc', 0, 2)).toBe('\t[a\n]b\nc');
    expect(run('\ta\n  b\n c\nd', 0, 11, true)).toBe('[a\nb\nc\nd]');
    expect(run('    a\n\t\tb', 2, 9, true)).toBe('[  a\n\tb]');
  });

  it('Shift+Tab on one line: one level off, the caret moving with its text; nothing to take off, nothing', () => {
    expect(run('x\n\tabc', 4, 4, true)).toBe('x\na[]bc');
    expect(run('  abc', 1, 1, true)).toBe('[]abc');
    expect(run('abc', 1, 1, true)).toBeNull();
  });
});
