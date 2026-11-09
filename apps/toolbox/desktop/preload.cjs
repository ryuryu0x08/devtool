// What the page may ask of the desktop app: which system it runs on (the page draws the title bar
// for it), and the title bar's colours when the theme changes. Nothing else crosses over.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolboxDesktop', {
  platform: process.platform,
  titleBar: (bg, fg) => ipcRenderer.send('title-bar', String(bg), String(fg)),
});
