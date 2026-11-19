# Native helper for Notch Hub. Writes one event per line to stdout:
#   push <dy> <dx>   raw upward mouse movement while the cursor sits on the
#                    top edge of a monitor (dy > 0 means "pushing up")
#   fg desktop|app|fullscreen   the foreground window changed (fullscreen = game/video covering the monitor)
#   error <message>
# Exits on its own when the owner (Electron) process is gone.
param([Parameter(Mandatory = $true)][int]$OwnerPid)

$ErrorActionPreference = 'Stop'

Add-Type -ReferencedAssemblies System.Windows.Forms -WarningAction SilentlyContinue -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace NotchHub {
  public class EdgeWatcher : NativeWindow {
    const int WM_INPUT = 0x00FF;
    const uint RIDEV_INPUTSINK = 0x00000100;
    const uint RID_INPUT = 0x10000003;
    const uint RIM_TYPEMOUSE = 0;
    const ushort MOUSE_MOVE_ABSOLUTE = 1;
    const uint MONITOR_DEFAULTTONEAREST = 2;
    const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
    const uint WINEVENT_OUTOFCONTEXT = 0;

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTDEVICE { public ushort usUsagePage; public ushort usUsage; public uint dwFlags; public IntPtr hwndTarget; }

    [StructLayout(LayoutKind.Sequential)]
    struct RAWINPUTHEADER { public uint dwType; public uint dwSize; public IntPtr hDevice; public IntPtr wParam; }

    // USHORT usFlags; (2 bytes padding: the union below is 4-byte aligned)
    [StructLayout(LayoutKind.Sequential)]
    struct RAWMOUSE {
      public ushort usFlags; public ushort padding;
      public ushort usButtonFlags; public ushort usButtonData;
      public uint ulRawButtons; public int lLastX; public int lLastY; public uint ulExtraInformation;
    }

    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);

    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr hRawInput, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr hmod, WinEventProc proc, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

    // QUNS_BUSY (fullscreen app), QUNS_RUNNING_D3D_FULL_SCREEN (exclusive game), QUNS_PRESENTATION_MODE
    static bool ShellSaysFullscreen() {
      int s;
      return SHQueryUserNotificationState(out s) == 0 && (s == 2 || s == 3 || s == 4);
    }

    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);

    // Borderless fullscreen: window covers its whole monitor. Maximized windows
    // are excluded (with an auto-hide taskbar they cover the monitor too).
    static bool CoversMonitor(IntPtr hwnd) {
      RECT r;
      if (IsZoomed(hwnd) || !GetWindowRect(hwnd, out r)) return false;
      var info = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
      if (!GetMonitorInfo(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ref info)) return false;
      var m = info.rcMonitor;
      return r.Left <= m.Left && r.Top <= m.Top && r.Right >= m.Right && r.Bottom >= m.Bottom;
    }

    static readonly string[] DesktopClasses = { "Progman", "WorkerW" };
    // Shell surfaces that briefly take focus; they do not mean "left the desktop".
    static readonly string[] ShellClasses = {
      "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "XamlExplorerHostIslandWindow", "MultitaskingViewFrame",
      "ForegroundStaging", "Windows.UI.Core.CoreWindow", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland"
    };

    readonly uint ownerPid;
    readonly WinEventProc winEventProc; // field keeps the delegate alive (GC)
    readonly Timer timer = new Timer();
    readonly uint headerSize = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
    string state = "";

    public EdgeWatcher(uint ownerPid) {
      this.ownerPid = ownerPid;
      CreateHandle(new CreateParams());

      var devices = new[] { new RAWINPUTDEVICE { usUsagePage = 1, usUsage = 2, dwFlags = RIDEV_INPUTSINK, hwndTarget = Handle } };
      if (!RegisterRawInputDevices(devices, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE))))
        Emit("error RegisterRawInputDevices " + Marshal.GetLastWin32Error());

      winEventProc = (h, e, hwnd, o, c, t, ms) => ReportForeground();
      SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, winEventProc, 0, 0, WINEVENT_OUTOFCONTEXT);

      // Polling catches cases without a foreground event (e.g. last window minimized).
      timer.Interval = 500;
      timer.Tick += (s, e) => { ExitIfOwnerGone(); ReportForeground(); };
      timer.Start();
      ReportForeground();
    }

    static void Emit(string line) {
      Console.Out.WriteLine(line);
      Console.Out.Flush();
    }

    void ExitIfOwnerGone() {
      try {
        if (!Process.GetProcessById((int)ownerPid).HasExited) return;
      } catch (ArgumentException) { }
      Application.Exit();
    }

    static string ClassOf(IntPtr hwnd) {
      var sb = new StringBuilder(256);
      GetClassName(hwnd, sb, sb.Capacity);
      return sb.ToString();
    }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
    const uint MONITOR_DEFAULTTOPRIMARY = 1;
    const int DWMWA_CLOAKED = 14;

    // Cloaked = "visible" but not on screen (suspended UWP apps, other virtual desktops).
    static bool IsCloaked(IntPtr hwnd) {
      int value;
      return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out value, 4) == 0 && value != 0;
    }

    bool AnyMaximizedOnPrimary() {
      IntPtr primary = MonitorFromPoint(new POINT(), MONITOR_DEFAULTTOPRIMARY);
      bool found = false;
      EnumWindows((h, l) => {
        if (!IsWindowVisible(h) || IsIconic(h) || !IsZoomed(h) || IsCloaked(h)) return true;
        if (MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST) != primary) return true;
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid == ownerPid) return true;
        found = true;
        return false;
      }, IntPtr.Zero);
      return found;
    }

    // "fullscreen": an app covers the monitor (game/video). "app": some window is
    // maximized on the primary monitor. "desktop": otherwise. null = keep state.
    // Screen-capture overlays (PrintScreen) cover the monitor but are not fullscreen apps.
    static readonly string[] OverlayProcesses = { "SnippingTool", "ScreenClippingHost", "ScreenSketch" };

    static string ProcessName(uint pid) {
      try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }

    string Classify(IntPtr fg) {
      if (fg != IntPtr.Zero) {
        uint pid;
        GetWindowThreadProcessId(fg, out pid);
        // Our own window (notch focused) or a capture overlay: judge by the windows
        // on screen instead of keeping the old state, so "fullscreen" never sticks.
        bool ignoreFg = pid == ownerPid || Array.IndexOf(OverlayProcesses, ProcessName(pid)) >= 0;
        if (!ignoreFg) {
          string cls = ClassOf(fg);
          bool shell = Array.IndexOf(DesktopClasses, cls) >= 0 || Array.IndexOf(ShellClasses, cls) >= 0;
          if (!shell && !IsIconic(fg) && (ShellSaysFullscreen() || CoversMonitor(fg))) return "fullscreen";
        }
      }
      return AnyMaximizedOnPrimary() ? "app" : "desktop";
    }

    void ReportForeground() {
      string next = Classify(GetForegroundWindow());
      if (next == null || next == state) return;
      state = next;
      Emit("fg " + state);
    }

    protected override void WndProc(ref Message m) {
      if (m.Msg == WM_INPUT) HandleRawInput(m.LParam);
      base.WndProc(ref m);
    }

    void HandleRawInput(IntPtr hRawInput) {
      uint size = 0;
      GetRawInputData(hRawInput, RID_INPUT, IntPtr.Zero, ref size, headerSize);
      if (size == 0) return;
      IntPtr buffer = Marshal.AllocHGlobal((int)size);
      try {
        if (GetRawInputData(hRawInput, RID_INPUT, buffer, ref size, headerSize) != size) return;
        var header = (RAWINPUTHEADER)Marshal.PtrToStructure(buffer, typeof(RAWINPUTHEADER));
        if (header.dwType != RIM_TYPEMOUSE) return;
        var mouse = (RAWMOUSE)Marshal.PtrToStructure(IntPtr.Add(buffer, (int)headerSize), typeof(RAWMOUSE));
        if ((mouse.usFlags & MOUSE_MOVE_ABSOLUTE) != 0 || mouse.lLastY >= 0) return;

        POINT p;
        if (!GetCursorPos(out p)) return;
        var info = new MONITORINFO { cbSize = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (!GetMonitorInfo(MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST), ref info)) return;
        if (p.Y > info.rcMonitor.Top) return; // only while stuck on the top edge

        Emit("push " + (-mouse.lLastY) + " " + Math.Abs(mouse.lLastX));
      } finally {
        Marshal.FreeHGlobal(buffer);
      }
    }
  }
}
'@

try {
  $watcher = New-Object NotchHub.EdgeWatcher ([uint32]$OwnerPid)
  [System.Windows.Forms.Application]::Run()
} catch {
  [Console]::Out.WriteLine("error $($_.Exception.Message)")
  exit 1
}
