// Run with: node tests/merge.test.mjs
import { mergeState } from '../js/merge.js';
import assert from 'node:assert/strict';

const base = {
  tasks: [{ id: 'a', title: 'A', done: false }, { id: 'b', title: 'B', done: false }, { id: 'c', title: 'C', done: false }],
  settings: { currency: 'SGD', morningHour: 8 },
  expenses: [], income: [], savings: [{ id: 't1', name: 'Tithe', pct: 10, saved: 0, log: [] }],
  expenseSync: { lastSync: 100, seen: ['m1'] },
};
// phone: ticked A, deleted B, added D, changed morning hour
const local = structuredClone(base);
local.tasks[0].done = true;
local.tasks = local.tasks.filter((t) => t.id !== 'b');
local.tasks.push({ id: 'd', title: 'D (phone)', done: false });
local.settings.morningHour = 7;
local.expenseSync = { lastSync: 200, seen: ['m1', 'm2'] };
local.expenses.push({ id: 'e1', msgId: 'm2', amount: 5 });
// laptop: renamed C, added E, changed currency, imported the same alert m2 too
const remote = structuredClone(base);
remote.tasks[2].title = 'C renamed';
remote.tasks.push({ id: 'e', title: 'E (laptop)', done: false });
remote.settings.currency = 'USD';
remote.expenseSync = { lastSync: 150, seen: ['m1', 'm2', 'm3'] };
remote.expenses.push({ id: 'e2', msgId: 'm2', amount: 5 });

const m = mergeState(base, local, remote);
const byId = Object.fromEntries(m.tasks.map((t) => [t.id, t]));
assert.equal(byId.a.done, true, 'phone tick kept');
assert.equal(byId.b, undefined, 'phone delete carried');
assert.equal(byId.c.title, 'C renamed', 'laptop rename kept');
assert.ok(byId.d && byId.e, 'additions from both kept');
assert.deepEqual(m.settings, { currency: 'USD', morningHour: 7 }, 'settings merged per key');
assert.equal(m.expenseSync.lastSync, 200);
assert.deepEqual(m.expenseSync.seen.sort(), ['m1', 'm2', 'm3']);
assert.equal(m.expenses.length, 1, 'same DBS alert imported on both devices kept once');

// both edited the same item: this device wins
const l2 = structuredClone(base); l2.tasks[0].title = 'phone';
const r2 = structuredClone(base); r2.tasks[0].title = 'laptop';
assert.equal(mergeState(base, l2, r2).tasks[0].title, 'phone');

// first ever sync (no base): union, nothing lost; two auto-added Tithes become one
const p = { tasks: [{ id: 'x', title: 'X' }], savings: [{ id: 't1', name: 'Tithe', pct: 10, saved: 0, log: [{ date: '2026-11-01', amount: 50 }] }], settings: { currency: 'SGD' } };
const q = { tasks: [{ id: 'y', title: 'Y' }], savings: [{ id: 't2', name: 'Tithe', pct: 10, saved: 0, log: [] }], settings: { currency: 'SGD', googleClientId: 'abc' } };
const u = mergeState(null, p, q);
assert.deepEqual(u.tasks.map((t) => t.id).sort(), ['x', 'y']);
assert.equal(u.savings.length, 1); assert.equal(u.savings[0].log.length, 1);
assert.equal(u.settings.googleClientId, 'abc');

// deleted on laptop, untouched on phone -> gone; deleted on laptop but edited on phone -> kept
const l3 = structuredClone(base); l3.tasks[1].title = 'B edited on phone';
const r3 = structuredClone(base); r3.tasks = r3.tasks.filter((t) => t.id !== 'a' && t.id !== 'b');
const m3 = mergeState(base, l3, r3);
assert.deepEqual(m3.tasks.map((t) => t.id).sort(), ['b', 'c']);
console.log('all merge tests passed');
