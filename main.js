const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog } = require('electron');
const path = require('path');
const { loadConfig, saveConfig } = require('./src/config');
const actions = require('./src/actions');
const google = require('./src/google');
const shortcuts = require('./src/shortcuts');
const { startAlerts } = require('./src/alerts');
const { startEdgeWatcher } = require('./src/edge');
const { startMediaWatcher } = require('./src/media');

const SIZE = {
  collapsed: { width: 210, height: 36 },
  expanded: { width: 940, height: 580 },
};
const COLLAPSE_DELAY_MS = 200; // cursor must stay outside this long before closing
const ANIMATION_MS = 180; // must match the CSS transition in renderer/styles.css
const HOVER_POLL_MS = 40;
const REVEAL_DELAY_MS = 40; // lets the renderer start the grow animation before showing
const REVEAL_ZONE_WIDTH = 280; // DIP, centered on the notch, where pushing up reveals it
const PUSH_GAP_MS = 350; // a pause longer than this restarts the push count

let win = null;
let config = null;

// collapsed | expanded | collapsing
let notchState = 'collapsed';
let pinned = false;
// When the notch opens without the cursor on it (hotkey), wait for the cursor to enter
// once before auto-collapsing; otherwise it would close right away.
let armed = true;
let outsideSince = null;
let collapseTimer = null;
let revealTimer = null;

/*
 * "Hidden" = invisible and click-through, but never win.hide()/show():
 * those trigger Windows' own window animation (a slide/fade from below).
 */
let concealed = false;

function conceal() {
  win.setIgnoreMouseEvents(true);
  win.setOpacity(0);
  concealed = true;
}

function reveal() {
  win.setOpacity(1);
  win.setIgnoreMouseEvents(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  concealed = false;
}

// Outside the desktop the notch stays hidden until the user pushes the
// mouse up against the top edge, over the notch position.
let onDesktop = true;
// A fullscreen app (game, video) is in focus: never show the notch.
let fullscreen = false;
let pushTotal = 0;
let lastPushAt = 0;
let stopEdgeWatcher = null;

let alerts = null;
let alertTimer = null;
const BLINK_MS = { reminder: 1400, start: 400 }; // must match the CSS animations
const ALERT_LIMITS = { reminderBlinks: [1, 10], startSeconds: [1, 60], startLeadMinutes: [0, 60] };

/** Blink the notch; when hidden, show the pill just for the blink. Never over fullscreen. */
function flashAlert(kind) {
  const { reminderEnabled, startEnabled, reminderBlinks, startSeconds } = config.alerts;
  if (fullscreen || !(kind === 'reminder' ? reminderEnabled : startEnabled)) return;
  const durationMs = kind === 'reminder' ? reminderBlinks * BLINK_MS.reminder : startSeconds * 1000;
  clearTimeout(alertTimer);
  if (concealed && notchState === 'collapsed') reveal();
  send('notch:alert', kind, Math.round(durationMs / BLINK_MS[kind]));
  alertTimer = setTimeout(() => {
    alertTimer = null;
    applyVisibility();
  }, durationMs);
}

/** Stop a running blink (the user came to the notch, so it did its job). */
function cancelAlert() {
  if (!alertTimer) return;
  clearTimeout(alertTimer);
  alertTimer = null;
  send('notch:alert', null);
}

let mediaWatcher = null;
let mediaSessions = [];

const send = (channel, ...args) => win?.webContents.send(channel, ...args);

function boundsFor(kind) {
  const { width, height } = SIZE[kind];
  const { x, y, width: displayWidth } = screen.getPrimaryDisplay().bounds;
  return { x: Math.round(x + (displayWidth - width) / 2), y, width, height };
}

/** `force`: open even over a fullscreen app (only the hotkey does this). */
function expand({ focus = false, arm = true, force = false } = {}) {
  if (fullscreen && !force) return;
  cancelAlert();
  clearTimeout(collapseTimer);
  const wasHidden = concealed;
  if (notchState !== 'expanded') {
    win.setBounds(boundsFor('expanded'));
    notchState = 'expanded';
    send('notch:state', 'expanded');
    alerts?.refresh(); // pick up events just created in Google
  }
  armed = arm;
  outsideSince = null;
  if (!wasHidden) {
    if (focus) win.focus();
    return;
  }
  // Show only once the panel has started growing, so the pill never flashes.
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    if (notchState !== 'expanded' || (fullscreen && !force)) return;
    reveal();
    if (focus) win.focus();
  }, REVEAL_DELAY_MS);
}

