// Tab in a text box types a tab and stays there; with lines selected it indents them (Shift+Tab
// outdents); undo takes it back; Esc then Tab moves on to the next control.
import { expect, open, test } from './helpers';

test('Tab types a tab in a text box; lines selected: indent and outdent; undo; Esc then Tab moves on', async ({ page }) => {
  await open(page, 'JSON 去转义');
  const box = page.locator('textarea.area').first();
  await box.fill('ab');
  await box.evaluate((b: HTMLTextAreaElement) => b.setSelectionRange(1, 1));
  await box.press('Tab');
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('a\tb');
  expect(await box.evaluate((b: HTMLTextAreaElement) => b.selectionStart)).toBe(2);
  // Undo takes the tab back (it was typed, not set).
  await box.press('ControlOrMeta+z');
  await expect(box).toHaveValue('ab');
  // Several lines: each indented, then outdented.
  await box.fill('{\n"a": 1,\n"b": 2\n}');
  await box.evaluate((b: HTMLTextAreaElement) => b.setSelectionRange(2, 15));
  await box.press('Tab');
  await expect(box).toHaveValue('{\n\t"a": 1,\n\t"b": 2\n}');
  await box.press('Shift+Tab');
  await expect(box).toHaveValue('{\n"a": 1,\n"b": 2\n}');
  // The page heard it: the result follows the text.
  await box.fill('{\\"a\\":1}');
  await box.press('End');
  await box.press('Tab');
  await expect(box).toHaveValue('{\\"a\\":1}\t');
  await expect(page.locator('.out-card .pane-scroll')).toContainText('"a": 1');
  // Esc, then Tab: the next control, the text as it was.
  await box.press('Escape');
  await box.press('Tab');
  await expect(box).not.toBeFocused();
  await expect(box).toHaveValue('{\\"a\\":1}\t');
});
