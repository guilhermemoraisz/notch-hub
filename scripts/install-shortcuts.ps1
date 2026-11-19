# Creates "Notch Hub" shortcuts on the Desktop and in the Start menu.
# They run the project's Electron with this folder as the app, using assets/icon.ico.
# Re-run after moving the project folder. Use -Remove to delete them.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/install-shortcuts.ps1 [-Remove]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'assets\icon.ico'

$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Notch Hub.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Notch Hub.lnk')
)

if ($Remove) {
  foreach ($lnk in $targets) { Remove-Item $lnk -ErrorAction SilentlyContinue; "Removed $lnk" }
  return
}

if (-not (Test-Path $electron)) { throw "Electron not found. Run 'npm install' first." }
if (-not (Test-Path $icon)) { throw "Icon not found. Run 'npm run icon' first." }

$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in $targets) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $electron
  $s.Arguments = '"' + $root + '"'
  $s.WorkingDirectory = $root
  $s.IconLocation = "$icon,0"
  $s.Description = 'Notch Hub'
  $s.Save()
  "Created $lnk"
}
