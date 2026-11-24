// The night mode's rules: which theme a mode means, and when the night schedule turns it on.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MODES,
  DEFAULT_MODE,
  isValidMode,
  resolveTheme,
  parseTime,
  isInWindow,
  scheduledTheme,
  resolveThemeWithSchedule,
  isPageTheme,
  pageKey,
  cleanPages,
  resolvePageTheme,
  toggledTheme,
} = require('../src/night.js');

test('跟着系统：系统深色才用夜间', () => {
  assert.equal(resolveTheme(MODES.SYSTEM, true), MODES.NIGHT);
  assert.equal(resolveTheme(MODES.SYSTEM, false), MODES.OFF);
});

test('固定模式不受系统影响', () => {
  assert.equal(resolveTheme(MODES.NIGHT, false), MODES.NIGHT);
  assert.equal(resolveTheme(MODES.MIDNIGHT, false), MODES.MIDNIGHT);
  assert.equal(resolveTheme(MODES.OFF, true), MODES.OFF);
});

test('未知模式当作默认', () => {
  assert.equal(isValidMode('purple'), false);
  assert.equal(isValidMode(undefined), false);
  assert.equal(resolveTheme('purple', true), resolveTheme(DEFAULT_MODE, true));
});

test('时间写成 20:00 / 8:00 / 08:00', () => {
  assert.equal(parseTime('20:00'), 20 * 60);
  assert.equal(parseTime('08:00'), 8 * 60);
  assert.equal(parseTime(' 0:05 '), 5);
  assert.equal(parseTime('24:00'), null);
  assert.equal(parseTime('23:60'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime(undefined), null);
});

test('跨午夜的时间段：20:00–08:00', () => {
  const w = { start: parseTime('20:00'), end: parseTime('08:00') };
  assert.equal(isInWindow(21 * 60, w), true);
  assert.equal(isInWindow(0, w), true);
  assert.equal(isInWindow(7 * 60 + 59, w), true);
  assert.equal(isInWindow(8 * 60, w), false);
  assert.equal(isInWindow(12 * 60, w), false);
  assert.equal(isInWindow(19 * 60 + 59, w), false);
  assert.equal(isInWindow(20 * 60, w), true);
});

test('同一天内的时间段：09:00–12:00', () => {
  const w = { start: parseTime('09:00'), end: parseTime('12:00') };
  assert.equal(isInWindow(9 * 60, w), true);
  assert.equal(isInWindow(11 * 60 + 59, w), true);
  assert.equal(isInWindow(12 * 60, w), false);
  assert.equal(isInWindow(8 * 60 + 59, w), false);
});

test('起止相同或无效时不做定时', () => {
  assert.equal(isInWindow(600, { start: 600, end: 600 }), false);
  assert.equal(isInWindow(600, { start: null, end: 480 }), false);
  assert.equal(isInWindow(600, null), false);
});

test('定时开启时，手动的「跟随系统」按夜间算，明确选的模式优先', () => {
  const now = 22 * 60;
  const schedule = { enabled: true, start: '20:00', end: '08:00' };
  assert.equal(scheduledTheme(MODES.SYSTEM, false, schedule, now), MODES.NIGHT);
  assert.equal(scheduledTheme(MODES.NIGHT, false, schedule, now), MODES.NIGHT);
  assert.equal(scheduledTheme(MODES.MIDNIGHT, false, schedule, now), MODES.MIDNIGHT);
  assert.equal(scheduledTheme(MODES.OFF, false, schedule, now), MODES.OFF);
  // 时间段外不给结论，交给「跟随系统」原本的规则。
  assert.equal(scheduledTheme(MODES.SYSTEM, true, schedule, 12 * 60), null);
  assert.equal(resolveThemeWithSchedule(MODES.SYSTEM, true, schedule, 12 * 60), MODES.NIGHT);
  assert.equal(resolveThemeWithSchedule(MODES.SYSTEM, false, schedule, 12 * 60), MODES.OFF);
});

test('自动开启关掉时不看时间段', () => {
  const schedule = { enabled: false, start: '20:00', end: '08:00' };
  assert.equal(scheduledTheme(MODES.SYSTEM, false, schedule, 22 * 60), null);
  assert.equal(resolveThemeWithSchedule(MODES.SYSTEM, false, schedule, 22 * 60), MODES.OFF);
  assert.equal(resolveThemeWithSchedule(MODES.NIGHT, false, schedule, 22 * 60), MODES.NIGHT);
});

test('网页的键：知了网址去掉 ? 和 #、末尾的 /', () => {
  const doc = 'https://aistudio.bilibili.co/wiki/doc_ImYWTKX5barqBv1VyLbP';
  assert.equal(pageKey(doc), doc);
  assert.equal(pageKey(`${doc}?from=search#h-背景`), doc);
  assert.equal(pageKey(`${doc}/`), doc);
  assert.equal(pageKey('https://AISTUDIO.bilibili.co/wiki/doc_ImYWTKX5barqBv1VyLbP'), doc);
  assert.equal(pageKey('https://aistudio.bilibili.co'), 'https://aistudio.bilibili.co/');
  assert.equal(pageKey('https://aistudio.bilibili.co/wiki/doc_a'), 'https://aistudio.bilibili.co/wiki/doc_a');
});

test('不是知了的网页没有键', () => {
  assert.equal(pageKey('http://aistudio.bilibili.co/wiki/doc_a'), null);
  assert.equal(pageKey('https://aistudio.bilibili.co.evil.com/wiki/doc_a'), null);
  assert.equal(pageKey('https://www.bilibili.com/'), null);
  assert.equal(pageKey('chrome://extensions/'), null);
  assert.equal(pageKey('javascript:alert(1)'), null);
  assert.equal(pageKey('not a url'), null);
  assert.equal(pageKey(undefined), null);
});

test('网页能固定日间、夜间、深夜，不能固定「跟随系统」', () => {
  assert.equal(isPageTheme(MODES.OFF), true);
  assert.equal(isPageTheme(MODES.NIGHT), true);
  assert.equal(isPageTheme(MODES.MIDNIGHT), true);
  assert.equal(isPageTheme(MODES.SYSTEM), false);
  assert.equal(isPageTheme(''), false);
  assert.equal(isPageTheme(undefined), false);
});

test('存储里坏掉的条目丢掉', () => {
  const ok = 'https://aistudio.bilibili.co/wiki/doc_a';
  const pages = cleanPages({
    [ok]: { theme: 'off', title: '文档 A', updatedAt: 5 },
    'https://aistudio.bilibili.co/wiki/doc_b?x=1': { theme: 'night' },
    'javascript:alert(1)': { theme: 'night' },
    'https://aistudio.bilibili.co/wiki/doc_c': { theme: 'purple' },
    'https://aistudio.bilibili.co/wiki/doc_d': null,
    'https://aistudio.bilibili.co/wiki/doc_e': { theme: 'midnight', title: 3, updatedAt: 'x' },
  });
  assert.deepEqual(pages, {
    [ok]: { theme: 'off', title: '文档 A', updatedAt: 5 },
    'https://aistudio.bilibili.co/wiki/doc_e': { theme: 'midnight', title: '', updatedAt: 0 },
  });
  assert.deepEqual(cleanPages(undefined), {});
  assert.deepEqual(cleanPages('x'), {});
  assert.deepEqual(cleanPages(['a']), {});
});

test('固定的主题压过全局模式、系统和时间段', () => {
  const schedule = { enabled: true, start: '20:00', end: '08:00' };
  const night = 22 * 60;
  assert.equal(resolvePageTheme(MODES.OFF, MODES.NIGHT, true, schedule, night), MODES.OFF);
  assert.equal(resolvePageTheme(MODES.OFF, MODES.SYSTEM, true, schedule, night), MODES.OFF);
  assert.equal(resolvePageTheme(MODES.NIGHT, MODES.OFF, false, schedule, 12 * 60), MODES.NIGHT);
  assert.equal(resolvePageTheme(MODES.MIDNIGHT, MODES.NIGHT, false, null, 0), MODES.MIDNIGHT);
  // 没固定（或固定的值不对）就按全局规则。
  assert.equal(resolvePageTheme(undefined, MODES.SYSTEM, false, schedule, night), MODES.NIGHT);
  assert.equal(resolvePageTheme(MODES.SYSTEM, MODES.SYSTEM, false, schedule, 12 * 60), MODES.OFF);
});

test('快捷键翻转看到的：暗色切日间，日间切夜间', () => {
  assert.equal(toggledTheme(MODES.OFF), MODES.NIGHT);
  assert.equal(toggledTheme(MODES.NIGHT), MODES.OFF);
  assert.equal(toggledTheme(MODES.MIDNIGHT), MODES.OFF);
  // 默认「跟随系统」、系统浅色：看到的是日间，按一下就该变夜间（以前要按两下）。
  const seen = resolveThemeWithSchedule(MODES.SYSTEM, false, { enabled: false }, 12 * 60);
  assert.equal(toggledTheme(seen), MODES.NIGHT);
});
