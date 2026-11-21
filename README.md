# Notch Hub

A macOS-style "notch" for Windows. A small pill sits at the top center of the screen; hover it (or push the mouse up against the top edge) and it expands into a dashboard with your Google Calendar, every media player that is currently playing, and your favorite shortcuts.

Built with Electron and plain HTML/CSS/JS. It needs no paid services and has no build step.

## Features

- **Notch behavior**
  - On the desktop, or when no window is maximized, a pill shows the time and a "playing" dot. Hover it to expand.
  - When a maximized app is in front, the notch is hidden. Push the mouse up against the top edge, over the notch position, to reveal it.
  - Fullscreen games and videos never show the notch, except through the global hotkey and calendar alerts (when enabled).
  - A configurable global hotkey (default `Ctrl+Alt+Space`) toggles the notch anywhere.
- **Google Calendar (read-only)**: a day view with an hour grid, a "now" line, overlapping events side by side and all-day events. Click an event to open it in the browser, in the right Google account.
- **Calendar alerts**: the notch grows to show the event.
  - **Notification** (a Google popup reminder): a wide pill with the event color, title, start time and how long until it starts.
  - **Event start**: a larger card with the title, time range and Meet link.
  - By default each alert stays until you hover it and move away. Either one can instead close after a set time; hovering pauses that time. While an alert waits, its "em 10 min" or "começou há 5 min" label keeps updating.
  - Hovering an alert shows actions: join the Meet, open the event, or snooze a notification for 5 minutes. Clicking it opens the full panel. A hover only counts after the alert has been up for a moment, so a cursor passing by does not dismiss it.
  - Alerts show over fullscreen apps without taking keyboard focus (optional). During Windows Do Not Disturb you choose what shows: everything, only event starts, or nothing.
  - On arrival the notch glows once in the event color (optional). After an alert, the pill keeps a small countdown (optional): "Daily em 9 min" until a notified event starts, and "termina 15:00" while an event is on, also after a restart.
  - One alert shows at a time. A newer notification replaces an older one, and an event start replaces a notification. A notification that arrives during an event start waits until that one is dismissed. Events are checked every minute, so new events also trigger alerts. All-day events are ignored.
- **Media**: one card per player that Windows sees, such as Spotify or each browser tab with audio or video. Each card shows the cover art, title and artist, has its own play/pause/next/previous buttons, and the play/pause button reflects the real state. Click a card to bring that player (and the right browser tab) to the front.
- **Shortcuts**: a grid with real app icons and site favicons. Add from installed apps (Start menu and Microsoft Store), any file or `.exe`, or a URL. Edit and remove from the UI.
- **My PC**: CPU, memory and uptime.
- **Settings**: accent color, global hotkey, start with Windows, calendar alerts, and the Google account.

## Requirements

- Windows 10 or 11
- Node.js 18+
- Windows PowerShell 5.1 (comes with Windows). The native helpers are C# compiled on the fly by PowerShell, so nothing else needs to be installed.

## Getting started

```bash
git clone https://github.com/guilhermemoraisz/notch-hub.git
cd notch-hub
npm install
npm start          # or: npm run start:open  (starts expanded)
```

### Desktop and Start menu shortcuts

```bash
npm run icon        # (re)generates assets/icon.ico from the robot face
npm run shortcuts   # creates "Notch Hub" on the Desktop and in the Start menu
```

To use another eye color, run `powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1 -EyeColor '#4cc9f0'`. To delete the shortcuts, run `scripts/install-shortcuts.ps1 -Remove`. If you move the project folder, run `npm run shortcuts` again.

On the first run the app copies its defaults from `config.example.json`. Your changes are saved to `config.json`, which is git-ignored.

### Google Calendar (optional)

