// Calendar alerts: fires 'reminder' when a Google notification is due and
// 'start' a configurable number of minutes before an event begins (0 = at start time).
const google = require('./google');

// Short enough that an event created a minute ago still gets its alerts.
const FETCH_MS = 60 * 1000;
const TICK_MS = 5 * 1000;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
// An alert missed by more than this (sleep, app closed) is dropped, not fired late.
const GRACE_MS = 60 * 1000;

/** `startLeadMinutes()`: read on every tick so a settings change applies at once. */
function startAlerts({ onAlert, startLeadMinutes = () => 0 }) {
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
      const due = [...(ev.reminders ?? []).map((m) => ({ kind: 'reminder', at: start - m * 60 * 1000 })), { kind: 'start', at: start - startLeadMinutes() * 60 * 1000 }];
      for (const { kind, at } of due) {
        const key = `${ev.id}|${kind}|${at}`;
        if (now < at || fired.has(key)) continue;
        fired.add(key);
        if (now - at <= GRACE_MS) onAlert(kind, ev);
      }
    }
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
