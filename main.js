const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog } = require('electron');
const path = require('path');
const { loadConfig, saveConfig } = require('./src/config');
const actions = require('./src/actions');
const google = require('./src/google');
const shortcuts = require('./src/shortcuts');
const { startAlerts } = require('./src/alerts');
const { startEdgeWatcher } = require('./src/edge');
const { startMediaWatcher } = require('./src/media');

// Must match renderer/styles.css. `alert` fits the largest alert shape: the card with its hover actions.
const SIZE = {
  collapsed: { width: 210, height: 36 },
  countdown: { width: 300, height: 36 },
  alert: { width: 480, height: 140 },
  expanded: { width: 940, height: 580 },
};
const COLLAPSE_DELAY_MS = 80; // cursor must stay outside this long before closing
const ANIMATION_MS = 180; // must match --anim-close in renderer/styles.css
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

// Windows Do Not Disturb, reported by the edge helper.
let dnd = false;

/*
 * Calendar alerts: the notch grows to show the event. While an alert is up (and while it
 * morphs back) the window has the largest alert size and is click-through except over the
 * visible shape, which the renderer reports through 'alert:hover'.
 */
let alerts = null;
let alert = null; // { kind, event, shownAt, timer, deadline, remaining, hoverSince }
let alertWindow = false;
let alertSettleTimer = null;
// A notification that arrived while an event start was showing; shown once that one is dismissed.
let pendingReminder = null;
let countdown = null; // the event the pill counts down to, plus its expiry timer
const ALERT_LIMITS = { reminderSeconds: [3, 60], startSeconds: [3, 60] };
const ALERT_FLAGS = ['reminderEnabled', 'startEnabled', 'overFullscreen', 'pulse', 'countdown'];
const ALERT_CHOICES = { reminderDismiss: ['hover', 'timer'], startDismiss: ['hover', 'timer'], dnd: ['all', 'start', 'none'] };
// A hover counts as "seen" only after the alert is up for a moment and the cursor stays a bit,
// so a cursor passing by on its way to the browser tabs does not dismiss it.
const ALERT_ARM_MS = 500;
const ALERT_DWELL_MS = 250;
const ALERT_GROW_MS = 450; // the timer starts once the shape has grown
const ALERT_MORPH_MS = 480; // must cover the CSS shrink (height, then width)
const ALERT_HIDE_MS = 280; // must be shorter than the renderer's slide-up reset
const SNOOZE_MS = 5 * 60 * 1000;

const collapsedSize = () => (countdown ? 'countdown' : 'collapsed');
const currentSize = () => (notchState === 'expanded' ? 'expanded' : alertWindow ? 'alert' : collapsedSize());
const willHide = () => fullscreen || (!onDesktop && config.hideOutsideDesktop);

function alertAllowed(kind) {
  const a = config.alerts;
  if (!(kind === 'reminder' ? a.reminderEnabled : a.startEnabled)) return false;
  if (fullscreen && !a.overFullscreen) return false;
  if (dnd && (a.dnd === 'none' || (a.dnd === 'start' && kind === 'reminder'))) return false;
  return true;
}

/** null = stays until the user interacts. */
function alertTimerMs() {
  const a = config.alerts;
  if (alert.kind === 'reminder') return a.reminderDismiss === 'timer' ? a.reminderSeconds * 1000 : null;
  return a.startDismiss === 'timer' ? a.startSeconds * 1000 : null;
}

function runAlertTimer(ms) {
  clearTimeout(alert.timer);
  alert.timer = null;
  alert.deadline = null;
  if (!ms) return;
  alert.deadline = Date.now() + ms;
  alert.timer = setTimeout(() => dismissAlert(), ms);
}

function sendAlert(arrive = false) {
  const timerMs = alertTimerMs();
  send('notch:alert', { kind: alert.kind, event: alert.event, pulse: config.alerts.pulse, timerMs, arrive });
  const ms = timerMs && timerMs + ALERT_GROW_MS;
  // A replacement arriving while hovered restarts the time, but stays paused until the cursor leaves.
  if (alert.hoverSince) alert.remaining = ms;
  else runAlertTimer(ms);
}

const alertEntry = (kind, ev) => ({ id: ev.id, kind, title: ev.title, start: ev.start, end: ev.end, color: ev.color, link: ev.link ?? null, meet: ev.meet ?? null });

