// Google Calendar, called straight from your browser to Google. No server of ours sits in between.
// The access token lives in memory only (gone when you lock or close the app).
// Google's script is loaded only when you press "Connect", so nothing is sent to Google otherwise.

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

let token = null;
let tokenExpiry = 0;
let client = null;

export function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in (are you offline?)'));
    document.head.appendChild(s);
  });
}

export const isConnected = () => !!token && Date.now() < tokenExpiry;

export async function connect(clientId) {
  if (!clientId) throw new Error('Add your Google OAuth Client ID in Settings first.');
  await loadGis();
  return new Promise((resolve, reject) => {
    client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        token = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in) - 60) * 1000;
        resolve();
      },
      error_callback: (e) => reject(new Error(e?.message || 'Google sign-in was cancelled')),
    });
    client.requestAccessToken();
  });
}

// Signs out at Google too (you'll see the consent screen again next time).
export function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  forget();
}

// Drops the token from memory only (used when the app locks). It expires at Google within the hour.
export function forget() {
  token = null;
  tokenExpiry = 0;
}

async function call(url, opts = {}) {
  if (!isConnected()) throw new Error('Google Calendar is not connected');
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) { token = null; throw new Error('Google session expired. Connect again.'); }
  if (!res.ok) throw new Error(`Google Calendar error ${res.status}`);
  return res.json();
}

export async function listEvents(from, to) {
  const q = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });
  const data = await call(`${API}?${q}`);
  return (data.items || []).map((e) => ({
    id: e.id,
    title: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: !e.start?.dateTime,
    link: e.htmlLink,
  }));
}

// start/end are Date objects. reminderMin adds a phone/desktop popup from Google Calendar itself,
// which works even when this app is closed.
export function createEvent({ title, description = '', start, end, reminderMin = 30 }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return call(API, {
    method: 'POST',
    body: JSON.stringify({
      summary: title,
      description,
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: reminderMin }] },
    }),
  });
}

// Fallback that needs no Google connection: a .ics file any calendar app can import.
export function icsFor({ title, description = '', start, end, reminderMin = 30 }) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s).replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Caden Tracker//EN', 'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@cadentracker`, `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(description)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, `TRIGGER:-PT${reminderMin}M`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}
