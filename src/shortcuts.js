const { app, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);

/*
 * Shortcuts shown on the "Atalhos" page. Each one is { id, name, target }:
 *   - absolute path     C:\...\App.exe, a .lnk from the Start menu, any file
 *   - Store app         shell:AppsFolder\<AUMID>
 *   - URI               spotify:, ms-settings:, https://site
 *   - command on PATH   notepad, code
 * Icons are resolved from the target and cached on disk (userData).
 */

const MAX_NAME = 60;
const MAX_TARGET = 2000;
const IGNORED_START_MENU = /uninstall|desinstal|readme|leia-me|help|ajuda|website|manual|documentation/i;

let iconCacheFile = null;
let iconCache = {};
let installedCache = null;
let installedPromise = null;

function init({ userDataDir }) {
  iconCacheFile = path.join(userDataDir, 'icon-cache.json');
  try {
    iconCache = JSON.parse(fs.readFileSync(iconCacheFile, 'utf8'));
  } catch {
    iconCache = {};
  }
}

// Debounced: many icons resolve in a burst; write the cache once.
let saveTimer = null;
function saveIconCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(iconCacheFile, JSON.stringify(iconCache));
    } catch (err) {
      console.error('[shortcuts] cache de ícones:', err.message);
    }
  }, 500);
}

const newId = () => crypto.randomBytes(6).toString('hex');

function validate(input) {
  const name = String(input?.name ?? '').trim();
  let target = String(input?.target ?? '').trim();
  if (!name || name.length > MAX_NAME) throw new Error(`Nome deve ter entre 1 e ${MAX_NAME} caracteres`);
  if (!target || target.length > MAX_TARGET || /[\r\n]/.test(target)) throw new Error('Destino inválido');
  // "youtube.com" typed as a site: make it a URL.
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(target) && !path.isAbsolute(target)) target = `https://${target}`;
  if (/^https?:/i.test(target)) new URL(target); // throws on a malformed URL
  return { name, target };
}

/** Old configs had { apps: { name: target } }; convert once to the list format. */
function fromConfig(config) {
  if (Array.isArray(config.shortcuts)) {
    return config.shortcuts.filter((s) => s && s.id && s.name && s.target);
  }
  return Object.entries(config.apps ?? {}).map(([name, target]) => ({ id: newId(), name, target }));
}

// ---------- Icon resolution ----------

async function exeFromProtocol(scheme) {
  if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) return null;
  try {
    const { stdout } = await run('reg.exe', ['query', `HKCR\\${scheme}\\shell\\open\\command`, '/ve'], { windowsHide: true });
    const value = stdout.split(/REG_(?:EXPAND_)?SZ/)[1]?.trim() ?? '';
    const exe = value.match(/^"([^"]+)"/)?.[1] ?? value.match(/^(\S+\.exe)/i)?.[1];
    return exe && fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

async function exeFromCommand(command) {
  try {
    const { stdout } = await run('where.exe', [command.split(' ')[0]], { windowsHide: true });
    // `where` also lists extensionless shell scripts (VS Code's bin\code); prefer runnable files.
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const found = lines.find((l) => /\.(exe|com|cmd|bat)$/i.test(l)) ?? lines[0];
    if (!found) return null;
    // Launchers like VS Code's bin\code.cmd: the real exe sits one folder up.
    if (/\.(cmd|bat)$/i.test(found)) {
      const base = path.basename(found).replace(/\.(cmd|bat)$/i, '').toLowerCase();
      const parent = path.dirname(path.dirname(found));
      const exe = fs.readdirSync(parent).find((f) => f.toLowerCase() === `${base}.exe`);
      if (exe) return path.join(parent, exe);
    }
    return found;
  } catch {
    return null;
  }
}

/** A .lnk's own icon is the generic "shortcut file" one: use its icon source or target instead. */
function resolveLnk(file) {
  try {
    const link = shell.readShortcutLink(file);
    const icon = link.icon && /\.(exe|ico|dll)$/i.test(link.icon) && !/\.dll$/i.test(link.icon) ? link.icon : null;
    return [icon, link.target].find((p) => p && fs.existsSync(p)) ?? file;
  } catch {
    return file;
  }
}

async function fileForTarget(target) {
  if (/^shell:/i.test(target)) return null;
  if (path.isAbsolute(target)) {
    if (!fs.existsSync(target)) return null;
    return /\.lnk$/i.test(target) ? resolveLnk(target) : target;
  }
  const scheme = target.match(/^([a-z][a-z0-9+.-]+):/i)?.[1];
  if (scheme) return exeFromProtocol(scheme);
  return exeFromCommand(target);
}

