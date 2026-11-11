// Reads DBS/POSB transaction alert emails from your Gmail, straight from this device to Google.
// - Only messages from DBS's alert addresses are ever requested (see SENDERS / the search query).
// - Each one must pass Google's DMARC check for dbs.com, so a fake "DBS" email can't add expenses.
// - Emails are parsed in memory; only the amount, payee, date and how you paid are kept (encrypted).
// - The access token lives in memory only and expires within the hour.
import { loadGis } from './gcal.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://www.googleapis.com/gmail/v1/users/me/messages';
export const SENDERS = ['ibanking.alert@dbs.com', 'paylah.alert@dbs.com'];

let token = null;
let tokenExpiry = 0;

export const isConnected = () => !!token && Date.now() < tokenExpiry;

export async function connect(clientId) {
  if (!clientId) throw new Error('Add your Google OAuth Client ID in Settings first.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) return reject(new Error('Gmail access was not allowed'));
        token = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in) - 60) * 1000;
        resolve();
      },
      error_callback: (e) => reject(new Error(e?.message || 'Google sign-in was cancelled')),
    });
    client.requestAccessToken();
  });
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  forget();
}

export function forget() {
  token = null;
  tokenExpiry = 0;
}

async function call(url) {
  if (!isConnected()) throw new Error('Gmail is not connected');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { forget(); throw new Error('Gmail session expired. Connect again.'); }
  if (res.status === 403) throw new Error('Gmail refused access. Is the Gmail API enabled in your Google Cloud project?');
  if (!res.ok) throw new Error(`Gmail error ${res.status}`);
  return res.json();
}

// IDs of DBS alert emails received after `afterSec` (unix seconds), oldest first.
export async function listAlertIds(afterSec) {
  const q = `from:(${SENDERS.join(' OR ')}) after:${Math.floor(afterSec)}`;
  const ids = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ q, maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await call(`${API}?${params}`);
    for (const m of data.messages || []) ids.push(m.id);
    pageToken = data.nextPageToken || '';
  } while (pageToken && ids.length < 1000);
  return ids.reverse();
}

export async function getMessage(id) {
  return call(`${API}/${encodeURIComponent(id)}?format=full`);
}

function b64urlToText(data) {
  const bin = atob(String(data).replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// Gmail message -> {subject, sender, sentAt, body, headers}
export function decode(msg) {
  const headers = {};
  for (const h of msg.payload?.headers || []) {
    const k = h.name.toLowerCase();
    headers[k] = headers[k] ? `${headers[k]}\n${h.value}` : h.value;
  }
  let plain = '';
  let html = '';
  (function walk(part) {
    if (!part) return;
    if (part.body?.data) {
      if (part.mimeType === 'text/plain' && !plain) plain = b64urlToText(part.body.data);
      else if (part.mimeType === 'text/html' && !html) html = b64urlToText(part.body.data);
    }
    (part.parts || []).forEach(walk);
  })(msg.payload);
  const sender = (headers.from || '').match(/<([^>]+)>/)?.[1] || headers.from || '';
  return {
    subject: headers.subject || '',
    sender: sender.trim().toLowerCase(),
    sentAt: new Date(Number(msg.internalDate) || Date.now()),
    body: html || plain || msg.snippet || '',
    headers,
  };
}

// True only if the email really comes from DBS: sent from a DBS address and passed Google's DMARC check for dbs.com.
export function isGenuineDbs(d) {
  if (!/@dbs\.com$/.test(d.sender)) return false;
  // Only trust the result Google's own mail servers stamped on it, not one a sender could forge.
  const google = (d.headers['authentication-results'] || '').split('\n').filter((h) => /^\s*mx\.google\.com\s*;/i.test(h));
  return google.some((h) => /dmarc=pass/i.test(h) && /header\.from=(?:[\w-]+\.)*dbs\.com\b/i.test(h));
}
