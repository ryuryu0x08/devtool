// 管理页：列出固定了主题的网页，最近设置的在前；可改主题、删除。改完写回扩展存储，打开着的
// 知了页面和弹窗收到变化后立刻跟着变。
const { PAGE_THEMES, THEME_LABELS, cleanPages } = window.__biliKitNight;

const PAGES_KEY = 'pages';
const bar = document.getElementById('bar');
const count = document.getElementById('count');
const clearAll = document.getElementById('clear-all');
const table = document.getElementById('table');
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
let pages = {};

function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cell(className, ...children) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.append(...children);
  return td;
}

function save(next) {
  pages = next;
  chrome.storage.local.set({ [PAGES_KEY]: next });
  render();
}

function row(key, entry) {
  const link = document.createElement('a');
  link.href = key;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = entry.title || key;
  const urlLine = document.createElement('div');
  urlLine.className = 'url';
  urlLine.textContent = entry.title ? key : '';

  const select = document.createElement('select');
  select.setAttribute('aria-label', '主题');
  for (const theme of PAGE_THEMES) select.add(new Option(THEME_LABELS[theme], theme, false, theme === entry.theme));
  select.addEventListener('change', () => {
    save({ ...pages, [key]: { ...entry, theme: select.value, updatedAt: Date.now() } });
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger';
  remove.textContent = '删除';
  remove.addEventListener('click', () => {
    const next = { ...pages };
    delete next[key];
    save(next);
  });

  const tr = document.createElement('tr');
  tr.append(
    cell('page', link, urlLine),
    cell('', select),
    cell('time', formatTime(entry.updatedAt)),
    cell('ops', remove),
  );
  return tr;
}

function render() {
  const entries = Object.entries(pages).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const has = entries.length > 0;
  bar.hidden = !has;
  table.hidden = !has;
  empty.hidden = has;
  count.textContent = `共 ${entries.length} 个`;
  rows.replaceChildren(...entries.map(([key, entry]) => row(key, entry)));
}

clearAll.addEventListener('click', () => {
  const n = Object.keys(pages).length;
  if (!confirm(`删除全部 ${n} 个固定主题的网页？它们会回到跟随全局。`)) return;
  save({});
});

chrome.storage.local.get(PAGES_KEY, (items) => {
  pages = cleanPages(items[PAGES_KEY]);
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[PAGES_KEY]) return;
  pages = cleanPages(changes[PAGES_KEY].newValue);
  render();
});
