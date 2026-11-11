import * as store from './store.js';
import * as gcal from './gcal.js';
import * as V from './views.js';
import { esc, formData, parseDT, parseDay, isoDay, advanceDue, download, DAY, startOfDay, fmtTime } from './util.js';

const $ = (sel) => document.querySelector(sel);
const lockEl = $('#lock');
const lockBody = $('#lock-body');
const appEl = $('#app');
const viewEl = $('#view');

let current = 'today';
let cal = { connected: false, events: [] };
let lastActivity = Date.now();
let ticker = null;

// ---------------- toast ----------------
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

// ---------------- lock screen ----------------
async function showLock() {
  appEl.hidden = true;
  lockEl.hidden = false;
  const exists = await store.hasVault();
  lockBody.innerHTML = exists
    ? `<h1>Welcome back</h1>
       <form data-lock="unlock" class="stack-form">
         <label>Passphrase<input name="pass" type="password" required autocomplete="current-password" autofocus></label>
         <button class="btn">Unlock</button>
       </form>`
    : `<h1>Set up your tracker</h1>
       <p class="muted">Choose a passphrase. It encrypts everything on this device. <strong>There is no reset:</strong> if you forget it, the data cannot be recovered by anyone.</p>
       <form data-lock="create" class="stack-form">
         <label>Passphrase (8+ characters)<input name="p1" type="password" minlength="8" required autocomplete="new-password"></label>
         <label>Repeat passphrase<input name="p2" type="password" minlength="8" required autocomplete="new-password"></label>
         <button class="btn">Create encrypted vault</button>
       </form>
       <details class="restore"><summary>Restore from a backup instead</summary>
         <form data-lock="restore" class="stack-form">
           <label>Backup file<input name="file" type="file" accept=".ctbackup,application/json" required></label>
           <label>Passphrase used for that backup<input name="pass" type="password" required autocomplete="current-password"></label>
           <button class="btn-ghost">Restore</button>
         </form>
       </details>`;
  lockBody.querySelector('input')?.focus();
}

lockBody.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button');
  const f = formData(form);
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Working…';
  try {
    if (form.dataset.lock === 'create') {
      if (f.p1 !== f.p2) throw new Error("Passphrases don't match");
      await store.createVault(f.p1);
    } else if (form.dataset.lock === 'unlock') {
      try { await store.unlock(f.pass); } catch { throw new Error('Wrong passphrase'); }
    } else if (form.dataset.lock === 'restore') {
      const text = await form.file.files[0].text();
      try { await store.importBackup(text, f.pass); } catch (err) {
        throw new Error(err.message.includes('backup') ? err.message : 'Wrong passphrase for this backup');
      }
    }
    enterApp();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = label;
  }
});

function enterApp() {
  lockEl.hidden = true;
  appEl.hidden = false;
  lockBody.innerHTML = '';
  lastActivity = Date.now();
  render();
  startTicker();
  if (gcal.isConnected()) refreshCalendar();
}

function doLock() {
  store.lock();
  gcal.disconnect();
  cal = { connected: false, events: [] };
  viewEl.innerHTML = '';
  clearInterval(ticker);
  showLock();
}

