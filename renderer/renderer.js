/* global notch */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Icons (Feather-style paths) ----------

const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  'volume-low': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  next: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  prev: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  reset: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  'chev-left': '<polyline points="15 18 9 12 15 6"/>',
  'chev-right': '<polyline points="9 18 15 12 9 6"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
};

const svg = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;

function hydrateIcons(root = document) {
  for (const node of $$('i[data-icon]', root)) node.innerHTML = svg(node.dataset.icon);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon, title, className = 'icon-btn sm') {
  const btn = el('button', className);
  btn.type = 'button';
  btn.title = title;
  btn.innerHTML = svg(icon);
  return btn;
}

// ---------- State ----------

const state = {
  config: null,
  pinned: false,
  expanded: false,
  page: 'home',
};

// ---------- Notch open/close ----------

const notchEl = $('#notch');

notchEl.addEventListener('mouseenter', () => {
  if (!state.expanded) notch.hover();
});
$('#pill').addEventListener('click', () => notch.hover());

notch.onState((s) => {
  state.expanded = s === 'expanded';
  // 'hidden' = closing to invisible (outside the desktop): fade out, no pill.
  notchEl.classList.toggle('vanish', s === 'hidden');
  notchEl.classList.toggle('collapsed', s === 'collapsed');
  if (state.expanded) refreshCalendarIfStale();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Esc closes the shortcut dialog first, then the notch.
    if (!$('#sc-modal').hidden) {
      closeShortcutModal();
      return;
    }
    document.activeElement?.blur();
    notch.collapse();
  }
});

$('#btn-pin').addEventListener('click', async () => {
  state.pinned = await notch.setPinned(!state.pinned);
  $('#btn-pin').classList.toggle('active', state.pinned);
  $('#btn-pin').title = state.pinned ? 'Desafixar' : 'Fixar aberto';
});

$('#btn-quit').addEventListener('click', () => notch.quit());

// ---------- Navigation ----------

function showPage(page) {
  state.page = page;
  for (const b of $$('.nav-item')) b.classList.toggle('active', b.dataset.page === page);
  for (const p of $$('.page')) p.classList.toggle('active', p.id === `page-${page}`);
  if (page === 'pc') refreshPc();
  if (page === 'settings') refreshGoogleStatus();
}

for (const b of $$('.nav-item')) b.addEventListener('click', () => showPage(b.dataset.page));

// ---------- Clock ----------

function tickClock() {
  const now = new Date();
  $('#pill-time').textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
  $('#brand-date').textContent = date.charAt(0).toUpperCase() + date.slice(1);
}

// ---------- Calendar ----------

const HOUR_PX = 44;
const MIN_EVENT_MIN = 22; // short events still get room for their title
const STALE_MS = 60_000;

const cal = {
  day: startOfDay(new Date()),
  events: [],
  loadedAt: 0,
  loadedDay: null,
  scrolledDay: null,
  email: null,
  loading: false,
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const sameDay = (a, b) => a.getTime() === b.getTime();
const fmtTime = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function buildGrid() {
  const grid = $('#cal-grid');
  grid.style.height = `${24 * HOUR_PX}px`;
  for (let h = 0; h < 24; h++) {
    const row = el('div', 'cal-hour');
    row.style.top = `${h * HOUR_PX}px`;
    row.append(el('span', '', h === 0 ? '' : `${String(h).padStart(2, '0')}:00`));
    grid.append(row);
  }
  const now = el('div', 'cal-now');
  now.id = 'cal-now';
  grid.append(now);
}

/** Side-by-side columns for overlapping events (like Google's day view). */
function layoutEvents(events) {
  const sorted = [...events].sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const columns = [];
    for (const ev of group) {
      let col = columns.findIndex((end) => end <= ev.s);
      if (col === -1) col = columns.push(0) - 1;
      columns[col] = ev.e;
      ev.col = col;
    }
    for (const ev of group) ev.cols = columns.length;
    out.push(...group);
    group = [];
    groupEnd = -1;
  };
  for (const ev of sorted) {
    if (group.length && ev.s >= groupEnd) flush();
    group.push(ev);
    groupEnd = Math.max(groupEnd, ev.e);
  }
  if (group.length) flush();
  return out;
}

