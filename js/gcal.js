// Google Calendar, called straight from your browser to Google. No server of ours sits in between.
// Sign-in is shared with the rest of the app (see google.js).

import * as google from './google.js';

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export const isConnected = () => google.has('calendar');

async function call(url, opts = {}) {
  const res = await google.authFetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }, 'Google Calendar');
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
