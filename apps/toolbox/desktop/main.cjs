// 工具箱 as a desktop app: the toolbox's build (./web, made by `npm run web`) in a window of its
// own Chromium, so it behaves as it does in the browser the toolbox is tested in.
//
// The page is served from app://toolbox/ rather than file://: a real origin, so its storage stays
// put between launches, its module workers load, and its absolute paths (/favicon.svg) resolve.
// The page gets no Node: it runs sandboxed, as a web page does (preload.cjs passes it the system's
// name and takes the title bar's colours, nothing more). Links to other sites open in the system
// browser; the window itself never leaves the toolbox.
//
// No system title bar: the page draws its own strip at the top (html.desktop in its styles), in the
// theme's colours. macOS keeps its window buttons at the top left; Windows and Linux theirs at the
// top right, coloured as the page says.

const { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ORIGIN = 'app://toolbox';
const WEB = path.join(__dirname, 'web');

// --user-data-dir=<dir>: storage elsewhere (the tests give each launch its own). It also decides
// which running copy a second launch hands over to, so it is set before that check.
const dataDir = app.commandLine.getSwitchValue('user-data-dir');
if (dataDir) app.setPath('userData', path.resolve(dataDir));

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

/** A file of the build for an app://toolbox/ request; outside the build or missing: 404. */
async function serve(req) {
  const missing = () => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  const url = new URL(req.url);
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return missing();
  }
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(WEB, '.' + rel);
  if (url.host !== 'toolbox' || !file.startsWith(WEB + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    return missing();
  }
  return net.fetch(pathToFileURL(file).toString());
}

/** Permissions the toolbox uses (copying, pasting); everything else is refused. */
const ALLOWED = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);

const isWeb = (u) => /^(https?|mailto):/i.test(u);

/** The window's size and place, kept between launches. */
const boundsFile = () => path.join(app.getPath('userData'), 'window.json');
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if ([b.width, b.height].every((n) => Number.isInteger(n) && n >= 400)) return b;
  } catch {
    /* none yet, or unreadable: the default size */
  }
  return { width: 1280, height: 860 };
}

let win = null;

/** Height of the title bar strip the page draws (its styles use the same: --titlebar). */
const BAR = 36;
const isMac = process.platform === 'darwin';
const hex = (c) => /^#[0-9a-f]{6}$/i.test(c);

function open() {
  const b = savedBounds();
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    ...b,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: '工具箱',
    backgroundColor: dark ? '#121211' : '#f6f6f4',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: (BAR - 14) / 2 } }
      : { titleBarOverlay: { color: dark ? '#121211' : '#f6f6f4', symbolColor: dark ? '#ededeb' : '#1b1b1d', height: BAR } }),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()));
    } catch {
      /* not kept this time */
    }
  });
  win.on('closed', () => (win = null));
  win.loadURL(ORIGIN + '/');
}

function show() {
  if (!win) return open();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// One copy: opening it again shows the running one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', show);

  // Every page and frame: other sites go to the system browser, nothing else is navigated to.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isWeb(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      if (url.startsWith(ORIGIN + '/')) return;
      e.preventDefault();
      if (isWeb(url)) shell.openExternal(url);
    });
  });

  // The page's theme changed: the title bar's buttons (Windows, Linux) and the window behind the
  // page take its colours. Only from the toolbox's own page, only plain colours.
  ipcMain.on('title-bar', (e, bg, fg) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || !e.senderFrame?.url.startsWith(ORIGIN + '/') || !hex(bg) || !hex(fg)) return;
    w.setBackgroundColor(bg);
    if (!isMac) w.setTitleBarOverlay({ color: bg, symbolColor: fg, height: BAR });
    w.titleBarColors = { bg, fg }; // what was last applied (the tests read it)
  });

  app.whenReady().then(() => {
    protocol.handle('app', serve);
    const s = session.defaultSession;
    s.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED.has(permission)));
    s.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));
    open();
    // macOS: the Dock icon clicked with no window open.
    app.on('activate', show);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