/** Google picks the browser's default account; authuser forces the connected one. */
function withAccount(url) {
  const u = new URL(url);
  if (cal.email) u.searchParams.set('authuser', cal.email);
  return u.href;
}

function openEvent(link) {
  if (!link) return;
  notch.collapse();
  notch.openSite(withAccount(link));
}

function renderEvents() {
  const grid = $('#cal-grid');
  for (const node of $$('.cal-event', grid)) node.remove();

  const dayStart = cal.day.getTime();
  const dayEnd = addDays(cal.day, 1).getTime();
  const allDay = [];
  const timed = [];

  for (const ev of cal.events) {
    if (ev.allDay) {
      allDay.push(ev);
      continue;
    }
    const start = new Date(ev.start).getTime();
    const end = new Date(ev.end).getTime();
    const s = Math.max(0, (start - dayStart) / 60_000);
    const e = Math.min(1440, (end - dayStart) / 60_000);
    if (end <= dayStart || start >= dayEnd) continue;
    timed.push({ ...ev, s, e: Math.max(e, s + MIN_EVENT_MIN) });
  }

  for (const ev of layoutEvents(timed)) {
    const block = el('button', 'cal-event');
    block.type = 'button';
    block.style.top = `${(ev.s / 60) * HOUR_PX}px`;
    block.style.height = `${((ev.e - ev.s) / 60) * HOUR_PX - 2}px`;
    block.style.left = `calc(56px + (100% - 62px) * ${ev.col / ev.cols})`;
    block.style.width = `calc((100% - 62px) / ${ev.cols} - 3px)`;
    block.style.setProperty('--ev', ev.color);
    block.title = ev.title;
    const start = new Date(ev.start);
    const end = new Date(ev.end);
    block.append(el('b', '', ev.title), el('span', '', `${fmtTime(start)} – ${fmtTime(end)}`));
    if (ev.e - ev.s < 45) block.classList.add('short');
    block.addEventListener('click', () => openEvent(ev.link));
    grid.append(block);
  }

  const strip = $('#cal-allday');
  strip.hidden = allDay.length === 0;
  strip.replaceChildren(
    ...allDay.map((ev) => {
      const chip = el('button', 'cal-chip', ev.title);
      chip.type = 'button';
      chip.style.setProperty('--ev', ev.color);
      chip.title = ev.title;
      chip.addEventListener('click', () => openEvent(ev.link));
      return chip;
    }),
  );
}

function renderNowLine() {
  const line = $('#cal-now');
  const today = startOfDay(new Date());
  line.hidden = !sameDay(cal.day, today);
  const now = new Date();
  line.style.top = `${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX}px`;
}

/** Scrolls once per day shown: to now (today), first event, or 8h. */
function autoScroll() {
  if (cal.scrolledDay && sameDay(cal.scrolledDay, cal.day)) return;
  cal.scrolledDay = cal.day;
  const body = $('#cal-body');
  const today = startOfDay(new Date());
  let minutes = 8 * 60;
  if (sameDay(cal.day, today)) {
    const now = new Date();
    minutes = now.getHours() * 60 + now.getMinutes() - 90;
  } else {
    const first = cal.events.filter((e) => !e.allDay).map((e) => new Date(e.start)).sort((a, b) => a - b)[0];
    if (first && first >= cal.day) minutes = first.getHours() * 60 + first.getMinutes() - 30;
  }
  body.scrollTop = Math.max(0, (minutes / 60) * HOUR_PX);
}

function renderCalHeader() {
  const label = cal.day.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#cal-date').textContent = label.charAt(0).toUpperCase() + label.slice(1);
  $('#cal-today').disabled = sameDay(cal.day, startOfDay(new Date()));
}

function showOverlay(content) {
  const overlay = $('#cal-overlay');
  if (!content) {
    overlay.hidden = true;
    return;
  }
  overlay.replaceChildren(...content);
  overlay.hidden = false;
}