function collapse() {
  if (notchState !== 'expanded') return;
  // Outside the desktop the pill is never shown: fade the panel out instead.
  const willHide = fullscreen || (!onDesktop && config.hideOutsideDesktop);
  notchState = 'collapsing';
  send('notch:state', willHide ? 'hidden' : 'collapsed');
  // Drop keyboard focus so typing does not go into the hidden panel.
  if (win.isFocused()) win.blur();
  // Let the CSS animation finish before shrinking the real window.
  collapseTimer = setTimeout(() => {
    if (notchState !== 'collapsing') return;
    if (willHide) conceal();
    win.setBounds(boundsFor('collapsed'));
    notchState = 'collapsed';
    if (willHide) send('notch:state', 'collapsed');
    applyVisibility();
  }, ANIMATION_MS);
}

/** Collapsed pill is visible only on the desktop; outside it the window hides. */
function applyVisibility() {
  if (!win) return;
  if (fullscreen) {
    // Close instantly, no animation.
    clearTimeout(collapseTimer);
    if (notchState !== 'collapsed') {
      win.setBounds(boundsFor('collapsed'));
      notchState = 'collapsed';
      send('notch:state', 'collapsed');
    }
    conceal();
    return;
  }
  if (onDesktop || !config.hideOutsideDesktop) {
    if (concealed) reveal();
  } else if (notchState === 'collapsed' && !concealed && !alertTimer) {
    conceal();
  }
}

function cursorInRevealZone() {
  const p = screen.getCursorScreenPoint();
  const { x, y, width } = screen.getPrimaryDisplay().bounds;
  return p.y <= y && Math.abs(p.x - (x + width / 2)) <= REVEAL_ZONE_WIDTH / 2;
}

/**
 * Raw upward movement while the cursor is stuck on a top edge. Counts only
 * mostly-vertical motion, so sliding along the edge (e.g. to browser tabs)
 * does not open the notch.
 */
function handlePush(dy, dx) {
  if (!concealed || !cursorInRevealZone()) {
    pushTotal = 0;
    return;
  }
  const now = Date.now();
  if (now - lastPushAt > PUSH_GAP_MS) pushTotal = 0;
  lastPushAt = now;
  if (dy < dx) return;
  pushTotal += dy;
  if (pushTotal >= config.revealPush) {
    pushTotal = 0;
    expand();
  }
}

function startEdge() {
  stopEdgeWatcher = startEdgeWatcher({
    onPush: handlePush,
    onForeground: (kind) => {
      onDesktop = kind === 'desktop';
      fullscreen = kind === 'fullscreen';
      applyVisibility();
    },
    onExit: (err) => {
      // Without the helper there is no way to reveal the notch: keep it visible.
      console.error(`[edge] ${err.message}`);
      stopEdgeWatcher = null;
      onDesktop = true;
      fullscreen = false;
      applyVisibility();
    },
  });
}

