// What the page may ask of the desktop app: which system it runs on (the page draws the title bar
// for it), the title bar's colours when the theme changes, the app's updates (their state; a
// check, an update, a restart; automatic or not), and Proxy & Capture's backend (check an entry,
// start, find, stop; its changes as they happen). Nothing else crosses over.
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
  capture: {
    backends: () => ipcRenderer.invoke('capture', 'backends'),
    get: () => ipcRenderer.invoke('capture', 'get'),
    defaultEntry: (backend) => ipcRenderer.invoke('capture', 'default-entry', String(backend)),
    inspect: (backend, entry) => ipcRenderer.invoke('capture', 'inspect', String(backend), String(entry)),
    fix: (backend, entry) => ipcRenderer.invoke('capture', 'fix', String(backend), String(entry)),
    find: (backend, entry) => ipcRenderer.invoke('capture', 'find', String(backend), String(entry)),
    start: (backend, entry) => ipcRenderer.invoke('capture', 'start', String(backend), String(entry)),
    stop: () => ipcRenderer.invoke('capture', 'stop'),
    checkProxy: () => ipcRenderer.invoke('capture', 'check-proxy'),
    onEvent: (fn) => {
      const h = (_e, event) => fn(event);
      ipcRenderer.on('capture-event', h);
      return () => ipcRenderer.removeListener('capture-event', h);
    },
  },
});
