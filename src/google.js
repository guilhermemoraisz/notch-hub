const { shell, safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

/*
 * Google Calendar access for a desktop app:
 * OAuth 2.0 "installed app" flow with PKCE and a loopback redirect
 * (http://127.0.0.1:<random port>). The refresh token is stored encrypted
 * with Electron safeStorage (Windows DPAPI, tied to the Windows user).
 */

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'];
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

// Google's fixed palette for events with a custom color (colorId).
const EVENT_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};

let clientFile = null;
let tokenFile = null;
let token = null;
let loginInProgress = null;
let cancelPendingLogin = null;

/** Call once after app 'ready' (safeStorage needs it). */
function init({ appDir, userDataDir }) {
  clientFile = path.join(appDir, 'google-client.json');
  tokenFile = path.join(userDataDir, 'google-token.bin');
  token = readToken();
}

/** Reads the OAuth client downloaded from Google Cloud Console. */
function readClient() {
  let raw;
  try {
    // Full-line // comments are allowed (google-client.example.json ships with them).
    raw = JSON.parse(fs.readFileSync(clientFile, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`google-client.json inválido: ${err.message}`);
  }
  const c = raw.installed ?? raw.web ?? raw;
  if (!c.client_id || !c.client_secret) throw new Error('google-client.json sem client_id/client_secret');
  return { id: c.client_id, secret: c.client_secret };
}

function readToken() {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenFile)));
  } catch {
    return null;
  }
}

function writeToken(next) {
  token = next;
  if (!next) {
    fs.rmSync(tokenFile, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, safeStorage.encryptString(JSON.stringify(next)));
}

function status() {
  let configured = false;
  let error = null;
  try {
    configured = Boolean(readClient());
  } catch (err) {
    error = err.message;
  }
  return {
    configured,
    connected: Boolean(token?.refresh_token),
    loggingIn: Boolean(loginInProgress),
    email: token?.email ?? null,
    error,
  };
}

const notConnected = () => Object.assign(new Error('Google Agenda desconectada'), { code: 'NOT_CONNECTED' });
const b64url = (buf) => buf.toString('base64url');

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error_description || data.error || `HTTP ${res.status}`), { code: data.error });
  }
  return data;
}

function emailFromIdToken(idToken) {
  // Received straight from Google's token endpoint over TLS, so decoding is enough.
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).email ?? null;
  } catch {
    return null;
  }
}

const resultPage = (message) => `<!doctype html><meta charset="utf-8"><title>Notch Hub</title>
<body style="font-family:Segoe UI,sans-serif;background:#0b0c0d;color:#e8eaed;display:grid;place-items:center;height:100vh;margin:0">
<p style="font-size:18px">${message}</p></body>`;

/** Local HTTP server that receives Google's redirect with the auth code. */
function waitForRedirect(expectedState, openBrowser) {
  return new Promise((resolve, reject) => {
    let redirectUri = null;
    let done = false;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/' || done) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const ok = Boolean(code) && url.searchParams.get('state') === expectedState;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(resultPage(ok ? 'Agenda conectada! Pode fechar esta aba.' : 'Não foi possível conectar. Feche esta aba e tente de novo.'));
      if (ok) finish(null, code);
      else finish(new Error(error === 'access_denied' ? 'Login cancelado' : `Falha no login: ${error ?? 'state inválido'}`));
    });

    const timer = setTimeout(() => finish(new Error('Tempo de login esgotado')), LOGIN_TIMEOUT_MS);
    // If Google shows an error page it never redirects back, so the user must be able to give up.
    cancelPendingLogin = () => finish(new Error('Login cancelado'));

    function finish(err, code) {
      if (done) return;
      done = true;
      cancelPendingLogin = null;
      clearTimeout(timer);
      server.close();
      if (err) reject(err);
      else resolve({ code, redirectUri });
    }

    server.on('error', (err) => finish(err));
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      openBrowser(redirectUri);
    });
  });
}

async function doLogin() {
  const client = readClient();
  if (!client) throw new Error('Falta o arquivo google-client.json na pasta do app');

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const { code, redirectUri } = await waitForRedirect(state, (redirect) => {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: client.id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    shell.openExternal(url.href);
  });

  const data = await tokenRequest({
    code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (!data.refresh_token) throw new Error('O Google não devolveu refresh token');
  writeToken({
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
    email: emailFromIdToken(data.id_token),
  });
  return status();
}

/** Opens the browser for Google login; concurrent calls share one attempt. */
function login() {
  loginInProgress ??= doLogin().finally(() => {
    loginInProgress = null;
  });
  return loginInProgress;
}

async function logout() {
  const refresh = token?.refresh_token;
  writeToken(null);
  if (refresh) {
    // Best effort: also revoke on Google's side.
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refresh }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => {});
  }
  return status();
}

async function accessToken() {
  if (!token?.refresh_token) throw notConnected();
  if (token.access_token && Date.now() < token.expires_at) return token.access_token;
  const client = readClient();
  if (!client) throw new Error('Falta o arquivo google-client.json na pasta do app');
  try {
    const data = await tokenRequest({
      client_id: client.id,
      client_secret: client.secret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    });
    writeToken({ ...token, access_token: data.access_token, expires_at: Date.now() + (data.expires_in - 60) * 1000 });
    return token.access_token;
  } catch (err) {
    // Revoked or expired (apps in "Testing" mode expire after 7 days).
    if (err.code === 'invalid_grant') {
      writeToken(null);
      throw notConnected();
    }
    throw err;
  }
}

async function api(pathname, params = {}) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/${pathname}`);
  url.search = new URLSearchParams(params);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data;
}

/** Minutes before start of each popup notification (the event's own, or the calendar default). */
function popupMinutes(event, calendar) {
  const reminders = event.reminders ?? { useDefault: true };
  const list = reminders.useDefault ? calendar.defaultReminders ?? [] : reminders.overrides ?? [];
  return list.filter((r) => r.method === 'popup').map((r) => r.minutes);
}

/** Events between two ISO instants, from every calendar checked in Google Agenda. */
async function listEvents(timeMin, timeMax) {
  const { items: calendars = [] } = await api('users/me/calendarList', { minAccessRole: 'reader' });
  const perCalendar = await Promise.all(
    calendars
      .filter((cal) => cal.selected)
      .map(async (cal) => {
        const { items = [] } = await api(`calendars/${encodeURIComponent(cal.id)}/events`, {
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100',
        });
        return items
          .filter((e) => e.status !== 'cancelled')
          .map((e) => ({
            id: `${cal.id}:${e.id}`,
            title: e.summary || '(Sem título)',
            start: e.start.dateTime ?? e.start.date,
            end: e.end.dateTime ?? e.end.date,
            allDay: !e.start.dateTime,
            color: EVENT_COLORS[e.colorId] ?? cal.backgroundColor ?? '#039be5',
            link: e.htmlLink,
            meet: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null,
            reminders: popupMinutes(e, cal),
          }));
      }),
  );
  return perCalendar.flat();
}

function cancelLogin() {
  cancelPendingLogin?.();
}

module.exports = { init, status, login, cancelLogin, logout, listEvents };