function overlayMessage(title, text, button) {
  const icon = el('div', 'cal-overlay-icon');
  icon.innerHTML = svg('calendar');
  const nodes = [icon, el('b', '', title)];
  if (text) nodes.push(el('p', '', text));
  if (button) nodes.push(button);
  return nodes;
}

function connectButton(label = 'Conectar Google Agenda') {
  const btn = el('button', 'pill-btn accent', label);
  btn.type = 'button';
  btn.addEventListener('click', connectGoogle);
  return btn;
}

async function loadCalendar({ force = false } = {}) {
  if (cal.loading) return;
  if (!force && cal.loadedDay && sameDay(cal.loadedDay, cal.day) && Date.now() - cal.loadedAt < STALE_MS) return;

  const status = await notch.google.status();
  cal.email = status.email;
  if (!status.configured) {
    showOverlay(
      overlayMessage(
        'Agenda não configurada',
        status.error ??
          'Crie um OAuth client "App para computador" no Google Cloud e salve o JSON como google-client.json na pasta do app.',
      ),
    );
    return;
  }
  if (status.loggingIn) {
    showWaitingOverlay();
    return;
  }
  if (!status.connected) {
    showOverlay(overlayMessage('Conecte sua agenda', 'Faça login com o Google para ver seus eventos aqui.', connectButton()));
    return;
  }

  cal.loading = true;
  const day = cal.day;
  $('#cal-refresh').classList.add('spin');
  try {
    const res = await notch.google.events(day.toISOString(), addDays(day, 1).toISOString());
    if (!sameDay(day, cal.day)) return; // user moved to another day meanwhile
    if (res.error) {
      showOverlay(
        res.code === 'NOT_CONNECTED'
          ? overlayMessage('Sessão expirada', 'Conecte de novo para continuar vendo a agenda.', connectButton('Reconectar'))
          : overlayMessage('Não consegui carregar a agenda', res.error),
      );
      return;
    }
    showOverlay(null);
    cal.events = res.events;
    cal.loadedAt = Date.now();
    cal.loadedDay = day;
    renderEvents();
    autoScroll();
  } finally {
    cal.loading = false;
    $('#cal-refresh').classList.remove('spin');
  }
}

function refreshCalendarIfStale() {
  // Day rolled over while the app was open: follow "today".
  const today = startOfDay(new Date());
  if (cal.loadedDay && sameDay(cal.loadedDay, addDays(today, -1)) && sameDay(cal.day, cal.loadedDay)) setDay(today);
  else loadCalendar();
}

function setDay(day) {
  cal.day = startOfDay(day);
  cal.events = [];
  renderCalHeader();
  renderEvents();
  renderNowLine();
  loadCalendar({ force: true });
}

$('#cal-today').addEventListener('click', () => setDay(new Date()));
$('#cal-prev').addEventListener('click', () => setDay(addDays(cal.day, -1)));
$('#cal-next').addEventListener('click', () => setDay(addDays(cal.day, 1)));
$('#cal-refresh').addEventListener('click', () => loadCalendar({ force: true }));
$('#cal-open').addEventListener('click', () => {
  const d = cal.day;
  notch.collapse();
  notch.openSite(withAccount(`https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`));
});

// Cancel covers Google error pages, which never redirect back to the app.
function showWaitingOverlay() {
  const cancel = el('button', 'pill-btn', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', () => notch.google.cancel());
  showOverlay(overlayMessage('Aguardando login…', 'Conclua o login no navegador que abriu.', cancel));
}

async function connectGoogle() {
  // The notch is not pinned here: login happens in the browser and the user
  // must be free to leave; reopening the notch keeps showing this state.
  showWaitingOverlay();
  try {
    await notch.google.login();
  } catch (err) {
    showOverlay(overlayMessage('Login não concluído', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), connectButton('Tentar de novo')));
    return;
  } finally {
    refreshGoogleStatus();
  }
  loadCalendar({ force: true });
}

// ---------- Media ----------