1. In the [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google Calendar API**.
2. In **Google Auth Platform**, fill in **Branding**. Then, in **Audience**, choose **External** and click **Publish app**. In "Testing" mode the login expires every 7 days.
3. Go to **Clients > Create client** and pick the **Desktop app** type. Download the JSON.
4. Save it in the project root as `google-client.json`. See `google-client.example.json` for the expected shape.
5. Open the notch and click **Conectar Google Agenda**. The UI is in Brazilian Portuguese.

On the first login Google shows "Google hasn't verified this app". Click **Advanced > Go to …**. This is expected for a personal, unverified app.

The app uses OAuth 2.0 for installed apps with PKCE and a loopback redirect (`127.0.0.1`), and only requests the `calendar.readonly` scope. The refresh token is stored encrypted with Electron `safeStorage` (Windows DPAPI) in the app's user data folder, never in the project.

## Configuration

`config.json` (created from `config.example.json`):

| Key | Description |
|---|---|
| `assistantName`, `userName` | Name shown in the top bar and greeting |
| `hotkey` | Global shortcut, in [Electron accelerator](https://www.electronjs.org/docs/latest/api/accelerator) format. Also editable in Settings. |
| `accentColor` | Hex color used across the UI. Also editable in Settings. |
| `startWithWindows` | Launch at login. Also editable in Settings. |
| `hideOutsideDesktop` | Hide the notch while a maximized window is in front |
| `revealPush` | How hard to push the mouse up to reveal it, in raw mouse counts. Higher means a stronger push. |
| `alerts.reminderEnabled` | Show an alert on Google popup notifications. Default `true`. |
| `alerts.reminderDismiss` | `"hover"`: a notification stays until you hover it and move away. `"timer"`: it closes after `reminderSeconds`. Default `"hover"`. |
| `alerts.reminderSeconds` | How long a notification stays with `"timer"`, in seconds (3–60). Default `8`. |
| `alerts.startEnabled` | Show an alert when an event starts. Default `true`. |
| `alerts.startDismiss` | `"hover"`: the start alert stays until you hover it and move away. `"timer"`: it closes after `startSeconds`. Default `"hover"`. |
| `alerts.startSeconds` | How long the start alert stays with `"timer"`, in seconds (3–60). Default `10`. |
| `alerts.overFullscreen` | Show alerts over fullscreen apps. Default `true`. |
| `alerts.dnd` | What shows during Windows Do Not Disturb: `"all"`, `"start"` (only event starts) or `"none"`. Default `"start"`. |
| `alerts.pulse` | Glow once in the event color when an alert opens. Default `true`. |
| `alerts.countdown` | Show a countdown in the pill: after a notification, until the event starts; while an event is on, until it ends. Default `true`. |

Older `alerts.reminderBlinks` and `alerts.startLeadMinutes` keys are ignored and dropped on the next save.
| `shortcuts` | Managed by the Shortcuts page. A legacy `apps` map is migrated automatically. |

## How it works

```
main.js                  Electron main: window states, hover/reveal logic, IPC
preload.js               Safe bridge exposed to the renderer (contextIsolation)
renderer/                UI (vanilla JS, no framework)
src/edge-watcher.ps1     Raw mouse input (detects the push past the top edge)
                         + foreground window classification (desktop/app/fullscreen)
                         + Windows Do Not Disturb state
src/media-watcher.ps1    Windows media sessions (SMTC): list, control, focus tab
src/google.js            OAuth (PKCE + loopback) and Calendar API
src/alerts.js            Calendar alert scheduler (popup reminders, event start)
src/shortcuts.js         Shortcuts, icon resolution, installed apps scan
src/actions.js           Launching targets, media keys, system info
```

- **Push to reveal.** The cursor cannot go past the top of the screen, so the edge helper reads **raw input** (`WM_INPUT`). Raw input still reports upward movement while the cursor is stuck at `y = 0`. Only mostly vertical motion counts, so sliding along the edge toward browser tabs does not open the notch.
- **Hiding without flicker.** When hidden, the window is never `hide()`/`show()`n, because that triggers Windows' own window animation. Instead it becomes fully transparent and click-through.
- **Calendar alerts.** The main process polls upcoming events every minute and checks every 5 seconds for a due alert. Reminder times come from each event's popup reminders, or the calendar's default reminders. Each alert fires once, at the reminder time or at the event start.
- **Alert window.** While an alert is up, the window takes the size of the largest alert shape and is click-through, except over the visible notch (`setIgnoreMouseEvents` with `forward`, driven by the renderer's hover events). Clicks around the alert reach the apps below. It never calls `focus()`, so a fullscreen game or video keeps keyboard focus. When dismissed, the alert shrinks straight into the countdown pill, and only then is the window resized.
- **Media.** The media helper uses `GlobalSystemMediaTransportControlsSessionManager` through PowerShell's WinRT projection. Commands come in over a named pipe. To bring a browser tab to the front, it finds the tab with UI Automation.

## Limitations

- Games in **exclusive** fullscreen cannot be overlaid by any window, so alerts do not show there either. Borderless fullscreen works.
- Windows has no public API for Do Not Disturb. The edge helper reads an undocumented system state (`WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED`), which a Windows update could change. If it cannot be read, alerts behave as if Do Not Disturb were off.
- Browser media sessions are reported per browser, as Windows exposes them. Two tabs playing at once may share a card.
- Site favicons are fetched through Google's favicon service (`s2/favicons`).
