const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// PowerShell cannot read files inside an asar archive.
const SCRIPT = path.join(__dirname, 'edge-watcher.ps1').replace('app.asar', 'app.asar.unpacked');

/**
 * Starts the native edge watcher (see edge-watcher.ps1).
 * Callbacks:
 *   onPush(dy, dx)        raw upward movement while the cursor is on a top edge
 *   onForeground(kind)    'desktop' | 'app' | 'fullscreen'
 *   onExit(error)         helper died; caller should fall back to always-visible
 * Returns a function that stops the helper.
 */
function startEdgeWatcher({ onPush, onForeground, onExit }) {
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-OwnerPid', String(process.pid)],
    { windowsHide: true },
  );

  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    const [kind, a, b] = line.trim().split(' ');
    if (kind === 'push') onPush(Number(a), Number(b));
    else if (kind === 'fg') onForeground(a);
    else if (kind === 'error') console.error(`[edge] ${line}`);
  });

  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));

  let stopped = false;
  proc.on('error', (err) => onExit(err));
  proc.on('exit', (code) => {
    if (!stopped) onExit(new Error(`edge watcher saiu (código ${code}) ${stderr.trim().slice(0, 500)}`));
  });

  return () => {
    stopped = true;
    if (proc.exitCode === null) proc.kill();
  };
}

module.exports = { startEdgeWatcher };