function cursorInsideWindow() {
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

/**
 * Auto-collapse rule: close when the cursor has been outside for a moment,
 * even if the panel has focus. Only the pin keeps it open.
 */
function watchHover() {
  setInterval(() => {
    if (!win || notchState !== 'expanded' || pinned) return;
    if (cursorInsideWindow()) {
      armed = true;
      outsideSince = null;
      return;
    }
    if (!armed) return;
    outsideSince ??= Date.now();
    if (Date.now() - outsideSince >= COLLAPSE_DELAY_MS) collapse();
  }, HOVER_POLL_MS);
}

function createWindow() {
  win = new BrowserWindow({
    ...boundsFor('collapsed'),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.showInactive();
    if (process.argv.includes('--open')) expand({ arm: false });
  });

  win.on('blur', () => {
    if (notchState === 'expanded' && !pinned && !cursorInsideWindow()) collapse();
  });

  // Keep the notch centered when monitors or resolution change.
  const recenter = () => win.setBounds(boundsFor(notchState === 'expanded' ? 'expanded' : 'collapsed'));
  screen.on('display-metrics-changed', recenter);
  screen.on('display-added', recenter);
  screen.on('display-removed', recenter);
}

function registerIpc() {
  ipcMain.on('notch:hover', () => expand());
  ipcMain.on('notch:collapse', () => collapse());
  ipcMain.handle('notch:pin', (_e, value) => (pinned = Boolean(value)));
  ipcMain.on('app:quit', () => app.quit());

  ipcMain.handle('config:get', () => ({
    assistantName: config.assistantName,
    userName: config.userName,
    hotkey: config.hotkey,
    accentColor: config.accentColor,
    alerts: config.alerts,
    // Real OS state, so the toggle is right even if changed elsewhere.
    startWithWindows: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
  }));

  ipcMain.handle('settings:set', (_e, patch) => {
    const clean = {};
    if (typeof patch?.accentColor === 'string') {
      if (!/^#[0-9a-f]{6}$/i.test(patch.accentColor)) throw new Error('Cor inválida');
      clean.accentColor = patch.accentColor;
    }
    if (typeof patch?.startWithWindows === 'boolean') clean.startWithWindows = patch.startWithWindows;
    if (patch?.alerts && typeof patch.alerts === 'object') {
      const next = { ...config.alerts };
      for (const key of ['reminderEnabled', 'startEnabled']) {
        if (typeof patch.alerts[key] === 'boolean') next[key] = patch.alerts[key];
      }
      for (const [key, [min, max]] of Object.entries(ALERT_LIMITS)) {
        const n = Math.round(Number(patch.alerts[key]));
        if (key in patch.alerts && Number.isFinite(n)) next[key] = Math.min(max, Math.max(min, n));
      }
      clean.alerts = next;
    }
    if (typeof patch?.hotkey === 'string') {
      // Register first: only save a combination Windows actually accepted.
      if (!registerHotkey(patch.hotkey)) {
        registerHotkey(config.hotkey);
        throw new Error('Atalho inválido ou já usado por outro programa');
      }
      clean.hotkey = patch.hotkey;
    }
    saveConfig(__dirname, clean);
    Object.assign(config, clean);
    if ('startWithWindows' in clean) applyStartup();
    return clean;
  });

  ipcMain.handle('google:status', () => google.status());
  ipcMain.handle('google:login', async () => {
    const result = await google.login();
    alerts?.refresh();
    return result;
  });
  ipcMain.handle('google:cancel', () => google.cancelLogin());
  ipcMain.handle('google:logout', () => google.logout());
  ipcMain.handle('google:events', async (_e, timeMin, timeMax) => {
    try {
      return { events: await google.listEvents(String(timeMin), String(timeMax)) };
    } catch (err) {
      return { error: err.message, code: err.code ?? null };
    }
  });

  ipcMain.handle('media:key', (_e, acao, vezes) => actions.mediaKey(acao, vezes));
  ipcMain.handle('media:sessions', () => mediaSessions);
  ipcMain.handle('media:session', (_e, cmd, key) => mediaWatcher?.command(cmd, key));
  // ---------- Shortcuts ----------
  let shortcutList = shortcuts.fromConfig(config);
  const persistShortcuts = () => saveConfig(__dirname, { shortcuts: shortcutList, apps: undefined });
  if (!Array.isArray(config.shortcuts)) persistShortcuts(); // one-time migration from "apps"
  const findShortcut = (id) => {
    const found = shortcutList.find((s) => s.id === id);
    if (!found) throw new Error('Atalho não encontrado');
    return found;
  };

  ipcMain.handle('shortcuts:list', () => shortcuts.withIcons(shortcutList, () => send('shortcuts:changed')));
  ipcMain.handle('shortcuts:installed', () => shortcuts.listInstalled());
  ipcMain.handle('shortcuts:icon', (_e, target) => shortcuts.iconFor(String(target)));
  ipcMain.handle('shortcuts:add', async (_e, input) => {
    const item = { id: shortcuts.newId(), ...shortcuts.validate(input) };
    shortcutList.push(item);
    persistShortcuts();
    return { ...item, icon: await shortcuts.iconFor(item.target) };
  });
  ipcMain.handle('shortcuts:update', async (_e, id, input) => {
    Object.assign(findShortcut(id), shortcuts.validate(input));
    persistShortcuts();
  });
  ipcMain.handle('shortcuts:remove', (_e, id) => {
    findShortcut(id);
    shortcutList = shortcutList.filter((s) => s.id !== id);
    persistShortcuts();
  });
  ipcMain.handle('shortcuts:open', (_e, id) => actions.launch(findShortcut(id).target));
  ipcMain.handle('shortcuts:pickFile', async () => {
    // The file dialog is a separate window: keep the notch open meanwhile.
    const wasPinned = pinned;
    pinned = true;
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Escolher programa ou arquivo',
        properties: ['openFile'],
        filters: [
          { name: 'Programas e atalhos', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
          { name: 'Todos os arquivos', extensions: ['*'] },
        ],
      });
      if (canceled || !filePaths[0]) return null;
      return { name: path.basename(filePaths[0]).replace(/\.[^.]+$/, ''), target: filePaths[0] };
    } finally {
      pinned = wasPinned;
    }
  });
  ipcMain.handle('sys:info', () => actions.systemInfo());
  ipcMain.handle('site:open', (_e, url) => actions.openSite(url));
  // While the settings field records a new combination, the current one must not fire.
  ipcMain.handle('hotkey:pause', () => globalShortcut.unregisterAll());
  ipcMain.handle('hotkey:resume', () => registerHotkey(config.hotkey));
}