const APP_NAMES = [
  ['spotify', 'Spotify'], ['chrome', 'Chrome'], ['msedge', 'Edge'], ['firefox', 'Firefox'],
  ['opera', 'Opera'], ['brave', 'Brave'], ['vlc', 'VLC'], ['discord', 'Discord'], ['zune', 'Media Player'],
];

function appName(aumid) {
  const id = String(aumid ?? '').toLowerCase();
  const known = APP_NAMES.find(([k]) => id.includes(k));
  return known ? known[1] : String(aumid).split('!').pop().replace(/\.exe$/i, '');
}

function mediaButton(icon, title, cmd, key, enabled, className = 'icon-btn sm') {
  const btn = iconButton(icon, title, className);
  btn.disabled = !enabled;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation(); // the card itself has its own click (focus player)
    btn.disabled = true;
    try {
      await notch.mediaControl(cmd, key);
    } finally {
      btn.disabled = !enabled;
    }
  });
  return btn;
}

function renderMediaSessions(sessions) {
  $('#pill-dot').classList.toggle('ok', sessions.some((s) => s.status === 'Playing'));

  const list = $('#media-list');
  if (!sessions.length) {
    list.replaceChildren(el('div', 'empty', 'Nada tocando'));
    return;
  }
  // Playing sessions first.
  const sorted = [...sessions].sort((a, b) => (b.status === 'Playing') - (a.status === 'Playing'));
  list.replaceChildren(
    ...sorted.map((s) => {
      const playing = s.status === 'Playing';
      const item = el('div', `media-item${playing ? '' : ' paused'}`);
      item.title = `Abrir no ${appName(s.app)}`;
      item.addEventListener('click', () => {
        notch.collapse();
        notch.mediaControl('focus', s.key);
      });

      const cover = el('div', 'cover');
      if (s.thumb) cover.style.backgroundImage = `url("${s.thumb}")`;
      else cover.innerHTML = svg('music');

      const info = el('div', 'media-info');
      info.append(
        el('div', 'media-title', s.title || 'Sem título'),
        el('div', 'media-sub', s.artist || ''),
        el('div', 'media-app', appName(s.app)),
      );
      const top = el('div', 'media-top');
      top.append(cover, info);

      const ctrls = el('div', 'media-ctrls');
      ctrls.append(
        mediaButton('prev', 'Anterior', 'prev', s.key, s.canPrev),
        mediaButton(playing ? 'pause' : 'play', playing ? 'Pausar' : 'Tocar', 'toggle', s.key, s.canToggle, 'icon-btn play'),
        mediaButton('next', 'Próxima', 'next', s.key, s.canNext),
      );

      item.append(top, ctrls);
      return item;
    }),
  );
}

notch.onMediaSessions(renderMediaSessions);

for (const btn of $$('[data-media]')) {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await notch.media(btn.dataset.media, Number(btn.dataset.times ?? 1));
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Shortcuts ----------

const sc = { list: [], installed: null, editing: null, mode: 'installed' };

const cleanError = (err) => String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function shortcutIcon(item, className = 'sc-icon') {
  if (item.icon) {
    const img = el('img', className);
    img.src = item.icon;
    img.alt = '';
    return img;
  }
  return el('span', `${className} letter`, item.name.charAt(0));
}

function renderShortcuts() {
  const tiles = sc.list.map((item) => {
    const tile = el('div', 'card app-tile');
    tile.title = item.target;
    tile.addEventListener('click', () => {
      notch.collapse();
      notch.shortcuts.open(item.id);
    });

    const actionsBox = el('div', 'tile-actions');
    const edit = iconButton('edit', 'Editar');
    edit.addEventListener('click', (e) => {
      e.stopPropagation();
      openShortcutModal(item);
    });
    const del = iconButton('trash', 'Remover');
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await notch.shortcuts.remove(item.id);
      await loadShortcuts();
    });
    actionsBox.append(edit, del);

    tile.append(shortcutIcon(item), el('span', 'tile-name', item.name), actionsBox);
    return tile;
  });

  const add = el('button', 'card app-tile add-tile');
  add.type = 'button';
  add.innerHTML = svg('plus');
  add.append(el('span', 'tile-name', 'Adicionar'));
  add.addEventListener('click', () => openShortcutModal());

  $('#apps-grid').replaceChildren(...tiles, add);
}

