// 设置弹窗：此网页固定的主题、全局夜间模式、自动开启时间段。改完即写入扩展存储，页面脚本收到
// 变化后生效。
const {
  DEFAULT_MODE,
  DEFAULT_SCHEDULE,
  THEME_LABELS,
  isValidMode,
  isPageTheme,
  pageKey,
  cleanPages,
  resolvePageTheme,
} = window.__biliKitNight;

const MODE_KEY = 'mode';
const SCHEDULE_KEY = 'schedule';
const PAGES_KEY = 'pages';
const form = document.getElementById('modes');
const pageForm = document.getElementById('page-form');
const pageName = document.getElementById('page-name');
const pageUrl = document.getElementById('page-url');
const manageError = document.getElementById('manage-error');
const manage = document.getElementById('manage');
const schedEnabled = document.getElementById('sched-enabled');
const schedStart = document.getElementById('sched-start');
const schedEnd = document.getElementById('sched-end');
const status = document.getElementById('status');
let schedule = { ...DEFAULT_SCHEDULE };
let pages = {};
let tab = null;
let currentKey = null;

function currentMode() {
  return form.querySelector('input:checked')?.value || DEFAULT_MODE;
}

function markChecked(container) {
  for (const row of container.querySelectorAll('label')) {
    row.classList.toggle('on', row.querySelector('input').checked);
  }
}

function renderPage() {
  const supported = currentKey != null;
  pageForm.classList.toggle('disabled', !supported);
  for (const input of pageForm.querySelectorAll('input')) input.disabled = !supported;
  pageName.classList.toggle('notice', !supported);
  if (supported) {
    pageName.textContent = tab.title || currentKey;
    pageUrl.textContent = tab.title ? currentKey : '';
    const value = pages[currentKey]?.theme || '';
    pageForm.querySelector(`input[value="${value}"]`).checked = true;
  } else {
    pageName.textContent = '当前标签页不是知了页面，只能固定 aistudio.bilibili.co 的网页';
    pageUrl.textContent = '';
  }
  markChecked(pageForm);
  const count = Object.keys(pages).length;
  manage.textContent = count ? `管理固定主题的网页（${count} 个）` : '管理固定主题的网页（还没有）';
}

function renderStatus() {
  const now = new Date();
  const pageTheme = currentKey ? pages[currentKey]?.theme : null;
  const theme = resolvePageTheme(
    pageTheme,
    currentMode(),
    window.matchMedia('(prefers-color-scheme: dark)').matches,
    schedule,
    now.getHours() * 60 + now.getMinutes(),
  );
  const label = document.createElement('b');
  label.textContent = THEME_LABELS[theme] || theme;
  let note = '';
  if (isPageTheme(pageTheme)) note = '（此网页固定）';
  else if (schedule.enabled && schedule.start && schedule.end) note = `（${schedule.start}–${schedule.end} 自动）`;
  status.replaceChildren('现在生效：', label, note);
  markChecked(form);
}

function render() {
  renderPage();
  renderStatus();
}

function saveSchedule() {
  schedule = {
    enabled: schedEnabled.checked,
    start: schedStart.value || DEFAULT_SCHEDULE.start,
    end: schedEnd.value || DEFAULT_SCHEDULE.end,
  };
  chrome.storage.local.set({ [SCHEDULE_KEY]: schedule });
  renderStatus();
}

Promise.all([
  chrome.tabs.query({ active: true, currentWindow: true }),
  chrome.storage.local.get([MODE_KEY, SCHEDULE_KEY, PAGES_KEY]),
]).then(([[activeTab], items]) => {
  tab = activeTab || null;
  currentKey = tab?.url ? pageKey(tab.url) : null;
  const mode = isValidMode(items[MODE_KEY]) ? items[MODE_KEY] : DEFAULT_MODE;
  const input = form.querySelector(`input[value="${mode}"]`);
  if (input) input.checked = true;
  schedule = { ...DEFAULT_SCHEDULE, ...(items[SCHEDULE_KEY] || {}) };
  schedEnabled.checked = Boolean(schedule.enabled);
  schedStart.value = schedule.start;
  schedEnd.value = schedule.end;
  pages = cleanPages(items[PAGES_KEY]);
  render();
});

// 管理页里删了或改了，弹窗跟着变。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[PAGES_KEY]) return;
  pages = cleanPages(changes[PAGES_KEY].newValue);
  render();
});

pageForm.addEventListener('change', (event) => {
  if (currentKey == null) return;
  const theme = event.target.value;
  const next = { ...pages };
  if (isPageTheme(theme)) next[currentKey] = { theme, title: tab.title || '', updatedAt: Date.now() };
  else delete next[currentKey];
  pages = next;
  chrome.storage.local.set({ [PAGES_KEY]: next });
  render();
});

// 管理页已经开着就切过去，否则新开一个。不用 chrome.runtime.openOptionsPage：manifest 里的选项页要
// 插件重新加载才登记，没登记时它会失败，点了没反应。
async function openManage() {
  const url = chrome.runtime.getURL('manage.html');
  const tabs = await chrome.tabs.query({});
  const open = tabs.find((t) => t.url === url);
  if (open) {
    await chrome.tabs.update(open.id, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

manage.addEventListener('click', (event) => {
  event.preventDefault();
  manageError.hidden = true;
  openManage().catch((err) => {
    console.warn('[bili-kit] openManage failed', err);
    manageError.textContent = `打不开管理页：${err?.message || err}`;
    manageError.hidden = false;
  });
});

form.addEventListener('change', (event) => {
  const mode = event.target.value;
  if (!isValidMode(mode)) return;
  chrome.storage.local.set({ [MODE_KEY]: mode });
  renderStatus();
});

schedEnabled.addEventListener('change', saveSchedule);
schedStart.addEventListener('change', saveSchedule);
schedEnd.addEventListener('change', saveSchedule);
