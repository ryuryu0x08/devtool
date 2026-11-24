// 快捷键：Alt+Shift+D 开关夜间：知了页面上翻转这个页面现在看到的（固定了主题的网页改它的固定主题），
// 由页面脚本按它的状态决定；别的标签页上翻转全局模式。
// Alt+Shift+M 折叠或展开鼠标所在的那张 Mermaid 图。
importScripts('src/night.js');

const { MODES, DEFAULT_MODE, pageKey } = self.__biliKitNight;
const MODE_KEY = 'mode';
const TOGGLE_ON_MODE = MODES.NIGHT;

// 页面脚本不在时（不是知了页面、插件重新加载后页面没刷新）用：不知道系统深浅色，只看全局模式。
function toggleGlobal() {
  chrome.storage.local.get(MODE_KEY, (items) => {
    const mode = items[MODE_KEY] || DEFAULT_MODE;
    const next = mode === MODES.OFF ? TOGGLE_ON_MODE : MODES.OFF;
    chrome.storage.local.set({ [MODE_KEY]: next });
  });
}

function activeTab(callback) {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([tab]) => callback(tab));
}

function onCommand(command) {
  if (command === 'toggle-dark') {
    activeTab((tab) => {
      if (tab?.id == null || !pageKey(tab.url || '')) {
        toggleGlobal();
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'bili-kit:toggle-dark' }).then(
        (res) => {
          if (!res?.ok) toggleGlobal();
        },
        () => toggleGlobal(),
      );
    });
    return;
  }
  if (command === 'fold-hovered-diagram') {
    activeTab((tab) => {
      if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'bili-kit:fold-hovered' }).catch(() => {});
    });
  }
}

chrome.commands.onCommand.addListener(onCommand);
