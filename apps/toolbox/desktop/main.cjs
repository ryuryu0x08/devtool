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
//
// macOS: closing the window (its button, ⌘W) only hides it, as Mac apps do: the Dock icon shows it
// again as it was, without loading the page anew. Quitting (⌘Q, the Dock's Quit) quits.
//
// Updates (macOS, an app built by build.sh from a git clone): see update.cjs. The page's settings
// show the state and ask for a check, an update, a restart; with automatic updates on, a newer
// version is built in the background and put in place when the app quits.

const { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const updater = require('./update.cjs');

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
/** Quitting (⌘Q, the Dock's Quit, an update's restart): the window closes for real. */
let quitting = false;

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
  win.on('close', (e) => {
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()));
    } catch {
      /* not kept this time */
    }
    if (!isMac || quitting) return;
    // Hidden, not closed: the page stays as it is for the Dock icon to show again.
    e.preventDefault();
    if (win.isFullScreen()) {
      win.once('leave-full-screen', () => win.hide());
      win.setFullScreen(false);
    } else win.hide();
  });
  win.on('closed', () => (win = null));
  win.loadURL(ORIGIN + '/');
}

// ---- Updates ----

const info = updater.readInfo(__dirname);
const bundle = isMac ? updater.bundleOf(process.execPath) : null;
/** Why this app can't update itself; null: it can. */
const unsupported = !isMac ? 'platform' : !info || !bundle || !fs.existsSync(path.join(info.sourceDir, '.git')) ? 'not-built-here' : null;
const updateFile = () => path.join(app.getPath('userData'), 'update.json');
function savedAuto() {
  try {
    return JSON.parse(fs.readFileSync(updateFile(), 'utf8')).auto === true;
  } catch {
    return false;
  }
}

/**
 * What the page shows. state: unsupported | idle | checking | none (up to date) | available |
 * building | ready (built: put in place on quit or restart) | failed.
 */
let update = {
  state: unsupported ? 'unsupported' : 'idle',
  reason: unsupported,
  commit: info?.commit ?? null,
  built: info?.built ?? null,
  sourceDir: info?.sourceDir ?? null,
  auto: false,
  count: 0,
  subject: null,
  error: null,
  checked: null,
};
/** The Toolbox.app built by an update, to put in place. */
let fresh = null;
let swapped = false;

function setUpdate(change) {
  update = { ...update, ...change };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update-state', update);
}

async function check() {
  if (unsupported || ['checking', 'building', 'ready'].includes(update.state)) return update;
  setUpdate({ state: 'checking', error: null });
  try {
    const { count, subject } = await updater.newer(info.sourceDir, info.commit);
    setUpdate({ state: count ? 'available' : 'none', count, subject, checked: Date.now() });
    if (count && update.auto) install();
  } catch (e) {
    setUpdate({ state: 'failed', error: e.message, checked: Date.now() });
  }
  return update;
}

async function install() {
  if (update.state !== 'available') return update;
  setUpdate({ state: 'building', error: null });
  try {
    await updater.fastForward(info.sourceDir);
    fresh = await updater.build(info.sourceDir, path.join(app.getPath('userData'), 'update-build.log'));
    setUpdate({ state: 'ready' });
  } catch (e) {
    setUpdate({ state: 'failed', error: e.message });
  }
  return update;
}

function swap(reopen) {
  if (swapped || !fresh || !bundle) return;
  swapped = true;
  updater.swapAfterQuit(process.pid, bundle, fresh, reopen);
}

/** The page's asks; only from the toolbox's own page. */
function onUpdate(e, action, arg) {
  if (!e.senderFrame?.url.startsWith(ORIGIN + '/')) return null;
  switch (action) {
    case 'get':
      return update;
    case 'check':
      return check();
    case 'install':
      return install();
    case 'restart':
      if (update.state !== 'ready') return update;
      swap(true);
      app.quit();
      return update;
    case 'auto':
      try {
        fs.writeFileSync(updateFile(), JSON.stringify({ auto: arg === true }));
      } catch {
        /* not kept this time */
      }
      setUpdate({ auto: arg === true });
      if (update.auto && update.state === 'available') install();
      return update;
    default:
      return null;
  }
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

  ipcMain.handle('update', onUpdate);

  // Quitting: the window closes for real, and a built update takes the old app's place.
  app.on('before-quit', () => {
    quitting = true;
    if (update.state === 'ready') swap(false);
  });

  app.whenReady().then(() => {
    protocol.handle('app', serve);
    const s = session.defaultSession;
    s.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED.has(permission)));
    s.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));
    open();
    // macOS: the Dock icon clicked (the window hidden, or none).
    app.on('activate', show);
    if (!unsupported) {
      update.auto = savedAuto();
      setTimeout(check, 30_000);
      setInterval(check, 6 * 3600_000);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
