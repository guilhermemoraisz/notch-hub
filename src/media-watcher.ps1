# Media helper for Notch Hub, built on Windows' System Media Transport Controls
# (the same API behind the volume flyout). Every player that publishes media
# (Spotify, each browser tab with audio/video, ...) is one session.
#
# stdout:     one JSON line {"sessions":[...]} whenever something changes.
# named pipe: "<toggle|next|prev|focus> <key>" lines control one session
#             (focus = bring its window/browser tab to the front).
# Exits when the owner (Electron) process is gone.
param(
  [Parameter(Mandatory = $true)][int]$OwnerPid,
  [Parameter(Mandatory = $true)][string]$PipeName
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Wait-Op($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'timeout' }
  $task.Result
}

$PropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$manager = Wait-Op ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# Cover art as a data: URL. Only successful reads are cached (players often
# publish the cover a moment after the title).
$thumbCache = @{}
# PowerShell 5.1 does not expose members of WinRT streams, so convert to a .NET
# Stream; reflection is needed because overload resolution fails on COM objects.
$InputStreamType = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@($InputStreamType))
function Get-Thumb($ref) {
  if ($null -eq $ref) { return $null }
  $winrtStream = Wait-Op ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $stream = $asStreamForRead.Invoke($null, @($winrtStream))
  $buffer = New-Object IO.MemoryStream
  try {
    $stream.CopyTo($buffer)
  } finally {
    $stream.Dispose()
  }
  $bytes = $buffer.ToArray()
  if ($bytes.Length -lt 4 -or $bytes.Length -gt 2MB) { return $null }
  $type = if ($bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50) { 'image/png' } else { 'image/jpeg' }
  "data:$type;base64," + [Convert]::ToBase64String($bytes)
}

# Sessions have no stable id; app id + position is good enough between polls.
function Get-SessionList {
  $list = New-Object System.Collections.ArrayList
  $i = 0
  foreach ($s in $manager.GetSessions()) {
    $key = "$($s.SourceAppUserModelId)#$i"
    $i++
    try {
      $info = $s.GetPlaybackInfo()
      $props = Wait-Op ($s.TryGetMediaPropertiesAsync()) $PropsType
      $thumbKey = "$key|$($props.Title)|$($props.Artist)"
      if (-not $thumbCache.ContainsKey($thumbKey)) {
        if ($thumbCache.Count -gt 40) { $thumbCache.Clear() }
        try { $t = Get-Thumb $props.Thumbnail } catch { $t = $null }
        if ($t) { $thumbCache[$thumbKey] = $t }
      }
      $null = $list.Add([ordered]@{
        key       = $key
        app       = $s.SourceAppUserModelId
        title     = $props.Title
        artist    = $props.Artist
        status    = $info.PlaybackStatus.ToString()
        canPrev   = $info.Controls.IsPreviousEnabled
        canNext   = $info.Controls.IsNextEnabled
        canToggle = $info.Controls.IsPlayPauseToggleEnabled
        thumb     = $thumbCache[$thumbKey]
      })
    } catch { }
  }
  , $list
}

# ---------- "focus": bring the player (and its browser tab) to the front ----------

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace NotchHub {
  public static class Win {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    // Windows blocks SetForegroundWindow from background processes; sharing the
    // input queue with the current foreground thread lifts that restriction.
    public static void Focus(IntPtr h) {
      const int SW_RESTORE = 9;
      if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
      uint me = GetCurrentThreadId();
      uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
      bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
      try {
        BringWindowToTop(h);
        SetForegroundWindow(h);
      } finally {
        if (attached) AttachThreadInput(me, fg, false);
      }
    }
  }
}
'@

function Get-PlayerProcessName([string]$aumid) {
  $id = $aumid.ToLower()
  foreach ($known in 'spotify', 'chrome', 'msedge', 'firefox', 'opera', 'brave', 'vlc', 'discord') {
    if ($id.Contains($known)) { return $known }
  }
  $aumid.Split('!')[-1] -replace '\.exe$', ''
}

