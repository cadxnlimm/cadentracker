// Run with: node tests/training.test.mjs
import { migrateTrainings, progress, needsLogging, attendees } from '../js/training.js';
import assert from 'node:assert/strict';

// --- moving old course-style trainings over ---
const old = () => ({
  trainings: [
    { id: 't1', name: 'First aid', trainees: 'Youth & Teens', currentLesson: 3, nextSession: '2026-11-20T19:00', notes: 'Bring kits',
      log: [{ date: '2026-11-01', lesson: 1, note: 'CPR basics' }, { date: '2026-11-08', lesson: 2, note: '' }] },
    { id: 't2', name: 'Worship', trainees: 'Youth & Teens', currentLesson: 1, nextSession: '', log: [] },
  ],
  trainees: [], sessions: [],
});
const a = old();
assert.equal(migrateTrainings(a), true);
assert.equal(a.trainees.length, 1, 'same group name becomes one trainee');
assert.equal(a.trainees[0].name, 'Youth & Teens');
assert.equal(a.sessions.filter((x) => x.status === 'done').length, 2);
const next = a.sessions.find((x) => x.status === 'planned');
assert.equal(next.title, 'First aid: Lesson 3'); assert.equal(next.description, 'Bring kits');
assert.equal(migrateTrainings(a), false, 'running again adds nothing');
// two devices migrating separately get identical records (so sync merges them)
const b = old(); migrateTrainings(b);
assert.deepEqual(a.sessions.map((x) => x.id).sort(), b.sessions.map((x) => x.id).sort());
assert.deepEqual(a.trainees, b.trainees);

// --- progress per trainee ---
const now = new Date('2026-11-13T10:00');
const st = {
  trainees: [{ id: 'j', name: 'John' }, { id: 'm', name: 'Mary' }, { id: 'x', name: 'Old', archived: true }],
  sessions: [
    { id: 's1', title: 'L1', traineeIds: ['j', 'm'], date: '2026-11-01T19:00', status: 'done', attended: ['j', 'm'] },
    { id: 's2', title: 'L2', traineeIds: ['j', 'm'], date: '2026-11-08T19:00', status: 'done', attended: ['j'] }, // Mary absent
    { id: 's3', title: 'L3', traineeIds: ['j', 'm'], date: '2026-11-20T19:00', status: 'planned' },
    { id: 's4', title: 'Missed?', traineeIds: ['m'], date: '2026-11-12T19:00', durationMin: 60, status: 'planned' },
    { id: 's5', title: 'Called off', traineeIds: ['j'], date: '2026-11-05T19:00', status: 'cancelled' },
  ],
};
const p = Object.fromEntries(progress(st, now).map((r) => [r.trainee.id, r]));
assert.deepEqual(Object.keys(p).sort(), ['j', 'm'], 'archived trainees hidden');
assert.deepEqual(p.j.covered.map((x) => x.id), ['s2', 's1'], 'John: both lessons, newest first');
assert.deepEqual(p.m.covered.map((x) => x.id), ['s1'], 'Mary missed lesson 2');
assert.equal(p.j.next.id, 's3');
assert.equal(p.m.next.id, 's3', 'a past, unlogged session is not "next"');
assert.equal(needsLogging(st.sessions[3], now), true);
assert.equal(needsLogging(st.sessions[2], now), false);
assert.deepEqual(attendees({ status: 'done', traineeIds: ['a', 'b'] }), ['a', 'b'], 'no attendance taken = everyone');
console.log('all training tests passed');
