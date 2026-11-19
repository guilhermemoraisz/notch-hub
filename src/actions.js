const { shell } = require('electron');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

// ---------- PowerShell helper ----------

/** Runs a PowerShell script passed as -EncodedCommand (no quoting issues). */
function runPowerShell(script, env = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, env: { ...process.env, ...env } },
  );
}

function waitExit(proc) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    proc.stderr?.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `exit ${code}`))));
  });
}

// ---------- Apps / sites ----------

// Two+ letters before ":" so "C:\..." is not treated as a URI scheme.
const URI_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Launches a shortcut target: absolute path (.exe/.lnk/file), Store app
 * (shell:AppsFolder\<AUMID>), URI (spotify:, https:) or command on PATH.
 */
async function launch(target) {
  if (/^shell:AppsFolder\\/i.test(target)) {
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (path.isAbsolute(target)) {
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return;
  }
  if (URI_SCHEME.test(target)) {
    await shell.openExternal(target);
    return;
  }
  if (/["&|<>^%]/.test(target)) throw new Error(`Comando inválido: ${target}`);
  spawn('cmd.exe', ['/d', '/c', `start "" ${target}`], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  }).unref();
}

async function openSite(url) {
  let parsed;
  try {
    const raw = String(url ?? '').trim();
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, erro: `URL inválida: ${url}` };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, erro: 'Só http/https' };
  await shell.openExternal(parsed.href);
  return { ok: true, abriu: parsed.href };
}

// ---------- Media keys ----------

const MEDIA_KEYS = {
  play_pause: 0xb3,
  proxima: 0xb0,
  anterior: 0xb1,
  parar: 0xb2,
  volume_mais: 0xaf,
  volume_menos: 0xae,
  mudo: 0xad,
};

/** Simulates a media key press; works with whatever player Windows sees as active. */
async function mediaKey(acao, vezes = 1) {
  const vk = MEDIA_KEYS[acao];
  if (vk === undefined) return { ok: false, erro: `Ação de mídia inválida: ${acao}` };
  const times = Math.min(Math.max(Math.trunc(Number(vezes)) || 1, 1), 50);
  // KEYEVENTF_EXTENDEDKEY = 1, KEYEVENTF_KEYUP = 2
  const script = `
$sig = '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
$k = Add-Type -MemberDefinition $sig -Name Keys -Namespace NotchHub -PassThru
for ($i = 0; $i -lt ${times}; $i++) {
  $k::keybd_event(${vk}, 0, 1, [UIntPtr]::Zero)
  $k::keybd_event(${vk}, 0, 3, [UIntPtr]::Zero)
}`;
  await waitExit(runPowerShell(script));
  return { ok: true, acao, vezes: times };
}

// ---------- System info ----------

function cpuTimes() {
  return os.cpus().reduce(
    (acc, { times: t }) => {
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    },
    { idle: 0, total: 0 },
  );
}

let lastCpu = cpuTimes();

/** CPU usage is measured since the previous call. */
function systemInfo() {
  const now = cpuTimes();
  const dIdle = now.idle - lastCpu.idle;
  const dTotal = now.total - lastCpu.total;
  lastCpu = now;
  const cpus = os.cpus();
  return {
    cpu: dTotal > 0 ? Math.round(100 * (1 - dIdle / dTotal)) : 0,
    cpuModel: cpus[0]?.model.trim() ?? '',
    nucleos: cpus.length,
    memTotal: os.totalmem(),
    memLivre: os.freemem(),
    uptime: os.uptime(),
  };
}

module.exports = { launch, openSite, mediaKey, systemInfo };
