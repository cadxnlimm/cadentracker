// Reads DBS/POSB transaction alert emails from your Gmail, straight from this device to Google.
// - Only messages from DBS's alert addresses are ever requested (see SENDERS / the search query).
// - Each one must pass Google's DMARC check for dbs.com, so a fake "DBS" email can't add expenses.
// - Emails are parsed in memory; only the amount, payee, date and how you paid are kept (encrypted).
// - Sign-in is shared with the rest of the app (see google.js); the token lives in memory only.
import * as google from './google.js';

const API = 'https://www.googleapis.com/gmail/v1/users/me/messages';
export const SENDERS = ['ibanking.alert@dbs.com', 'paylah.alert@dbs.com'];

export const isConnected = () => google.has('gmail');

async function call(url) {
  return (await google.authFetch(url, {}, 'Gmail')).json();
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