async function computeIcon(target) {
  if (/^https?:\/\//i.test(target)) {
    const host = new URL(target).hostname;
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${res.headers.get('content-type') || 'image/png'};base64,${buf.toString('base64')}`;
  }
  const file = await fileForTarget(target);
  if (!file) return null;
  const img = await app.getFileIcon(file, { size: 'large' });
  return img.isEmpty() ? null : img.toDataURL();
}

/** Icon as data URL, or null (renderer shows the first letter). Failures are not cached. */
async function iconFor(target) {
  if (iconCache[target]) return iconCache[target];
  let icon = null;
  try {
    icon = await computeIcon(target);
  } catch {
    icon = null;
  }
  if (icon) {
    iconCache[target] = icon;
    saveIconCache();
  }
  return icon;
}

const ownIcons = (list) => Promise.all(list.map(async (s) => ({ ...s, icon: await iconFor(s.target) })));
const normalizeName = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * Icons for the user's shortcuts. When a target has no icon of its own
 * (e.g. "spotify:" pointing at the Store app), borrow the icon of the
 * installed app with a matching name.
 */
async function withIcons(list, onLateIcons) {
  const out = await ownIcons(list);
  if (out.every((s) => s.icon)) return out;
  // Scanning the Start menu is slow the first time: answer now, call back when ready.
  if (!installedCache) {
    listInstalled().then(onLateIcons, () => {});
    return out;
  }
  const installed = installedCache;
  await Promise.all(
    out
      .filter((s) => !s.icon)
      .map(async (s) => {
        const name = normalizeName(s.name);
        const match =
          installed.find((a) => normalizeName(a.name) === name) ??
          installed.find((a) => normalizeName(a.name).includes(name));
        if (match) s.icon = await iconFor(match.target);
      }),
  );
  return out;
}

// ---------- Installed apps (Start menu) ----------

function walkLnk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkLnk(full, out);
    else if (/\.lnk$/i.test(e.name)) out.push({ name: e.name.replace(/\.lnk$/i, ''), target: full });
  }
}

/*
 * Store (UWP) apps are not .lnk files: Get-StartApps lists them by AUMID and
 * the logo comes from the package manifest (largest PNG variant of Square44x44Logo).
 */
const STORE_APPS_SCRIPT = String.raw`
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$pkgs = @{}
Get-AppxPackage | ForEach-Object { $pkgs[$_.PackageFamilyName] = $_ }
Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ForEach-Object {
  $family, $appId = $_.AppID -split '!', 2
  $logo = $null
  $pkg = $pkgs[$family]
  if ($pkg) {
    try {
      $manifest = [xml](Get-Content (Join-Path $pkg.InstallLocation 'AppxManifest.xml') -Raw)
      $app = @($manifest.Package.Applications.Application) | Where-Object { $_.Id -eq $appId } | Select-Object -First 1
      $rel = $app.VisualElements.Square44x44Logo
      if ($rel) {
        $dir = Join-Path $pkg.InstallLocation (Split-Path $rel)
        $base = [IO.Path]::GetFileNameWithoutExtension($rel)
        $logo = Get-ChildItem $dir -Filter "$base*.png" -ErrorAction Stop |
          Where-Object { $_.Name -notmatch 'contrast|lightunplated' } |
          Sort-Object { if ($_.Name -match 'targetsize-(\d+)') { [int]$matches[1] } elseif ($_.Name -match 'scale-(\d+)') { 0.44 * [int]$matches[1] } else { 44 } } -Descending |
          Select-Object -First 1 -ExpandProperty FullName
      }
    } catch { }
  }
  [pscustomobject]@{ Name = $_.Name; AppID = $_.AppID; Logo = $logo }
} | ConvertTo-Json -Compress
`;

function pngDataUrl(file) {
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

async function storeApps() {
  try {
    const encoded = Buffer.from(STORE_APPS_SCRIPT, 'utf16le').toString('base64');
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout || '[]');
    return (Array.isArray(parsed) ? parsed : [parsed]).map((a) => {
      const target = `shell:AppsFolder\\${a.AppID}`;
      const icon = a.Logo ? pngDataUrl(a.Logo) : null;
      if (icon && !iconCache[target]) {
        iconCache[target] = icon;
        saveIconCache();
      }
      return { name: a.Name, target };
    });
  } catch {
    return [];
  }
}

/** Installed apps with icons. One shared scan; started at boot so the dialog opens fast. */
function listInstalled() {
  installedPromise ??= scanInstalled().then(
    (list) => (installedCache = list),
    (err) => {
      installedPromise = null;
      throw err;
    },
  );
  return installedPromise;
}

async function scanInstalled() {
  const lnks = [];
  walkLnk(path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), lnks);
  walkLnk(path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), lnks);

  const seen = new Set();
  const unique = [];
  for (const item of [...lnks, ...(await storeApps())]) {
    const key = item.name.toLowerCase();
    if (!item.name || seen.has(key) || IGNORED_START_MENU.test(item.name)) continue;
    seen.add(key);
    unique.push(item);
  }
  unique.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  // No icons here: extracting ~200 of them takes tens of seconds. The dialog
  // asks for each icon (iconFor) as its row scrolls into view.
  return unique;
}

module.exports = { init, validate, fromConfig, newId, withIcons, iconFor, listInstalled };
