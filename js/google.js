// One Google sign-in for everything the app does with your Google account:
//   Calendar (read/add events), Gmail (read DBS alert emails), Drive app folder (encrypted sync).
// Calls go straight from this device to Google. The access token lives in memory only, is dropped
// when the app locks, and expires at Google within the hour.

export const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  // drive.appdata = only a hidden folder this app creates in your Drive. It can't see any of your files.
  drive: 'https://www.googleapis.com/auth/drive.appdata',
};

let token = null;
let tokenExpiry = 0;
let granted = new Set();
let gisLoading = null;

// Load Google's sign-in script ahead of a button press, so the sign-in popup isn't blocked.
export function preload() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in (are you offline?)')); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

export const isConnected = () => !!token && Date.now() < tokenExpiry;
export const has = (name) => isConnected() && granted.has(SCOPES[name]);
export const msLeft = () => (token ? tokenExpiry - Date.now() : 0);

// Remembered on this device (not secret, not your data) so the app can reconnect by itself:
//   ct.autoGoogle = you've connected before; ct.googleHint = which Google account to use.
const local = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* ignore */ } },
};
export const autoConnectOn = () => local.get('ct.autoGoogle') === '1';

let pending = null;

/**
 * Signs in to Google. With {silent: true} (you've allowed it before) Google's window opens and closes
 * by itself without asking anything. Browsers only allow that window right after a tap, so call this
 * straight from a tap/submit handler: when Google's script is already loaded, the request is made
 * synchronously, inside the tap.
 */
export function connect(clientId, { silent = false } = {}) {
  if (!clientId) return Promise.reject(new Error('Add your Google OAuth Client ID first (Settings).'));
  if (pending) return pending;
  const run = () => new Promise((resolve, reject) => {
    const hint = local.get('ct.googleHint');
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: [...Object.values(SCOPES), 'email'].join(' '),
      include_granted_scopes: true,
      ...(silent ? { prompt: '' } : {}),
      ...(hint ? { hint } : {}),
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        token = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in) - 60) * 1000;
        granted = new Set(Object.values(SCOPES).filter((sc) => google.accounts.oauth2.hasGrantedAllScopes(resp, sc)));
        local.set('ct.autoGoogle', '1');
        if (!hint) rememberAccount();
        resolve(granted);
      },
      error_callback: (e) => reject(new Error(
        e?.type === 'popup_failed_to_open' ? 'Your browser blocked Google\'s sign-in window. Allow pop-ups for this site, then tap Connect Google.'
          : e?.message || 'Google sign-in was cancelled')),
    });
    client.requestAccessToken();
  });
  pending = (window.google?.accounts?.oauth2 ? run() : preload().then(run)).finally(() => { pending = null; });
  return pending;
}

// Which Google account you used, so reconnecting skips the account picker.
async function rememberAccount() {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) local.set('ct.googleHint', (await res.json()).email || '');
  } catch { /* not important */ }
}

// Drops the token from memory only (used when the app locks).
export function forget() {
  token = null;
  tokenExpiry = 0;
  granted = new Set();
}

// Signs this app out of your Google account completely (you'll see the consent screen again next time).
export function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  forget();
  local.set('ct.autoGoogle', '');
  local.set('ct.googleHint', '');
}

// fetch() with the access token. `what` names the service in error messages.
export async function authFetch(url, opts = {}, what = 'Google') {
  if (!isConnected()) throw new Error(`${what} isn't connected. Tap Connect Google.`);
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (res.status === 401) { forget(); throw new Error('Google session expired. Connect again.'); }
  if (res.status === 403) throw new Error(`${what} refused access. Is the ${what} API enabled in your Google Cloud project, and did you allow it on Google's screen?`);
  if (!res.ok) throw new Error(`${what} error ${res.status}`);
  return res;
}
