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

export async function connect(clientId) {
  if (!clientId) throw new Error('Add your Google OAuth Client ID first (Settings).');
  await preload();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: Object.values(SCOPES).join(' '),
      include_granted_scopes: true,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        token = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in) - 60) * 1000;
        granted = new Set(Object.values(SCOPES).filter((sc) => google.accounts.oauth2.hasGrantedAllScopes(resp, sc)));
        resolve(granted);
      },
      error_callback: (e) => reject(new Error(e?.message || 'Google sign-in was cancelled')),
    });
    client.requestAccessToken();
  });
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
