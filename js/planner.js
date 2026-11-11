// Finds free time in your calendar for your to-dos. Pure functions: no network, no storage.

const MIN = 60_000;
const DAY = 86_400_000;
const roundUp = (t, step) => Math.ceil(t / (step * MIN)) * step * MIN;

// Busy periods from calendar events, trainings and to-dos you've already booked.
// All-day events and events marked "free" in Google Calendar don't block time.
export function busyTimes({ events = [], trainings = [], tasks = [] }) {
  const busy = [];
  for (const e of events) {
    if (e.allDay || e.free) continue;
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    if (en > s) busy.push([s, en]);
  }
  for (const t of trainings) {
    if (!t.nextSession || t.nextSession.length <= 10) continue;
    const s = new Date(t.nextSession).getTime();
    busy.push([s, s + 60 * MIN]);
  }
  for (const t of tasks) {
    if (t.done || !t.planned) continue; // (past bookings can't clash with future slots anyway)
    busy.push([new Date(t.planned.start).getTime(), new Date(t.planned.end).getTime()]);
  }
  return busy.sort((a, b) => a[0] - b[0]);
}

const overlaps = (s, e, busy) => busy.some(([bs, be]) => s < be && e > bs);

// Free start times for a task of `mins` minutes, earliest first, never overlapping each other.
function candidates(mins, busy, { now, dayStart, dayEnd, days, step }) {
  const out = [];
  const first = roundUp(now, step);
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  for (let d = 0; d < days; d++) {
    const date = new Date(day0.getTime() + d * DAY + 12 * 3600 * 1000); // midday, safe across DST
    const open = new Date(date); open.setHours(dayStart, 0, 0, 0);
    const close = new Date(date); close.setHours(dayEnd, 0, 0, 0);
    let t = Math.max(open.getTime(), first);
    while (t + mins * MIN <= close.getTime()) {
      const end = t + mins * MIN;
      if (!overlaps(t, end, busy)) { out.push([t, end]); t = end; } else t += step * MIN;
    }
  }
  return out;
}

// Latest a task should be finished by: its due time, or the end of your planning day on its due date.
function deadline(task, dayEnd) {
  if (!task.due) return Infinity;
  if (task.due.length > 10) return new Date(task.due).getTime();
  const d = new Date(`${task.due}T00:00`);
  d.setHours(dayEnd, 0, 0, 0);
  return d.getTime();
}

/**
 * One suggested slot per open, unbooked to-do (most urgent first).
 * opts: now (ms), dayStart/dayEnd (hours), days, step (minutes), skips {taskId: n} for "Another time", limit.
 * Returns [{taskId, start, end, late}] where late = couldn't fit before it's due.
 */
export function suggest(tasks, busy, opts = {}) {
  const o = { now: Date.now(), dayStart: 9, dayEnd: 22, days: 7, step: 15, skips: {}, limit: 6, ...opts };
  // booked to-dos are left alone, unless the booked time has passed without them being done
  const open = tasks.filter((t) => !t.done && !(t.planned && new Date(t.planned.end).getTime() > o.now))
    .map((t, i) => ({ t, i, by: deadline(t, o.dayEnd) }))
    .sort((a, b) => a.by - b.by || a.i - b.i)
    .slice(0, o.limit);
  const taken = [...busy];
  const out = [];
  for (const { t, by } of open) {
    const mins = Number(t.mins) || 30;
    const all = candidates(mins, taken, o);
    if (!all.length) continue;
    const inTime = all.filter(([, e]) => e <= by);
    const pool = inTime.length ? inTime : all;
    const [start, end] = pool[(o.skips[t.id] || 0) % pool.length];
    taken.push([start, end]);
    out.push({ taskId: t.id, start: new Date(start), end: new Date(end), late: !inTime.length && by !== Infinity });
  }
  return out;
}
