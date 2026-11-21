// Calendar alerts: fires 'reminder' when a Google notification is due and 'start' when an event begins.
const google = require('./google');

// Short enough that an event created a minute ago still gets its alerts.
const FETCH_MS = 60 * 1000;
const TICK_MS = 5 * 1000;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
// An alert missed by more than this (sleep, app closed) is dropped, not fired late.
const GRACE_MS = 60 * 1000;

/** `onOngoing(ev)`: on every tick, the timed event in progress that ends first, if any. */
function startAlerts({ onAlert, onOngoing }) {
  let events = [];
  const fired = new Set();

  async function fetchEvents() {
    if (!google.status().connected) return;
    const now = Date.now();
    try {
      events = await google.listEvents(new Date(now - 60 * 60 * 1000).toISOString(), new Date(now + LOOKAHEAD_MS).toISOString());
    } catch (err) {
      console.error('[alerts]', err.message);
    }
  }

  function tick() {
    const now = Date.now();
    for (const ev of events) {
      if (ev.allDay) continue;
      const start = Date.parse(ev.start);
      const due = [...(ev.reminders ?? []).map((m) => ({ kind: 'reminder', at: start - m * 60 * 1000 })), { kind: 'start', at: start }];
      for (const { kind, at } of due) {
        const key = `${ev.id}|${kind}|${at}`;
        if (now < at || fired.has(key)) continue;
        fired.add(key);
        if (now - at <= GRACE_MS) onAlert(kind, ev);
      }
    }
    const ongoing = events
      .filter((ev) => !ev.allDay && Date.parse(ev.start) <= now && now < Date.parse(ev.end))
      .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))[0];
    if (ongoing) onOngoing?.(ongoing);
  }

  fetchEvents().then(tick);
  const fetchTimer = setInterval(fetchEvents, FETCH_MS);
  const tickTimer = setInterval(tick, TICK_MS);
  return {
    refresh: fetchEvents,
    stop() {
      clearInterval(fetchTimer);
      clearInterval(tickTimer);
    },
  };
}

module.exports = { startAlerts };
