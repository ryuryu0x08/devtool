// 夜间模式的规则：模式对应哪个主题，定时开启何时生效，以及「此网页」固定的主题。不碰 DOM，
// 页面脚本、弹窗、管理页、后台和单元测试都用这一份。
//
// 时间写成 "20:00"，按当天的分钟数比较；开始晚于结束表示跨午夜（20:00–08:00）。
//
// 固定主题按网页记：键是去掉 ? 和 # 的网址（https://aistudio.bilibili.co/wiki/doc_xxx），
// 只认知了的网页。固定了的网页不管全局模式、系统深浅色和时间段，一律用固定的主题。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__biliKitNight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODES = {
    OFF: 'off',
    NIGHT: 'night',
    MIDNIGHT: 'midnight',
    SYSTEM: 'system',
  };
  const DEFAULT_MODE = MODES.SYSTEM;
  const DEFAULT_SCHEDULE = { enabled: false, start: '20:00', end: '08:00' };
  const PAGE_ORIGIN = 'https://aistudio.bilibili.co';
  // 网页能固定的主题：日间（不变暗）、夜间、深夜。
  const PAGE_THEMES = [MODES.OFF, MODES.NIGHT, MODES.MIDNIGHT];
  const THEME_LABELS = { [MODES.OFF]: '日间', [MODES.NIGHT]: '夜间', [MODES.MIDNIGHT]: '深夜' };

  function isValidMode(mode) {
    return Object.values(MODES).includes(mode);
  }

  // 用户选的模式换算成页面上生效的主题：off / night / midnight。
  function resolveTheme(mode, systemPrefersDark) {
    const picked = isValidMode(mode) ? mode : DEFAULT_MODE;
    if (picked === MODES.SYSTEM) return systemPrefersDark ? MODES.NIGHT : MODES.OFF;
    return picked;
  }

  // "20:00" -> 1200；写错了一律 null，调用方据此当作没有定时。
  function parseTime(text) {
    if (typeof text !== 'string') return null;
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text);
    if (!m) return null;
    const [hour, minute] = [Number(m[1]), Number(m[2])];
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  function isInWindow(minutes, window) {
    if (!window) return false;
    const { start, end } = window;
    if (start == null || end == null || start === end) return false;
    if (start < end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  }

  // 定时生效时，「跟随系统」按夜间算；明确选了其它模式（夜间、深夜、关闭）的以用户为准。
  function scheduledTheme(mode, systemPrefersDark, schedule, nowMinutes) {
    const window = schedule?.enabled
      ? { start: parseTime(schedule.start), end: parseTime(schedule.end) }
      : null;
    if (!isInWindow(nowMinutes, window)) return null;
    return resolveTheme(mode === MODES.SYSTEM ? MODES.NIGHT : mode, systemPrefersDark);
  }

  function resolveThemeWithSchedule(mode, systemPrefersDark, schedule, nowMinutes) {
    return scheduledTheme(mode, systemPrefersDark, schedule, nowMinutes) ?? resolveTheme(mode, systemPrefersDark);
  }

  function isPageTheme(theme) {
    return PAGE_THEMES.includes(theme);
  }

  // 网址 -> 网页的键；不是知了的网页（或网址写错）时为 null。路径末尾的 / 不算。
  function pageKey(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.origin !== PAGE_ORIGIN) return null;
    return PAGE_ORIGIN + (parsed.pathname.replace(/\/+$/, '') || '/');
  }

  // 存储里的 { 键: { theme, title, updatedAt } }，丢掉键或主题不对的条目。
  function cleanPages(raw) {
    const pages = {};
    if (!raw || typeof raw !== 'object') return pages;
    for (const [key, entry] of Object.entries(raw)) {
      if (pageKey(key) !== key || !isPageTheme(entry?.theme)) continue;
      pages[key] = {
        theme: entry.theme,
        title: typeof entry.title === 'string' ? entry.title : '',
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      };
    }
    return pages;
  }

  // 网页固定了主题就用它，否则按全局模式和时间段算。
  function resolvePageTheme(pageTheme, mode, systemPrefersDark, schedule, nowMinutes) {
    if (isPageTheme(pageTheme)) return pageTheme;
    return resolveThemeWithSchedule(mode, systemPrefersDark, schedule, nowMinutes);
  }

  // 快捷键 Alt+Shift+D：现在看到的是暗色（夜间、深夜）就切到日间，否则切到夜间。
  function toggledTheme(currentTheme) {
    return currentTheme === MODES.OFF ? MODES.NIGHT : MODES.OFF;
  }

  return {
    MODES,
    DEFAULT_MODE,
    DEFAULT_SCHEDULE,
    isValidMode,
    resolveTheme,
    parseTime,
    isInWindow,
    scheduledTheme,
    resolveThemeWithSchedule,
    PAGE_THEMES,
    THEME_LABELS,
    isPageTheme,
    pageKey,
    cleanPages,
    resolvePageTheme,
    toggledTheme,
  };
});
