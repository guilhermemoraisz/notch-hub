# AGENTS.md

Guidelines for AI agents and contributors working on Notch Hub.

## Project

- Electron app for Windows 10/11 (`electron` pinned in `package.json`). Plain HTML/CSS/JS, no framework, no build step.
- Native features run as PowerShell helpers with inline C# (`src/*.ps1`). Do not add native Node modules or extra runtimes.
- Layout:
  - `main.js`: main process. It handles window states, hover/reveal, alerts and IPC.
  - `preload.js`: the only bridge to the renderer (`contextIsolation` on). Every new IPC channel goes here.
  - `renderer/`: UI (`index.html`, `renderer.js`, `styles.css`).
  - `src/`: main-process modules (Google, alerts, config, media, shortcuts, edge watcher).
  - `scripts/`: dev tools (icon, shortcuts).

## Rules

- **Always review `README.md` after any change.** Update features, configuration keys, the "How it works" file map, and limitations to match the code. A change is not done until the README is accurate.
- New config keys:
  - Add them to `DEFAULTS` in `src/config.js` and to `config.example.json`.
  - Migrate legacy keys in `loadConfig`.
  - Validate and clamp values from the renderer in `main.js` (`settings:set`). Never trust renderer input.
- UI text is Brazilian Portuguese. Code, comments, commits and docs are English.
- Keep comments short. They explain *why*, not *what*.
- Do not add debug logging or debug env flags.

## Security and privacy

- Never commit `google-client.json` (OAuth client secret) or `config.json` (personal data). Both are git-ignored.
- The Google token is stored encrypted with `safeStorage` in the user data folder, never in the project.
- Only request the `calendar.readonly` scope.
- Do not put personal data (names, emails, local paths) in code, docs or commits.

## Behavior notes

- Hide the notch through opacity and click-through, never `hide()`/`show()`, to avoid Windows window animations.
- The window bounds clip outer shadows. Use `inset` box-shadows for effects on the notch.
- Fullscreen apps never show the notch, except through the global hotkey and calendar alerts (when `alerts.overFullscreen` is on). Alerts never take keyboard focus.

## Testing

- Run with `npm start` (or `npm run start:open`).
- After every change, restart the app for the user: kill the running Electron instance of this project, then start it again in the background with `npm start`.
- Prefer in-app checks (`webContents.capturePage`, `executeJavaScript`) over moving the real mouse or keyboard. Revert any temporary test patch.

## Git

- Conventional Commits in English: `type(scope): message`, imperative and lowercase, with no trailing period.
- Commit and push only when asked.
