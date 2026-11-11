// Encrypted vault kept in this browser's IndexedDB. Only ciphertext is ever written to disk.
import { deriveKey, encryptJSON, decryptJSON, randomBytes, saltOf, b64, ITERATIONS } from './crypto.js';

const DB_NAME = 'cadentracker';
const STORE = 'vault';
const KEY = 'main';

let key = null;
let salt = null;
let iterations = ITERATIONS;
export let state = null;

export function emptyState() {
  return {
    income: [],         // {id, source, amount, date, recurring: 'none'|'monthly', fromEmail, msgId}
    savings: [],        // {id, name, monthly, pct (% of the month's income, overrides monthly), target, saved, log: [{date, amount}]}
    bills: [],          // {id, name, amount, cycle: 'weekly'|'monthly'|'yearly', nextDue, kind: 'subscription'|'bill'}
    tasks: [],          // {id, title, due, notes, done, remind, notified, mins (how long it takes), planned: {start, end} once booked}
    trainings: [],      // {id, name, trainees, totalLessons, currentLesson, nextSession, notes, log: [{date, lesson, note}]}
    expenses: [],       // {id, when, amount, currency, merchant, category, via: 'card'|'paynow'|'paylah'|'transfer'|'cash', source: 'email'|'manual'|'pasted', msgId}
    categoryRules: {},  // merchantKey -> category, learnt when you re-categorise an expense
    expenseSync: { lastSync: 0, seen: [] }, // Gmail alert import: last check (unix s) and alert IDs already read
    settings: { currency: 'SGD', googleClientId: '', morningHour: 8, lastBrief: '', autoLockMin: 10, planStart: 9, planEnd: 22 },
  };
}

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const readBlob = () => idb('readonly', (s) => s.get(KEY));
const writeBlob = (blob) => idb('readwrite', (s) => s.put(blob, KEY));

export async function hasVault() {
  return !!(await readBlob());
}

export async function createVault(passphrase) {
  salt = randomBytes(16);
  iterations = ITERATIONS;
  key = await deriveKey(passphrase, salt, iterations);
  state = emptyState();
  migrate();
  await save();
}

// One-off additions to existing data. Each runs once per vault.
function migrate() {
  const st = state.settings;
  if (!st.titheAdded) {
    if (!state.savings.some((g) => /^tithe$/i.test(g.name))) {
      state.savings.unshift({ id: uid(), name: 'Tithe', monthly: 0, pct: 10, target: 0, saved: 0, log: [] });
    }
    st.titheAdded = true;
    return true;
  }
  return false;
}

export async function unlock(passphrase) {
  const blob = await readBlob();
  if (!blob) throw new Error('No vault on this device');
  return openBlob(blob, passphrase);
}

async function openBlob(blob, passphrase) {
  const s = saltOf(blob);
  const k = await deriveKey(passphrase, s, blob.iterations);
  const data = await decryptJSON(k, blob); // throws on wrong passphrase
  salt = s;
  iterations = blob.iterations;
  key = k;
  const base = emptyState();
  state = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  if (migrate()) await save();
}

export async function save() {
  if (!key) throw new Error('Locked');
  await writeBlob(await encryptJSON(key, salt, iterations, state));
}

export function lock() {
  key = null;
  state = null;
}

export const isUnlocked = () => !!key;

// Backup file = the same encrypted blob. Safe to keep in cloud storage; useless without your passphrase.
export async function exportBackup() {
  await save();
  return JSON.stringify(await readBlob());
}

export async function importBackup(text, passphrase) {
  const blob = JSON.parse(text);
  if (!blob || blob.v !== 1 || !blob.data) throw new Error('Not a Caden Tracker backup file');
  await openBlob(blob, passphrase);
  await writeBlob(blob);
}

export async function changePassphrase(newPass) {
  salt = randomBytes(16);
  iterations = ITERATIONS;
  key = await deriveKey(newPass, salt, iterations);
  await save();
}

export async function wipe() {
  lock();
  await idb('readwrite', (s) => s.delete(KEY));
}

export const uid = () => crypto.randomUUID();

// ---------- sync ----------
// The synced copy is your data minus __syncBase (the last copy both devices agreed on, kept per device),
// encrypted with the same passphrase-derived key as this vault.
export function syncPayload() {
  const { __syncBase, ...rest } = state;
  return JSON.parse(JSON.stringify(rest));
}
export const syncBase = () => state.__syncBase || null;
export function setSyncBase(data) { state.__syncBase = JSON.parse(JSON.stringify(data)); }
export function replaceState(next) { state = { ...next, __syncBase: state.__syncBase }; }

export const sealForSync = (obj) => encryptJSON(key, salt, iterations, obj);

// Decrypts the synced copy with this device's key. If it was locked with a different passphrase
// (e.g. changed on your other device, or this device was set up separately), throws code NEEDS_PASS.
export async function openSynced(blob) {
  if (!blob?.data || blob.salt !== b64(salt) || blob.iterations !== iterations) {
    throw Object.assign(new Error('Passphrase needed for your synced data'), { code: 'NEEDS_PASS' });
  }
  return decryptJSON(key, blob);
}

// Unlocks the synced copy with `passphrase` and switches this device to that passphrase.
export async function adoptSynced(blob, passphrase) {
  const s = saltOf(blob);
  const k = await deriveKey(passphrase, s, blob.iterations);
  const data = await decryptJSON(k, blob); // throws if the passphrase is wrong
  salt = s;
  iterations = blob.iterations;
  key = k;
  return data;
}

// New device: start from the synced copy.
export async function createFromSynced(blob, passphrase) {
  const data = await adoptSynced(blob, passphrase);
  const base = emptyState();
  state = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  state.__syncBase = JSON.parse(JSON.stringify(data));
  migrate();
  await save();
}