function onHotkey() {
  if (notchState === 'expanded') collapse();
  else expand({ focus: true, arm: false, force: true });
}

/** Replaces the global shortcut. Returns false if the accelerator is invalid or taken. */
function registerHotkey(accelerator) {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(accelerator, onHotkey);
  } catch {
    return false; // malformed accelerator
  }
}

// In dev, electron.exe needs the project path as argument.
const loginItemOptions = () => (app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] });

function applyStartup() {
  app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: config.startWithWindows });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    app.setAppUserModelId('dev.notchhub.app');
    config = loadConfig(__dirname);
    google.init({ appDir: __dirname, userDataDir: app.getPath('userData') });
    shortcuts.init({ userDataDir: app.getPath('userData') });
    shortcuts.listInstalled().catch((err) => console.error('[shortcuts]', err.message));
    registerIpc();
    createWindow();
    if (!registerHotkey(config.hotkey)) console.warn(`[hotkey] Não foi possível registrar ${config.hotkey} (já em uso?)`);
    applyStartup();
    watchHover();
    startEdge();
    alerts = startAlerts({ onAlert: (kind) => flashAlert(kind), startLeadMinutes: () => config.alerts.startLeadMinutes });
    mediaWatcher = startMediaWatcher({
      onSessions: (sessions) => {
        mediaSessions = sessions;
        send('media:sessions', sessions);
      },
    });
  });

  app.on('second-instance', () => expand({ focus: true, arm: false }));
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopEdgeWatcher?.();
    mediaWatcher?.stop();
    alerts?.stop();
  });
}