function showAlert(kind, ev) {
  if (!win || !alertAllowed(kind)) return;
  const entry = alertEntry(kind, ev);
  // The open panel already shows the calendar: only leave the countdown for later.
  if (notchState !== 'collapsed') {
    setCountdown(entry);
    return;
  }
  // Priority: a newer notification replaces an older one, an event start replaces notifications.
  // A notification never replaces a start: it waits until the start is dismissed.
  if (alert) {
    if (alert.event.id === entry.id && alert.kind === kind) return;
    if (alert.kind === 'start' && kind === 'reminder') {
      pendingReminder = entry;
      return;
    }
    Object.assign(alert, { kind, event: entry, shownAt: Date.now() });
    sendAlert();
    return;
  }
  clearTimeout(alertSettleTimer);
  alert = { kind, event: entry, shownAt: Date.now(), timer: null, deadline: null, remaining: null, hoverSince: null };
  const wasHidden = concealed;
  win.setBounds(boundsFor('alert'));
  alertWindow = true;
  win.setIgnoreMouseEvents(true, { forward: true });
  sendAlert(wasHidden);
  if (!wasHidden) return;
  // Show the window once the renderer has placed the notch above the screen, so it slides in.
  setTimeout(() => {
    if (!alert || !win) return;
    reveal();
    win.setIgnoreMouseEvents(true, { forward: true });
  }, REVEAL_DELAY_MS);
}

/** `toPanel`: the panel opens right away, so no countdown morph or hiding. */
function dismissAlert({ toPanel = false } = {}) {
  if (!alert) return;
  clearTimeout(alert.timer);
  const { event } = alert;
  alert = null;
  setCountdown(event, { silent: true });
  // Opening the panel shows the calendar, which covers the waiting notification too.
  const next = !toPanel && pendingReminder && Date.parse(pendingReminder.start) > Date.now() ? pendingReminder : null;
  pendingReminder = null;
  const hide = !toPanel && willHide();
  // One message: the renderer morphs the alert straight into the countdown pill.
  send('notch:alert', null, { countdown: countdownInfo(), hide });
  if (toPanel) return;
  clearTimeout(alertSettleTimer);
  alertSettleTimer = setTimeout(() => {
    alertSettleTimer = null;
    if (!win || alert || notchState !== 'collapsed') return;
    if (hide) conceal();
    alertWindow = false;
    win.setBounds(boundsFor(collapsedSize()));
    if (!hide) win.setIgnoreMouseEvents(false);
    applyVisibility();
    if (next) showAlert('reminder', next);
  }, hide ? ALERT_HIDE_MS : ALERT_MORPH_MS);
}

function onAlertHover(inside) {
  if (!win) return;
  // Only the visible shape takes the mouse; the rest of the alert-sized window stays click-through.
  if (alertWindow && !concealed) win.setIgnoreMouseEvents(!inside, { forward: true });
  if (!alert) return;
  if (inside) {
    alert.hoverSince = Date.now();
    // Hovering pauses the timer (the renderer pauses its bar).
    alert.remaining = alert.deadline ? alert.deadline - Date.now() : null;
    runAlertTimer(null);
    return;
  }
  const since = alert.hoverSince;
  alert.hoverSince = null;
  if (since && Date.now() - Math.max(since, alert.shownAt + ALERT_ARM_MS) >= ALERT_DWELL_MS) dismissAlert();
  else if (alert.remaining) runAlertTimer(alert.remaining); // passing by: resume
}

function snoozeAlert(id) {
  const ev = alert?.kind === 'reminder' && alert.event.id === id ? alert.event : null;
  dismissAlert();
  if (ev) setTimeout(() => showAlert('reminder', ev), SNOOZE_MS);
}

const countdownInfo = () => (countdown ? { ...countdown, timer: undefined } : null);

