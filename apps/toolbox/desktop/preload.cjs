// What the page may ask of the desktop app: which system it runs on (the page draws the title bar
// for it), the title bar's colours when the theme changes, and the app's updates (their state; a
// check, an update, a restart; automatic or not). Nothing else crosses over.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolboxDesktop', {
  platform: process.platform,
  titleBar: (bg, fg) => ipcRenderer.send('title-bar', String(bg), String(fg)),
  update: {
    get: () => ipcRenderer.invoke('update', 'get'),
    check: () => ipcRenderer.invoke('update', 'check'),
    install: () => ipcRenderer.invoke('update', 'install'),
    restart: () => ipcRenderer.invoke('update', 'restart'),
    setAuto: (on) => ipcRenderer.invoke('update', 'auto', on === true),
    onState: (fn) => {
      const h = (_e, state) => fn(state);
      ipcRenderer.on('update-state', h);
      return () => ipcRenderer.removeListener('update-state', h);
    },
  },
});