// ---------------- rendering ----------------
function notifPerm() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function render() {
  if (!store.isUnlocked()) return;
  const s = store.state;
  const html = {
    today: () => V.today(s, cal),
    money: () => V.moneyView(s),
    tasks: () => V.tasksView(s, cal),
    training: () => V.trainingView(s),
    calendar: () => V.calendarView(s, cal),
    settings: () => V.settingsView(s, notifPerm()),
  }[current]();
  viewEl.innerHTML = html;
  // widths are applied via CSSOM so the strict CSP can forbid inline styles
  viewEl.querySelectorAll('[data-w]').forEach((el) => el.style.setProperty('--w', `${Math.max(0, Number(el.dataset.w) || 0)}%`));
  document.querySelectorAll('.nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === current));
}

function go(view) {
  current = view;
  render();
  viewEl.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

async function commit(msg) {
  await store.save();
  render();
  if (msg) toast(msg);
}

document.querySelector('.nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) go(b.dataset.view);
});

// ---------------- calendar helpers ----------------
async function refreshCalendar() {
  try {
    const from = startOfDay();
    cal.events = await gcal.listEvents(from, new Date(from.getTime() + 7 * DAY));
    cal.connected = true;
  } catch (err) {
    cal.connected = gcal.isConnected();
    toast(err.message, true);
  }
  render();
}

async function ensureCalendar() {
  if (gcal.isConnected()) return;
  await gcal.connect(store.state.settings.googleClientId);
  cal.connected = true;
}

function eventFromTask(t) {
  const start = parseDT(t.due);
  const allDayish = t.due.length === 10;
  if (allDayish) start.setHours(9, 0, 0, 0);
  return { title: t.title, description: t.notes || 'From Caden Tracker', start, end: new Date(start.getTime() + 30 * 60000), reminderMin: allDayish ? 60 : 15 };
}

function eventFromTraining(t) {
  const start = parseDT(t.nextSession);
  return {
    title: `${t.name}: Lesson ${t.currentLesson}${t.totalLessons ? `/${t.totalLessons}` : ''}`,
    description: [t.trainees && `Group: ${t.trainees}`, t.notes].filter(Boolean).join('\n') || 'From Caden Tracker',
    start, end: new Date(start.getTime() + 60 * 60000), reminderMin: 60,
  };
}

async function pushToCalendar(ev) {
  await ensureCalendar();
  await gcal.createEvent(ev);
  toast('Added to Google Calendar');
  refreshCalendar();
}

function safeName(s) {
  return String(s).replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'event';
}

// ---------------- clicks ----------------
viewEl.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT' && el.type === 'file') return;
  const s = store.state;
  const id = el.dataset.id;
  const find = (arr) => arr.find((x) => x.id === id);
  try {
    switch (el.dataset.act) {
      case 'goto': return go(el.dataset.view);
      case 'task-toggle': { const t = find(s.tasks); t.done = el.checked; return commit(t.done ? 'Nice, done ✓' : null); }
      case 'task-del': s.tasks = s.tasks.filter((t) => t.id !== id); return commit('To-do deleted');
      case 'tasks-clear-done': s.tasks = s.tasks.filter((t) => !t.done); return commit();
      case 'task-gcal': return pushToCalendar(eventFromTask(find(s.tasks)));
      case 'task-ics': { const t = find(s.tasks); return download(`${safeName(t.title)}.ics`, gcal.icsFor(eventFromTask(t)), 'text/calendar'); }
      case 'income-del': s.income = s.income.filter((x) => x.id !== id); return commit();
      case 'saving-del': if (!confirm('Delete this savings budget?')) return; s.savings = s.savings.filter((x) => x.id !== id); return commit();
      case 'bill-del': s.bills = s.bills.filter((x) => x.id !== id); return commit();
      case 'bill-paid': { const b = find(s.bills); b.nextDue = advanceDue(b.nextDue, b.cycle); return commit(`${b.name}: next due moved on`); }
      case 'training-del': if (!confirm('Delete this training and its history?')) return; s.trainings = s.trainings.filter((x) => x.id !== id); return commit();
      case 'training-gcal': return pushToCalendar(eventFromTraining(find(s.trainings)));
      case 'training-ics': { const t = find(s.trainings); return download(`${safeName(t.name)}.ics`, gcal.icsFor(eventFromTraining(t)), 'text/calendar'); }
      case 'gcal-connect': await ensureCalendar(); toast('Google Calendar connected'); return refreshCalendar();
      case 'gcal-refresh': return refreshCalendar();
      case 'gcal-disconnect': gcal.disconnect(); cal = { connected: false, events: [] }; return render();
      case 'notif-enable': await Notification.requestPermission(); return render();
      case 'brief-now': return sendBrief(true);
      case 'export': {
        const text = await store.exportBackup();
        return download(`cadentracker-${isoDay()}.ctbackup`, text, 'application/json');
      }
      case 'lock': return doLock();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

viewEl.addEventListener('change', async (e) => {
  if (e.target.dataset.act !== 'import') return;
  const file = e.target.files[0];
  if (!file) return;
  const pass = prompt('Passphrase that was used for this backup:');
  if (!pass) return;
  if (!confirm('This replaces all data on this device with the backup. Continue?')) return;
  try {
    await store.importBackup(await file.text(), pass);
    toast('Backup restored. Your passphrase is now the backup\'s passphrase.');
    render();
  } catch (err) {
    toast(err.message.includes('backup') ? err.message : 'Wrong passphrase for this backup', true);
  }
});

// ---------------- forms ----------------
viewEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = formData(form);
  const s = store.state;
  const id = form.dataset.id;
  const num = (v) => (v === '' || v == null ? 0 : Number(v));
  try {
    switch (form.dataset.form) {
      case 'quick-task':
        s.tasks.push({ id: store.uid(), title: f.title.trim(), due: isoDay(), notes: '', done: false, remind: false, notified: false });
        return commit('Added for today');

      case 'task': {
        const t = { id: store.uid(), title: f.title.trim(), due: f.due || '', notes: f.notes.trim(), done: false, remind: !!f.remind && !!f.due, notified: false };
        s.tasks.push(t);
        await commit('To-do added');
        if (f.toCal && t.due) await pushToCalendar(eventFromTask(t));
        return;
      }

      case 'income':
        s.income.push({ id: store.uid(), source: f.source.trim(), amount: num(f.amount), date: f.date, recurring: f.recurring ? 'monthly' : 'none' });
        return commit('Income logged');

      case 'saving':
        s.savings.push({ id: store.uid(), name: f.name.trim(), monthly: num(f.monthly), target: num(f.target), saved: num(f.saved) });
        return commit('Savings budget added');

      case 'deposit': {
        const g = s.savings.find((x) => x.id === id);
        g.saved = Math.round((num(g.saved) + num(f.amount)) * 100) / 100;
        return commit('Logged');
      }

      case 'bill':
        s.bills.push({ id: store.uid(), name: f.name.trim(), amount: num(f.amount), cycle: f.cycle, nextDue: f.nextDue, kind: f.kind });
        return commit('Added');

      case 'training':
        s.trainings.push({
          id: store.uid(), name: f.name.trim(), trainees: f.trainees.trim(), totalLessons: f.totalLessons ? num(f.totalLessons) : '',
          currentLesson: num(f.currentLesson) || 1, nextSession: f.nextSession || '', notes: f.notes.trim(), log: [], notifiedFor: '',
        });
        return commit('Training added');

      case 'lesson-done': {
        const t = s.trainings.find((x) => x.id === id);
        t.log = t.log || [];
        t.log.push({ date: isoDay(), lesson: t.currentLesson, note: f.note.trim() });
        t.currentLesson = num(t.currentLesson) + 1;
        t.nextSession = f.nextSession || '';
        t.notifiedFor = '';
        const done = t.totalLessons && t.currentLesson > t.totalLessons;
        return commit(done ? `${t.name} completed 🎉` : `Now on lesson ${t.currentLesson}`);
      }

      case 'training-resched': {
        const t = s.trainings.find((x) => x.id === id);
        t.nextSession = f.nextSession;
        t.notifiedFor = '';
        return commit('Rescheduled');
      }

      case 'event': {
        const start = parseDT(f.start);
        const ev = { title: f.title.trim(), description: f.description.trim(), start, end: new Date(start.getTime() + num(f.duration) * 60000), reminderMin: num(f.reminder) };
        const target = e.submitter?.value || 'ics';
        if (target === 'gcal') { await pushToCalendar(ev); form.reset(); }
        else download(`${safeName(ev.title)}.ics`, gcal.icsFor(ev), 'text/calendar');
        return;
      }

      case 'settings':
        Object.assign(s.settings, {
          currency: f.currency.toUpperCase(),
          morningHour: num(f.morningHour),
          autoLockMin: num(f.autoLockMin) || 10,
          googleClientId: f.googleClientId.trim(),
        });
        return commit('Settings saved');

      case 'passphrase':
        if (f.p1 !== f.p2) throw new Error("Passphrases don't match");
        await store.changePassphrase(f.p1);
        form.reset();
        return toast('Passphrase changed. Old backups still use the old passphrase.');

      case 'wipe':
        if (f.confirm !== 'ERASE') throw new Error('Type ERASE exactly to confirm');
        await store.wipe();
        gcal.disconnect();
        return showLock();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------------- reminders & morning brief ----------------
async function notify(title, body, tag) {
  if (notifPerm() !== 'granted') return false;
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  if (reg) await reg.showNotification(title, opts);
  else new Notification(title, opts);
  return true;
}

function briefText() {
  const u = V.upcoming(store.state);
  const parts = [];
  if (u.overdue.length) parts.push(`${u.overdue.length} overdue`);
  parts.push(`${u.todayTasks.length} to-do${u.todayTasks.length === 1 ? '' : 's'} today`);
  const todayTrain = u.trainings.filter((t) => parseDT(t.nextSession) < new Date(startOfDay().getTime() + DAY));
  if (todayTrain.length) parts.push(`training: ${todayTrain.map((t) => `${t.name} L${t.currentLesson}`).join(', ')}`);
  const billsSoon = u.bills.filter((b) => parseDay(b.nextDue) < new Date(startOfDay().getTime() + 3 * DAY));
  if (billsSoon.length) parts.push(`bills due: ${billsSoon.map((b) => b.name).join(', ')}`);
  const week = u.week.length + u.trainings.length - todayTrain.length;
  if (week) parts.push(`${week} more thing${week === 1 ? '' : 's'} this week`);
  const todayEvents = cal.events.filter((e) => startOfDay(new Date(e.start)).getTime() === startOfDay().getTime());
  if (todayEvents.length) parts.push(`${todayEvents.length} calendar event${todayEvents.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

async function sendBrief(force = false) {
  const s = store.state;
  const today = isoDay();
  if (!force && (s.settings.lastBrief === today || new Date().getHours() < Number(s.settings.morningHour))) return;
  const sent = await notify('Your day', briefText(), 'brief');
  if (!force) {
    s.settings.lastBrief = today; // the Today screen is the brief even without notification permission
    await store.save();
  } else if (!sent) toast('Turn on notifications first', true);
}

async function checkReminders() {
  const s = store.state;
  const now = new Date();
  let changed = false;
  for (const t of s.tasks) {
    if (t.done || !t.remind || t.notified || !t.due) continue;
    const due = parseDT(t.due);
    if (t.due.length === 10) due.setHours(Number(s.settings.morningHour), 0, 0, 0);
    if (due <= now) {
      await notify('Reminder', `${t.title}${t.due.length > 10 ? ` (${fmtTime(due)})` : ''}`, `task-${t.id}`);
      t.notified = true;
      changed = true;
    }
  }
  for (const t of s.trainings) {
    if (!t.nextSession || t.notifiedFor === t.nextSession) continue;
    const start = parseDT(t.nextSession);
    const mins = (start - now) / 60000;
    if (mins <= 60 && mins > -30) {
      await notify('Training soon', `${t.name}: lesson ${t.currentLesson} at ${fmtTime(start)}`, `train-${t.id}`);
      t.notifiedFor = t.nextSession;
      changed = true;
    }
  }
  if (changed) { await store.save(); render(); }
}

function startTicker() {
  clearInterval(ticker);
  const tick = async () => {
    if (!store.isUnlocked()) return;
    if (Date.now() - lastActivity > Number(store.state.settings.autoLockMin || 10) * 60000) return doLock();
    try { await checkReminders(); await sendBrief(); } catch (err) { console.warn(err); }
  };
  tick();
  ticker = setInterval(tick, 30_000);
}

['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, () => (lastActivity = Date.now()), { passive: true }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !store.isUnlocked()) return;
  if (Date.now() - lastActivity > Number(store.state.settings.autoLockMin || 10) * 60000) doLock();
  else { render(); }
});

// ---------------- boot ----------------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW failed', err));
}
showLock();
