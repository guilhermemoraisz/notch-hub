const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  assistantName: 'Sexta-feira',
  userName: '',
  hotkey: 'Control+Alt+Space',
  startWithWindows: false,
  accentColor: '#7ed957',
  // Hide the notch while an app is in focus; reveal it by pushing the mouse up.
  hideOutsideDesktop: true,
  // How hard to push (raw mouse counts). Higher = needs a stronger push.
  revealPush: 60,
  // Calendar alerts: yellow blinks on each Google notification, red blink before the event starts.
  alerts: { reminderEnabled: true, startEnabled: true, reminderBlinks: 2, startSeconds: 10, startLeadMinutes: 0 },
  apps: {},
};

function readExample(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'config.example.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Reads config.json from the project root and merges it over the defaults.
 * A missing file is fine; an invalid one is reported and ignored.
 */
function loadConfig(dir) {
  const file = path.join(dir, 'config.json');
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[config] Falha ao ler ${file}: ${err.message}`);
    // Fresh clone: start from the example (config.json is git-ignored).
    else user = readExample(dir);
  }
  // Legacy single `enabled` switch becomes the two per-alert switches.
  const { enabled, ...userAlerts } = user.alerts ?? {};
  const legacy = typeof enabled === 'boolean' ? { reminderEnabled: enabled, startEnabled: enabled } : {};
  return { ...DEFAULTS, ...user, alerts: { ...DEFAULTS.alerts, ...legacy, ...userAlerts }, apps: { ...(user.apps ?? DEFAULTS.apps) } };
}

/** Merges `patch` into config.json on disk, keeping every other key as is. */
function saveConfig(dir, patch) {
  const file = path.join(dir, 'config.json');
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`config.json inválido, não salvei: ${err.message}`);
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

module.exports = { loadConfig, saveConfig };