/** After a reminder: until the event starts. After a start (or while an event is on): until it ends. */
function setCountdown(ev, { silent = false } = {}) {
  clearTimeout(countdown?.timer);
  countdown = null;
  if (ev && config.alerts.countdown) {
    const until = Date.parse(ev.kind === 'start' ? ev.end : ev.start);
    if (until > Date.now()) countdown = { ...ev, timer: setTimeout(() => setCountdown(null), until - Date.now()) };
  }
  if (silent) return;
  send('notch:countdown', countdownInfo());
  // Grow the window before the pill grows; shrink it only after the pill has shrunk.
  if (notchState !== 'collapsed' || alertWindow) return;
  if (countdown) win?.setBounds(boundsFor('countdown'));
  else setTimeout(() => notchState === 'collapsed' && !alertWindow && win?.setBounds(boundsFor(collapsedSize())), ALERT_MORPH_MS);
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
  dismissAlert({ toPanel: true });
  clearTimeout(collapseTimer);
  clearTimeout(alertSettleTimer);
  if (alertWindow && !concealed) win.setIgnoreMouseEvents(false);
  alertWindow = false;
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
  const hide = willHide();
  notchState = 'collapsing';
  send('notch:state', hide ? 'hidden' : 'collapsed');
  // Drop keyboard focus so typing does not go into the hidden panel.
  if (win.isFocused()) win.blur();
  // Let the CSS animation finish before shrinking the real window.
  collapseTimer = setTimeout(() => {
    if (notchState !== 'collapsing') return;
    if (hide) conceal();
    win.setBounds(boundsFor(collapsedSize()));
    notchState = 'collapsed';
    if (hide) send('notch:state', 'collapsed');
    applyVisibility();
  }, ANIMATION_MS);
}

/** Collapsed pill is visible only on the desktop; outside it the window hides. */
function applyVisibility() {
  if (!win) return;
  if (fullscreen) {
    // An alert shown over the fullscreen app stays until dismissed.
    if (alertWindow) return;
    // Close instantly, no animation.
    clearTimeout(collapseTimer);
    if (notchState !== 'collapsed') {
      win.setBounds(boundsFor(collapsedSize()));
      notchState = 'collapsed';
      send('notch:state', 'collapsed');
    }
    conceal();
    return;
  }
  if (alertWindow) return; // the alert manages visibility until it settles
  if (onDesktop || !config.hideOutsideDesktop) {
    if (concealed) reveal();
  } else if (notchState === 'collapsed' && !concealed) {
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
    onDnd: (on) => {
      dnd = on;
    },
    onExit: (err) => {
      // Without the helper there is no way to reveal the notch: keep it visible.
      console.error(`[edge] ${err.message}`);
      stopEdgeWatcher = null;
      onDesktop = true;
      fullscreen = false;
      dnd = false;
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
    if (!win || win.isDestroyed() || notchState !== 'expanded' || pinned) return;
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

  // Timers outlive the window during quit; null it so their guards bail out.
  win.on('closed', () => { win = null; });

  win.on('blur', () => {
    if (notchState === 'expanded' && !pinned && !cursorInsideWindow()) collapse();
  });

  // Keep the notch centered when monitors or resolution change.
  const recenter = () => win.setBounds(boundsFor(currentSize()));
  screen.on('display-metrics-changed', recenter);
  screen.on('display-added', recenter);
  screen.on('display-removed', recenter);
}

function registerIpc() {
  // While an alert is up, hovering shows its actions instead of opening the panel.
  ipcMain.on('notch:hover', () => !alert && expand());
  ipcMain.on('alert:hover', (_e, inside) => onAlertHover(Boolean(inside)));
  ipcMain.on('alert:dismiss', () => dismissAlert());
  ipcMain.on('alert:snooze', (_e, id) => snoozeAlert(String(id)));
  // A click is explicit: open the panel even over a fullscreen app.
  ipcMain.on('alert:open', () => alert && expand({ force: true }));
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
      const input = patch.alerts;
      const next = { ...config.alerts };
      for (const key of ALERT_FLAGS) {
        if (typeof input[key] === 'boolean') next[key] = input[key];
      }
      for (const [key, [min, max]] of Object.entries(ALERT_LIMITS)) {
        const n = Math.round(Number(input[key]));
        if (key in input && Number.isFinite(n)) next[key] = Math.min(max, Math.max(min, n));
      }
      for (const [key, options] of Object.entries(ALERT_CHOICES)) {
        if (options.includes(input[key])) next[key] = input[key];
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
    if (clean.alerts && !clean.alerts.countdown && countdown) setCountdown(null);
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
    alerts = startAlerts({
      onAlert: showAlert,
      // An event in progress keeps its countdown, even after a restart or when its start alert was off.
      onOngoing: (ev) => {
        if (!countdown && !alert && config.alerts.countdown) setCountdown(alertEntry('start', ev));
      },
    });
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
