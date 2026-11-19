const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const readline = require('readline');

// PowerShell cannot read files inside an asar archive.
const SCRIPT = path.join(__dirname, 'media-watcher.ps1').replace('app.asar', 'app.asar.unpacked');
const COMMANDS = new Set(['toggle', 'next', 'prev', 'focus']);

/**
 * Starts the media session watcher (see media-watcher.ps1).
 * onSessions(sessions) fires whenever any player changes.
 * Returns { command(cmd, key), stop() }.
 */
function startMediaWatcher({ onSessions }) {
  const pipeName = `notchhub-media-${process.pid}`;
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
      '-OwnerPid', String(process.pid), '-PipeName', pipeName],
    { windowsHide: true },
  );
  proc.stdout.setEncoding('utf8');

  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    try {
      onSessions(JSON.parse(line).sessions ?? []);
    } catch {
      /* ignore non-JSON noise */
    }
  });

  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  proc.on('exit', (code) => {
    if (code) console.error(`[media] helper saiu (código ${code}) ${stderr.trim().slice(0, 500)}`);
    onSessions([]);
  });

  function command(cmd, key) {
    if (!COMMANDS.has(cmd) || typeof key !== 'string' || /[\r\n]/.test(key)) {
      return Promise.reject(new Error(`Comando de mídia inválido: ${cmd}`));
    }
    return new Promise((resolve, reject) => {
      const socket = net.connect(`\\\\.\\pipe\\${pipeName}`, () => socket.end(`${cmd} ${key}\n`, resolve));
      socket.on('error', reject);
    });
  }

  return {
    command,
    stop: () => {
      if (proc.exitCode === null) proc.kill();
    },
  };
}

module.exports = { startMediaWatcher };