async function loadShortcuts() {
  sc.list = await notch.shortcuts.list();
  renderShortcuts();
}

// Fired when icons borrowed from installed apps become available.
notch.shortcuts.onChanged(loadShortcuts);

function setTab(tab) {
  sc.mode = tab;
  for (const t of $$('#sc-tabs .tab')) t.classList.toggle('active', t.dataset.tab === tab);
  for (const p of $$('#sc-modal .tab-panel')) {
    const panel = p.dataset.panel;
    p.hidden = !(panel === tab || (panel === 'form' && (tab === 'site' || tab === 'edit')));
  }
  $('#sc-error').hidden = true;
  if (tab === 'installed') {
    loadInstalled();
    setTimeout(() => $('#sc-search').focus(), 30);
  }
  if (tab === 'site') {
    $('#sc-name').value = '';
    $('#sc-target').value = '';
    $('#sc-target').placeholder = 'https://github.com';
    $('#sc-save').textContent = 'Adicionar';
    setTimeout(() => $('#sc-name').focus(), 30);
  }
}

function openShortcutModal(item = null) {
  sc.editing = item;
  $('#sc-modal').hidden = false;
  $('#sc-tabs').hidden = Boolean(item);
  if (item) {
    $('#sc-modal-title').textContent = 'Editar atalho';
    setTab('edit');
    $('#sc-name').value = item.name;
    $('#sc-target').value = item.target;
    $('#sc-save').textContent = 'Salvar';
    setTimeout(() => $('#sc-name').focus(), 30);
  } else {
    $('#sc-modal-title').textContent = 'Novo atalho';
    $('#sc-search').value = '';
    setTab('installed');
  }
}

function closeShortcutModal() {
  $('#sc-modal').hidden = true;
  sc.editing = null;
}

async function addShortcut(input) {
  await notch.shortcuts.add(input);
  closeShortcutModal();
  await loadShortcuts();
}

function renderInstalled() {
  const box = $('#sc-installed');
  if (!sc.installed) {
    box.replaceChildren(el('div', 'empty', 'Carregando apps…'));
    return;
  }
  const q = $('#sc-search').value.trim().toLowerCase();
  const items = sc.installed.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 150);
  if (!items.length) {
    box.replaceChildren(el('div', 'empty', 'Nenhum app encontrado'));
    return;
  }
  iconObserver.disconnect();
  box.replaceChildren(
    ...items.map((a) => {
      const row = el('button', 'installed-row');
      row.type = 'button';
      row.append(shortcutIcon(a, 'row-icon'), el('span', '', a.name), el('span', 'row-add', '+'));
      row.addEventListener('click', () => addShortcut({ name: a.name, target: a.target }));
      if (!a.icon) {
        row.iconTarget = a;
        iconObserver.observe(row);
      }
      return row;
    }),
  );
}

// Icons of installed apps load only when their row scrolls into view.
const iconObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const row = entry.target;
      iconObserver.unobserve(row);
      const app = row.iconTarget;
      notch.shortcuts.icon(app.target).then((icon) => {
        if (!icon) return;
        app.icon = icon; // remembered for later searches
        row.firstChild.replaceWith(shortcutIcon(app, 'row-icon'));
      });
    }
  },
  { root: $('#sc-installed') },
);

async function loadInstalled() {
  renderInstalled();
  if (sc.installed) return;
  sc.installed = await notch.shortcuts.installed();
  renderInstalled();
}

$('#sc-search').addEventListener('input', renderInstalled);
for (const t of $$('#sc-tabs .tab')) t.addEventListener('click', () => setTab(t.dataset.tab));
$('#sc-close').addEventListener('click', closeShortcutModal);
$('#sc-modal').addEventListener('click', (e) => {
  if (e.target.id === 'sc-modal') closeShortcutModal();
});

$('#sc-pick').addEventListener('click', async () => {
  const picked = await notch.shortcuts.pickFile();
  if (!picked) return;
  // Let the user confirm or rename before saving.
  setTab('site');
  $('#sc-name').value = picked.name;
  $('#sc-target').value = picked.target;
});

