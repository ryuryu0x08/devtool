// 夜间模式：给 <html> 设 data-bk-dark="night|midnight"，样式在 dark.css 里。
// 扩展存储要异步读，所以 document_start 先按页面缓存（知了自己的 localStorage，存着上次的设置）
// 上色，避免闪一下；读到扩展存储后以它为准并更新缓存。定时开启按当前时间判断，每分钟重新判断一次。
// 网页固定了主题（弹窗「此网页」）就用固定的；知了切换文档不刷新页面，网址一变就重新判断。
(function () {
  const { MODES, DEFAULT_MODE, DEFAULT_SCHEDULE, isValidMode, pageKey, cleanPages, resolvePageTheme, toggledTheme } =
    window.__biliKitNight;
  const ATTR = 'data-bk-dark';
  const PAGE_CACHE_KEY = 'bk-dark-settings';
  const MODE_KEY = 'mode';
  const SCHEDULE_KEY = 'schedule';
  const PAGES_KEY = 'pages';
  const TICK_MS = 60 * 1000;
  const URL_CHECK_MS = 1000;
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  let { mode, schedule, pages } = readPageCache();
  let lastUrl = location.href;

  function readPageCache() {
    const fallback = { mode: DEFAULT_MODE, schedule: DEFAULT_SCHEDULE, pages: {} };
    try {
      const cached = JSON.parse(localStorage.getItem(PAGE_CACHE_KEY) || 'null');
      if (!cached || typeof cached !== 'object') return fallback;
      return {
        mode: isValidMode(cached.mode) ? cached.mode : DEFAULT_MODE,
        schedule: { ...DEFAULT_SCHEDULE, ...(cached.schedule || {}) },
        pages: cleanPages(cached.pages),
      };
    } catch (err) {
      console.warn('[bili-kit] readPageCache: page cache unreadable', err);
      return fallback;
    }
  }

  // 缓存只留判断主题要用的：模式、时间段、各网页的主题（不存标题）。
  function writePageCache() {
    const themes = {};
    for (const [key, entry] of Object.entries(pages)) themes[key] = { theme: entry.theme };
    try {
      localStorage.setItem(PAGE_CACHE_KEY, JSON.stringify({ mode, schedule, pages: themes }));
    } catch (err) {
      console.warn('[bili-kit] writePageCache: localStorage unavailable', err);
    }
  }

  function currentTheme() {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const pageTheme = pages[pageKey(location.href)]?.theme;
    return resolvePageTheme(pageTheme, mode, systemDark.matches, schedule, minutes);
  }

  function apply() {
    const theme = currentTheme();
    if (theme === MODES.OFF) {
      root.removeAttribute(ATTR);
      return;
    }
    root.setAttribute(ATTR, theme);
  }

  function onUrlMaybeChanged() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    apply();
  }

  apply();
  setInterval(apply, TICK_MS);
  if (window.navigation) window.navigation.addEventListener('currententrychange', onUrlMaybeChanged);
  else setInterval(onUrlMaybeChanged, URL_CHECK_MS);
  window.addEventListener('popstate', onUrlMaybeChanged);

  try {
    chrome.storage.local.get([MODE_KEY, SCHEDULE_KEY, PAGES_KEY], (items) => {
      mode = isValidMode(items[MODE_KEY]) ? items[MODE_KEY] : DEFAULT_MODE;
      schedule = { ...DEFAULT_SCHEDULE, ...(items[SCHEDULE_KEY] || {}) };
      pages = cleanPages(items[PAGES_KEY]);
      writePageCache();
      apply();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[MODE_KEY]) {
        const next = changes[MODE_KEY].newValue;
        mode = isValidMode(next) ? next : DEFAULT_MODE;
      }
      if (changes[SCHEDULE_KEY]) schedule = { ...DEFAULT_SCHEDULE, ...(changes[SCHEDULE_KEY].newValue || {}) };
      if (changes[PAGES_KEY]) pages = cleanPages(changes[PAGES_KEY].newValue);
      writePageCache();
      apply();
    });
  } catch (err) {
    console.warn('[bili-kit] storage unavailable, using the page cache', err);
  }

  // 快捷键 Alt+Shift+D：翻转这个页面现在看到的。网页固定了主题就改它的固定主题，否则改全局模式。
  // 存储里的网页带标题，页面缓存里的没有，所以先读存储再写，免得把标题写丢。
  async function toggleDark() {
    const next = toggledTheme(currentTheme());
    const key = pageKey(location.href);
    const items = await chrome.storage.local.get(PAGES_KEY);
    const stored = cleanPages(items[PAGES_KEY]);
    if (key && stored[key]) {
      stored[key] = { ...stored[key], theme: next, updatedAt: Date.now() };
      await chrome.storage.local.set({ [PAGES_KEY]: stored });
      return;
    }
    await chrome.storage.local.set({ [MODE_KEY]: next });
  }

  // 快捷键由后台转来。Alt+Shift+M：本脚本在隔离世界，把它转成页面事件给折叠脚本（MAIN 世界）。
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'bili-kit:fold-hovered') {
        window.dispatchEvent(new CustomEvent('bili-kit:fold-hovered'));
        return false;
      }
      if (msg && msg.type === 'bili-kit:toggle-dark') {
        toggleDark().then(
          () => sendResponse({ ok: true }),
          (err) => {
            console.warn('[bili-kit] toggleDark failed', err);
            sendResponse({ ok: false });
          },
        );
        return true;
      }
      return false;
    });
  } catch (err) {
    console.warn('[bili-kit] runtime messages unavailable', err);
  }

  systemDark.addEventListener('change', apply);
})();
