// Run with: node tests/planner.test.mjs
import { suggest, busyTimes } from '../js/planner.js';
import assert from 'node:assert/strict';
const at = (d, h, m = 0) => { const x = new Date(2026, 10, d, h, m); return x; };
const iso = (d) => d.toISOString();
const now = at(11, 13, 7).getTime(); // Wed 11 Nov, 1:07 pm
const events = [
  { start: iso(at(11, 13, 0)), end: iso(at(11, 14, 30)) },          // meeting until 2:30
  { start: iso(at(11, 15, 0)), end: iso(at(11, 16, 0)) },           // 3-4pm
  { start: iso(at(11, 0)), end: iso(at(12, 0)), allDay: true },     // all-day: doesn't block
  { start: iso(at(11, 16, 0)), end: iso(at(11, 18, 0)), free: true }, // marked free: doesn't block
];
const sessions = [{ date: '2026-11-11T18:00', durationMin: 60, status: 'planned' }]; // training 6-7pm
const busy = busyTimes({ events, sessions });
const tasks = [
  { id: 'a', title: 'Undated', mins: 30 },
  { id: 'b', title: 'Due today 6pm', due: '2026-11-11T18:00', mins: 60 },
  { id: 'c', title: 'Short one', due: '2026-11-11', mins: 15 },
  { id: 'd', title: 'Done', done: true },
  { id: 'e', title: 'Booked', planned: { start: iso(at(11, 20)), end: iso(at(11, 21)) } },
];
const s = suggest(tasks, busy, { now, dayStart: 9, dayEnd: 22 });
const by = Object.fromEntries(s.map((x) => [x.taskId, x]));
const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
assert.deepEqual(Object.keys(by).sort(), ['a', 'b', 'c'], 'done and booked to-dos are skipped');
assert.equal(hm(by.b.start), '16:00', 'most urgent gets the first free hour (all-day + "free" events ignored)');
assert.equal(hm(by.c.start), '14:30', '15-min task fits right after the meeting');
assert.equal(hm(by.a.start), '17:00', 'undated 30 min skips the 15-min gap and the slot already suggested');
assert.ok(s.every((x) => !busy.some(([bs, be]) => x.start < be && x.end > bs)), 'nothing overlaps busy time');
// "Another time" moves to the next option
const s2 = suggest(tasks, busy, { now, dayStart: 9, dayEnd: 22, skips: { b: 1 } });
assert.equal(hm(s2.find((x) => x.taskId === 'b').start), '17:00');
// impossible deadline -> earliest slot, flagged late
const s3 = suggest([{ id: 'x', due: '2026-11-11T13:30', mins: 60 }], busy, { now, dayStart: 9, dayEnd: 22 });
assert.equal(s3[0].late, true);
// outside planning hours: at 23:00 the next suggestion is tomorrow 9:00
const s4 = suggest([{ id: 'y', mins: 30 }], [], { now: at(11, 23).getTime(), dayStart: 9, dayEnd: 22 });
assert.equal(s4[0].start.getDate(), 12); assert.equal(hm(s4[0].start), '9:00');
console.log('all planner tests passed');