$('#sc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = { name: $('#sc-name').value, target: $('#sc-target').value };
  try {
    if (sc.editing) {
      await notch.shortcuts.update(sc.editing.id, input);
      closeShortcutModal();
      await loadShortcuts();
    } else {
      await addShortcut(input);
    }
  } catch (err) {
    $('#sc-error').textContent = cleanError(err);
    $('#sc-error').hidden = false;
  }
});

// ---------- PC ----------

const GB = 1024 ** 3;

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m}min`;
}

async function refreshPc() {
  const info = await notch.systemInfo();
  const used = info.memTotal - info.memLivre;
  const ramPct = Math.round((100 * used) / info.memTotal);
  $('#pc-model').textContent = `${info.cpuModel} · ${info.nucleos} threads`;
  $('#pc-cpu').textContent = `${info.cpu}%`;
  $('#pc-cpu-bar').style.width = `${info.cpu}%`;
  $('#pc-ram').textContent = `${(used / GB).toFixed(1)} / ${(info.memTotal / GB).toFixed(0)} GB`;
  $('#pc-ram-bar').style.width = `${ramPct}%`;
  $('#pc-uptime').textContent = formatUptime(info.uptime);
}

// ---------- Settings ----------

const ACCENT_PRESETS = ['#7ed957', '#4cc9f0', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#f87171', '#e8eaed'];

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  for (const s of $$('.swatch[data-color]')) s.classList.toggle('selected', s.dataset.color === color);
  const custom = $('#accent-custom');
  custom.value = color;
  custom.parentElement.classList.toggle('selected', !ACCENT_PRESETS.includes(color));
}

async function saveAccent(color) {
  applyAccent(color);
  await notch.saveSettings({ accentColor: color });
}

function renderSwatches() {
  const custom = $('#swatches .custom');
  for (const color of ACCENT_PRESETS) {
    const s = el('button', 'swatch');
    s.type = 'button';
    s.dataset.color = color;
    s.title = color;
    s.style.background = color;
    s.addEventListener('click', () => saveAccent(color));
    custom.before(s);
  }
  // `input` previews while dragging; `change` saves once the picker closes.
  // The native picker is a separate window: keep the notch open meanwhile.
  const picker = $('#accent-custom');
  const releasePin = () => notch.setPinned(state.pinned);
  picker.addEventListener('click', () => notch.setPinned(true));
  picker.addEventListener('input', (e) => applyAccent(e.target.value));
  picker.addEventListener('change', (e) => {
    saveAccent(e.target.value);
    releasePin();
  });
  picker.addEventListener('blur', releasePin);
}

// ---------- Hotkey recorder ----------

const HOTKEY_HELP = 'Abre e fecha o notch, até sobre jogos em tela cheia';
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']);
const CODE_TO_KEY = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};

const prettyHotkey = (accel) => accel.replace('Control', 'Ctrl').replace('Super', 'Win').split('+').join(' + ');

/** KeyboardEvent -> Electron accelerator ("Control+Alt+Space"), or null if incomplete. */
function toAccelerator(e) {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key = CODE_TO_KEY[e.code];
  if (!key && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  if (!key && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (!key && /^Numpad\d$/.test(e.code)) key = `num${e.code.slice(6)}`;
  if (!key && /^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
  // Some input sources (remapping tools, synthetic input) send no e.code.
  if (!key && /^[a-z0-9]$/i.test(e.key)) key = e.key.toUpperCase();
  if (!key && e.key === ' ') key = 'Space';
  if (!key && /^F([1-9]|1\d|2[0-4])$/.test(e.key)) key = e.key;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  // A bare letter would hijack normal typing everywhere; F-keys alone are fine.
  if (!mods.length && !/^F\d+$/.test(key)) return null;
  return [...mods, key].join('+');
}

const hotkeyField = $('#hotkey-field');
let recording = false;

function renderHotkey() {
  hotkeyField.classList.toggle('recording', recording);
  hotkeyField.textContent = recording ? 'Pressione a combinação…' : prettyHotkey(state.config.hotkey);
  $('#hotkey-hint').textContent = prettyHotkey(state.config.hotkey).replace(/ \+ /g, '+');
}

function setHotkeyHelp(text, isError = false) {
  const help = $('#hotkey-help');
  help.textContent = text;
  help.classList.toggle('error-text', isError);
}

async function stopRecording() {
  recording = false;
  window.removeEventListener('keydown', onRecordKey, true);
  await notch.resumeHotkey();
  renderHotkey();
}

// Capture phase: keeps Esc from closing the notch while recording.
async function onRecordKey(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    await stopRecording();
    setHotkeyHelp(HOTKEY_HELP);
    return;
  }
  const accel = toAccelerator(e);
  if (!accel) return; // still holding modifiers only
  window.removeEventListener('keydown', onRecordKey, true);
  recording = false;
  try {
    await notch.saveSettings({ hotkey: accel });
    state.config.hotkey = accel;
    setHotkeyHelp(HOTKEY_HELP);
  } catch (err) {
    await notch.resumeHotkey();
    setHotkeyHelp(cleanError(err), true);
  }
  renderHotkey();
}

hotkeyField.addEventListener('click', async () => {
  if (recording) return;
  recording = true;
  await notch.pauseHotkey();
  setHotkeyHelp('Use Ctrl, Alt, Shift ou Win + uma tecla · Esc cancela');
  window.addEventListener('keydown', onRecordKey, true);
  renderHotkey();
});
hotkeyField.addEventListener('blur', () => recording && stopRecording().then(() => setHotkeyHelp(HOTKEY_HELP)));

function renderStartupToggle(on) {
  $('#toggle-startup').setAttribute('aria-checked', String(on));
}

$('#toggle-startup').addEventListener('click', async () => {
  const btn = $('#toggle-startup');
  const next = btn.getAttribute('aria-checked') !== 'true';
  btn.disabled = true;
  try {
    await notch.saveSettings({ startWithWindows: next });
    renderStartupToggle(next);
  } finally {
    btn.disabled = false;
  }
});

async function refreshGoogleStatus() {
  const s = await notch.google.status();
  const text = $('#google-status');
  const btn = $('#google-btn');
  btn.hidden = !s.configured;
  if (!s.configured) text.textContent = s.error ?? 'Falta o arquivo google-client.json na pasta do app';
  else if (s.connected) text.textContent = `Conectado${s.email ? ` como ${s.email}` : ''}`;
  else text.textContent = 'Não conectado';
  btn.textContent = s.connected ? 'Desconectar' : 'Conectar';
  btn.classList.toggle('accent', !s.connected);
  btn.dataset.connected = String(s.connected);
}

$('#google-btn').addEventListener('click', async () => {
  const btn = $('#google-btn');
  btn.disabled = true;
  try {
    if (btn.dataset.connected === 'true') {
      await notch.google.logout();
      cal.events = [];
      cal.loadedDay = null;
      renderEvents();
      loadCalendar({ force: true });
    } else {
      await connectGoogle();
    }
  } finally {
    btn.disabled = false;
    refreshGoogleStatus();
  }
});

// ---------- Boot ----------

async function boot() {
  hydrateIcons();
  buildGrid();

  state.config = await notch.getConfig();
  const { assistantName, userName } = state.config;
  $('#brand-name').textContent = assistantName;
  $('#greeting').textContent = userName ? `Olá, ${userName}!` : 'Olá!';
  renderHotkey();
  loadShortcuts();
  renderSwatches();
  applyAccent(state.config.accentColor);
  renderStartupToggle(state.config.startWithWindows);
  renderMediaSessions(await notch.mediaSessions());

  tickClock();
  setInterval(tickClock, 5000);

  renderCalHeader();
  renderNowLine();
  autoScroll();
  setInterval(renderNowLine, 30_000);
  loadCalendar({ force: true });
  setInterval(() => state.expanded && loadCalendar({ force: true }), 5 * 60_000);

  setInterval(() => state.expanded && state.page === 'pc' && refreshPc(), 2000);
}

boot();
