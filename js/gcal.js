// Google Calendar, called straight from your browser to Google. No server of ours sits in between.
// Sign-in is shared with the rest of the app (see google.js).

import * as google from './google.js';

const BASE = 'https://www.googleapis.com/calendar/v3';
const eventsUrl = (calendarId = 'primary') => `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

export const isConnected = () => google.has('calendar');
export const canListCalendars = () => google.has('calendarList');

async function call(url, opts = {}) {
  const res = await google.authFetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }, 'Google Calendar');
  return res.json();
}

const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '');

// Your calendars that you can add events to ("My calendars" plus any shared with edit rights).
// Main calendar first, then A–Z. `shown` = ticked in Google Calendar's sidebar.
export async function listCalendars() {
  if (!canListCalendars()) return [];
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ minAccessRole: 'writer', maxResults: '250' });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await call(`${BASE}/users/me/calendarList?${q}`);
    for (const c of data.items || []) {
      if (c.deleted) continue;
      out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, color: safeColor(c.backgroundColor), shown: c.selected !== false && !c.hidden });
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name));
}

async function eventsIn(calendar, from, to) {
  const q = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });
  const data = await call(`${eventsUrl(calendar.id)}?${q}`);
  return (data.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
    id: e.id,
    title: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: !e.start?.dateTime,
    free: e.transparency === 'transparent', // shown as "Free" in Google Calendar
    link: e.htmlLink,
    calendar: calendar.primary ? 'Main' : calendar.name || '',
    color: safeColor(calendar.color),
  }));
}

// Events from every calendar you have ticked in Google Calendar (or just the main one if the list isn't available).
export async function listEvents(from, to, calendars = []) {
  const which = calendars.filter((c) => c.shown);
  const lists = await Promise.all((which.length ? which : [{ id: 'primary' }]).map((c) => eventsIn(c, from, to).catch(() => [])));
  return lists.flat().sort((a, b) => new Date(a.start) - new Date(b.start));
}

// start/end are Date objects. reminderMin adds a phone/desktop popup from Google Calendar itself,
// which works even when this app is closed.
export function createEvent({ title, description = '', start, end, reminderMin = 30, calendarId = 'primary' }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return call(eventsUrl(calendarId), {
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

// Moves an event this app created to a new time (keeps its title, description and reminders).
export function moveEvent(calendarId, eventId, start, end) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return call(`${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ start: { dateTime: start.toISOString(), timeZone: tz }, end: { dateTime: end.toISOString(), timeZone: tz } }),
  });
}

// Removes an event this app booked (e.g. when you un-book a to-do's time).
export async function deleteEvent(calendarId, eventId) {
  await google.authFetch(`${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, 'Google Calendar').catch((err) => {
    if (!/error 410|error 404/.test(err.message)) throw err; // already gone
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
