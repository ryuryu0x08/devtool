// Tab in a text box types a tab (it doesn't move to the next control); with several lines
// selected, Tab indents each and Shift+Tab takes one level off each (a tab, or up to 2 spaces).
// Only what to put where: the page applies it as typing (so undo works).

export interface TabEdit {
  /** The part of the text replaced, and what replaces it. */
  from: number;
  to: number;
  insert: string;
  /** The selection after. */
  selStart: number;
  selEnd: number;
}

/** One level of indentation at the start of a line: its length (0: none). */
const lead = (line: string): number => (line.startsWith('\t') ? 1 : line.startsWith('  ') ? 2 : line.startsWith(' ') ? 1 : 0);

/** What Tab (or Shift+Tab) does to `value` with the selection `start`–`end`; null: nothing. */
export function tabEdit(value: string, start: number, end: number, shift: boolean): TabEdit | null {
  const multi = value.slice(start, end).includes('\n');
  if (!shift && !multi) return { from: start, to: end, insert: '\t', selStart: start + 1, selEnd: start + 1 };
  // The whole lines the selection touches (a selection ending at a line's start leaves that line out).
  const from = value.lastIndexOf('\n', start - 1) + 1;
  let to = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nl = value.indexOf('\n', to);
  to = nl === -1 ? value.length : nl;
  const lines = value.slice(from, to).split('\n');
  if (!shift) {
    const insert = lines.map((l) => '\t' + l).join('\n');
    return { from, to, insert, selStart: start + 1, selEnd: end + lines.length };
  }
  const cut = lines.map(lead);
  if (!cut.some(Boolean)) return null;
  const insert = lines.map((l, i) => l.slice(cut[i])).join('\n');
  if (!multi) {
    // One line: the caret (or selection) moves left with its text, not past the line's start.
    return { from, to, insert, selStart: Math.max(from, start - cut[0]), selEnd: Math.max(from, end - cut[0]) };
  }
  return { from, to, insert, selStart: Math.max(from, start - cut[0]), selEnd: end - cut.reduce((a, b) => a + b, 0) };
}

/** Applies Tab (or Shift+Tab) to a text box as typing would: its undo takes it back, and the page hears it changed. */
export function applyTab(box: HTMLTextAreaElement, shift: boolean): void {
  const e = tabEdit(box.value, box.selectionStart, box.selectionEnd, shift);
  if (!e) return;
  box.setSelectionRange(e.from, e.to);
  const typed = e.insert
    ? document.execCommand('insertText', false, e.insert)
    : e.from === e.to || document.execCommand('delete');
  if (!typed) {
    // No typing to borrow (an older engine): set it, and say so as typing would.
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    set.call(box, box.value.slice(0, e.from) + e.insert + box.value.slice(e.to));
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  box.setSelectionRange(e.selStart, e.selEnd);
}
