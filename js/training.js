// Trainees, training sessions and each trainee's lesson log. Pure functions: no network, no storage.
//
// trainees: {id, name, notes, archived}
// sessions: {id, title, description, traineeIds, date ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'), durationMin, notes,
//            status: 'planned' | 'done' | 'cancelled', attended (traineeIds actually there, once done),
//            doneNote, gcal: {eventId, calendarId}, notifiedFor}

const HOUR = 3_600_000;

export const hasTime = (d) => typeof d === 'string' && d.length > 10;
export function sessionStart(x) {
  if (!x.date) return null;
  const d = new Date(hasTime(x.date) ? x.date : `${x.date}T00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function sessionEnd(x) {
  const s = sessionStart(x);
  return s && new Date(s.getTime() + (Number(x.durationMin) || 60) * 60_000);
}

// Who counts as having covered this lesson: those marked present, else everyone it was for.
export const attendees = (x) => (x.status === 'done' && Array.isArray(x.attended) ? x.attended : x.traineeIds || []);

// A planned session whose time has passed: ask whether it happened.
export function needsLogging(x, now = new Date()) {
  if (x.status !== 'planned') return false;
  const end = hasTime(x.date) ? sessionEnd(x) : new Date(sessionStart(x)?.getTime() + 24 * HOUR);
  return !!end && end < now;
}

export const isUpcoming = (x, now = new Date()) => x.status === 'planned' && !needsLogging(x, now);

// Per trainee: lessons covered (newest first) and their next planned session.
export function progress(state, now = new Date()) {
  const sessions = state.sessions || [];
  return (state.trainees || []).filter((t) => !t.archived).map((t) => {
    const covered = sessions.filter((x) => x.status === 'done' && attendees(x).includes(t.id))
      .sort((a, b) => sessionStart(b) - sessionStart(a));
    const next = sessions.filter((x) => isUpcoming(x, now) && (x.traineeIds || []).includes(t.id))
      .sort((a, b) => sessionStart(a) - sessionStart(b))[0] || null;
    return { trainee: t, covered, next, last: covered[0] || null };
  }).sort((a, b) => a.trainee.name.localeCompare(b.trainee.name));
}

const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trainee';

/**
 * One-off move from the old course-style trainings ({name, trainees, currentLesson, nextSession, log}) to
 * trainees + sessions. IDs are derived from the old data, so two devices migrating separately produce the
 * same records (sync then sees them as one). Returns true if anything was added.
 */
export function migrateTrainings(state) {
  const old = state.trainings || [];
  state.trainees ||= [];
  state.sessions ||= [];
  if (!old.length) return false;
  const haveT = new Set(state.trainees.map((t) => t.id));
  const haveS = new Set(state.sessions.map((x) => x.id));
  let added = false;
  for (const t of old) {
    const who = String(t.trainees || '').trim() || String(t.name || '').trim();
    const traineeId = `m-${slug(who)}`;
    if (!haveT.has(traineeId)) {
      state.trainees.push({ id: traineeId, name: who, notes: '', archived: false });
      haveT.add(traineeId);
      added = true;
    }
    (t.log || []).forEach((l, i) => {
      const id = `m-${t.id}-${i}`;
      if (haveS.has(id)) return;
      state.sessions.push({
        id, title: `${t.name}: Lesson ${l.lesson}`, description: '', traineeIds: [traineeId], date: l.date || '',
        durationMin: 60, notes: '', status: 'done', attended: [traineeId], doneNote: l.note || '', gcal: null, notifiedFor: '',
      });
      haveS.add(id);
      added = true;
    });
    if (t.nextSession && !haveS.has(`m-${t.id}-next`)) {
      state.sessions.push({
        id: `m-${t.id}-next`, title: `${t.name}: Lesson ${t.currentLesson || 1}`, description: t.notes || '', traineeIds: [traineeId],
        date: t.nextSession, durationMin: 60, notes: '', status: 'planned', attended: null, doneNote: '', gcal: null,
        notifiedFor: t.notifiedFor || '',
      });
      haveS.add(`m-${t.id}-next`);
      added = true;
    }
  }
  return added;
}