function Select-Tab($tab) {
  $pattern = $null
  if ($tab.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { $pattern.Select(); return }
  if ($tab.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
}

function Show-Session($session) {
  $props = Wait-Op ($session.TryGetMediaPropertiesAsync()) $PropsType
  $title = "$($props.Title)".Trim()
  $needle = if ($title.Length -gt 40) { $title.Substring(0, 40) } else { $title }

  $pids = @(Get-Process -Name (Get-PlayerProcessName $session.SourceAppUserModelId) -ErrorAction SilentlyContinue | ForEach-Object Id)
  if (-not $pids) { return }
  $root = [Windows.Automation.AutomationElement]::RootElement
  $windows = @($root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition) | Where-Object {
      $pids -contains $_.Current.ProcessId -and $_.Current.NativeWindowHandle -ne 0 -and $_.Current.Name
    })
  if (-not $windows) { return }

  if ($needle) {
    # Browser: find the tab whose name contains the media title.
    $tabCondition = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)
    foreach ($w in $windows) {
      foreach ($tab in $w.FindAll([Windows.Automation.TreeScope]::Descendants, $tabCondition)) {
        if ($tab.Current.Name.Contains($needle)) {
          [NotchHub.Win]::Focus([IntPtr]$w.Current.NativeWindowHandle)
          Select-Tab $tab
          return
        }
      }
    }
    # Apps like Spotify put the track in the window title.
    $match = $windows | Where-Object { $_.Current.Name.Contains($needle) } | Select-Object -First 1
    if ($match) { [NotchHub.Win]::Focus([IntPtr]$match.Current.NativeWindowHandle); return }
  }
  [NotchHub.Win]::Focus([IntPtr]$windows[0].Current.NativeWindowHandle)
}

function Invoke-MediaCommand([string]$line) {
  $parts = $line.Trim().Split(' ', 2)
  if ($parts.Count -ne 2) { return }
  $i = 0
  foreach ($s in $manager.GetSessions()) {
    if ("$($s.SourceAppUserModelId)#$i" -eq $parts[1]) {
      if ($parts[0] -eq 'focus') { Show-Session $s; return }
      $op = switch ($parts[0]) {
        'toggle' { $s.TryTogglePlayPauseAsync() }
        'next' { $s.TrySkipNextAsync() }
        'prev' { $s.TrySkipPreviousAsync() }
        default { $null }
      }
      if ($op) { $null = Wait-Op $op ([bool]) }
      return
    }
    $i++
  }
}

$last = ''
$nextPoll = [DateTime]::MinValue
# Commands arrive on a named pipe (stdin is unreliable under powershell.exe:
# lines only show up at EOF). A background thread queues them for the loop.
Add-Type -ReferencedAssemblies System.Core -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Threading;
namespace NotchHub {
  public static class PipeCommands {
    public static readonly ConcurrentQueue<string> Queue = new ConcurrentQueue<string>();
    public static void Start(string name) {
      var t = new Thread(() => {
        while (true) {
          try {
            using (var server = new NamedPipeServerStream(name, PipeDirection.In))
            using (var reader = new StreamReader(server)) {
              server.WaitForConnection();
              string line;
              while ((line = reader.ReadLine()) != null) Queue.Enqueue(line);
            }
          } catch (IOException) { Thread.Sleep(200); }
        }
      });
      t.IsBackground = true;
      t.Start();
    }
  }
}
'@
[NotchHub.PipeCommands]::Start($PipeName)
while ($true) {
  $line = $null
  while ([NotchHub.PipeCommands]::Queue.TryDequeue([ref]$line)) {
    try { Invoke-MediaCommand $line } catch { }
    $nextPoll = [DateTime]::Now.AddMilliseconds(250)
  }
  if (-not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) { break }
  if ([DateTime]::Now -ge $nextPoll) {
    $json = ConvertTo-Json -Compress -Depth 4 @{ sessions = (Get-SessionList) }
    if ($json -ne $last) {
      $last = $json
      [Console]::Out.WriteLine($json)
      [Console]::Out.Flush()
    }
    $nextPoll = [DateTime]::Now.AddMilliseconds(1000)
  }
  Start-Sleep -Milliseconds 100
}
