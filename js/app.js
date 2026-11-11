import * as store from './store.js';
import * as google from './google.js';
import * as gcal from './gcal.js';
import * as gmail from './gmail.js';
import * as sync from './sync.js';
import { mergeState } from './merge.js';
import { GOOGLE_CLIENT_ID } from './config.js';
import { parseAlert, categorize, merchantKey, CATEGORIES } from './expenses.js';
import * as V from './views.js';
import { esc, formData, parseDT, parseDay, isoDay, advanceDue, download, DAY, startOfDay, fmtTime } from './util.js';

const $ = (sel) => document.querySelector(sel);
const lockEl = $('#lock');
const lockBody = $('#lock-body');
const appEl = $('#app');
const viewEl = $('#view');

let current = 'today';
let cal = { connected: false, events: [] };
let mail = { connected: false, syncing: false, lastChecked: 0, note: '' };
let sy = { status: 'off', lastSynced: 0, msg: '', again: false }; // sync between devices
let syncTimer = null;

// The Client ID isn't secret. A copy outside the encrypted vault lets a new device sign in before it has any data.
function clientId() {
  const fromVault = store.isUnlocked() ? store.state.settings.googleClientId : '';
  let saved = '';
  try { saved = localStorage.getItem('ct.clientId') || ''; } catch { /* storage unavailable */ }
  return fromVault || saved || GOOGLE_CLIENT_ID;
}
function rememberClientId(id) {
  try { if (id) localStorage.setItem('ct.clientId', id); } catch { /* ignore */ }
}
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
         ${google.autoConnectOn() && clientId() ? '<p class="muted small">Google (sync, Calendar, DBS import) reconnects automatically when you unlock.</p>' : ''}
       </form>`
    : `<h1>Set up your tracker</h1>
       <p class="muted">Choose a passphrase. It encrypts everything on this device. <strong>There is no reset:</strong> if you forget it, the data cannot be recovered by anyone.</p>
       <form data-lock="create" class="stack-form">
         <label>Passphrase (8+ characters)<input name="p1" type="password" minlength="8" required autocomplete="new-password"></label>
         <label>Repeat passphrase<input name="p2" type="password" minlength="8" required autocomplete="new-password"></label>
         <button class="btn">Create encrypted vault</button>
       </form>
       <details class="restore" data-preload-google><summary>Already use it on another device? Get your data</summary>
         <form data-lock="cloud" class="stack-form">
           <p class="muted small">Sign in with the Google account you turned sync on with, then enter your passphrase from that device.</p>
           <label>Google OAuth Client ID<input name="clientId" value="${esc(clientId())}" required autocomplete="off" spellcheck="false" placeholder="xxxxxxxx.apps.googleusercontent.com"></label>
           <label>Your passphrase<input name="pass" type="password" required autocomplete="current-password"></label>
           <button class="btn">Sign in with Google &amp; get my data</button>
         </form>
       </details>
       <details class="restore"><summary>Restore from a backup file instead</summary>
         <form data-lock="restore" class="stack-form">
           <label>Backup file<input name="file" type="file" accept=".ctbackup,application/json" required></label>
           <label>Passphrase used for that backup<input name="pass" type="password" required autocomplete="current-password"></label>
           <button class="btn-ghost">Restore</button>
         </form>
       </details>`;
  lockBody.querySelector('input')?.focus();
  // get Google's sign-in script ready, so reconnecting can happen inside the Unlock tap
  if (exists && google.autoConnectOn() && clientId()) google.preload().catch(() => {});
}

// Load Google's sign-in script as soon as the option is opened, so the popup isn't blocked on submit.
lockBody.addEventListener('toggle', (e) => {
  if (e.target.matches?.('[data-preload-google]') && e.target.open) google.preload().catch(() => {});
}, true);

lockBody.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  // Reconnect Google in the same tap as Unlock (browsers only allow Google's window right after a tap).
  // You've allowed it before, so the window closes by itself. It runs alongside the passphrase check.
  let autoGoogle = null;
  if (form.dataset.lock === 'unlock' && google.autoConnectOn() && clientId()) {
    autoGoogle = google.connect(clientId(), { silent: true });
    autoGoogle.catch(() => {}); // handled after unlocking
  }
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
    } else if (form.dataset.lock === 'cloud') {
      const cid = f.clientId.trim();
      await google.connect(cid);
      rememberClientId(cid);
      if (!sync.isConnected()) throw new Error('Google Drive access is needed to fetch your data. Try again and allow it.');
      const remote = await sync.download();
      if (!remote) throw new Error('No synced data on this Google account yet. On your other device, go to Settings → Sync between devices and turn it on first.');
      try { await store.createFromSynced(remote, f.pass); } catch { throw new Error('Wrong passphrase for your synced data'); }
      if (!store.state.settings.googleClientId) store.state.settings.googleClientId = cid;
      sy = { status: 'ok', lastSynced: Date.now(), msg: '', again: false };
    } else if (form.dataset.lock === 'restore') {
      const text = await form.file.files[0].text();
      try { await store.importBackup(text, f.pass); } catch (err) {
        throw new Error(err.message.includes('backup') ? err.message : 'Wrong passphrase for this backup');
      }
    }
    enterApp(autoGoogle);
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = label;
  }
});

function enterApp(autoGoogle = null) {
  lockEl.hidden = true;
  appEl.hidden = false;
  lockBody.innerHTML = '';
  lastActivity = Date.now();
  autoErr = '';
  // keep a readable copy of the (non-secret) Client ID, so the next unlock can reconnect Google by itself
  if (store.state.settings.googleClientId) rememberClientId(store.state.settings.googleClientId);
  lastFailedTry = 0;
  render();
  startTicker();
  if (clientId()) google.preload().catch(() => {});
  if (autoGoogle) {
    sy.status = sy.status === 'off' ? 'connecting' : sy.status;
    autoGoogle
      .then(() => {
        cal.connected = gcal.isConnected(); mail.connected = gmail.isConnected();
        if (sy.status === 'connecting') sy.status = 'off';
        return afterConnect();
      })
      .catch((err) => { autoErr = err.message; if (sy.status === 'connecting') sy.status = 'off'; safeRender(); });
  } else if (google.isConnected()) afterConnect().catch((err) => toast(err.message, true));
}

// ---------------- keeping Google connected ----------------
// Google's access lasts about an hour. When it's nearly up, renew it on your next tap (it has to be a tap),
// silently, so syncing and imports carry on.
let autoErr = '';
let lastFailedTry = 0; // after a failed attempt, wait 5 minutes before trying again on a tap
// Also the fallback when reconnecting at Unlock didn't happen or was blocked: your first tap reconnects.
window.addEventListener('pointerdown', (e) => {
  if (!store.isUnlocked() || !google.autoConnectOn() || !clientId()) return;
  if (e.target.closest?.('[data-act="lock"], [data-act="google-disconnect"], [data-act="gmail-disconnect"], [data-act="gcal-disconnect"]')) return;
  if (google.msLeft() > 5 * 60_000 || Date.now() - lastFailedTry < 5 * 60_000) return;
  const wasExpired = !google.isConnected();
  google.connect(clientId(), { silent: true })
    .then(() => { cal.connected = gcal.isConnected(); mail.connected = gmail.isConnected(); autoErr = ''; if (wasExpired) return afterConnect(); })
    .catch((err) => { autoErr = err.message; lastFailedTry = Date.now(); safeRender(); });
}, { capture: true, passive: true });

async function doLock() {
  // send any unsynced change first
  if (syncTimer && sync.isConnected()) { clearTimeout(syncTimer); syncTimer = null; await syncNow(false).catch(() => {}); }
  clearTimeout(syncTimer);
  store.lock();
  google.forget();
  sync.reset();
  cal = { connected: false, events: [] };
  mail = { connected: false, syncing: false, lastChecked: 0, note: '' };
  sy = { status: 'off', lastSynced: 0, msg: '', again: false };
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
    today: () => V.today(s, cal, mail, syncInfo()),
    money: () => V.moneyView(s, mail),
    tasks: () => V.tasksView(s, cal),
    training: () => V.trainingView(s),
    calendar: () => V.calendarView(s, cal),
    settings: () => V.settingsView(s, notifPerm(), syncInfo()),
  }[current]();
  viewEl.innerHTML = html;
  // widths are applied via CSSOM so the strict CSP can forbid inline styles
  viewEl.querySelectorAll('[data-w]').forEach((el) => el.style.setProperty('--w', `${Math.max(0, Number(el.dataset.w) || 0)}%`));
  document.querySelectorAll('.nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === current));
}

const syncInfo = () => ({ ...sy, google: google.isConnected(), drive: sync.isConnected(), auto: google.autoConnectOn(), autoErr });

// Re-render unless you're in the middle of typing (a background sync shouldn't wipe a half-filled form).
let renderPending = false;
function safeRender() {
  const a = document.activeElement;
  if (a && viewEl.contains(a) && a.matches('input, textarea, select')) { renderPending = true; return; }
  renderPending = false;
  render();
}
viewEl.addEventListener('focusout', () => { if (renderPending) setTimeout(() => { if (renderPending) safeRender(); }, 300); });

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
  scheduleSync();
}

// ---------------- Google sign-in (Calendar, DBS import, sync) ----------------
async function connectGoogle() {
  await google.connect(clientId());
  cal.connected = gcal.isConnected();
  mail.connected = gmail.isConnected();
}

// After signing in: pull your other device's changes first, then import DBS alerts, then calendar.
async function afterConnect() {
  if (sync.isConnected()) await syncNow(true).catch((err) => toast(`Sync: ${err.message}`, true));
  if (gmail.isConnected()) await syncExpenses(false).catch((err) => toast(err.message, true));
  if (gcal.isConnected()) await refreshCalendar();
  render();
}

// ---------------- sync between devices ----------------
function scheduleSync(delay = 1500) {
  if (!sync.isConnected() || !store.isUnlocked()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; syncNow(false); }, delay);
}

// interactive: you pressed a button, so it may ask for your passphrase. Background syncs never prompt.
async function syncNow(interactive = false) {
  if (!store.isUnlocked()) return;
  if (sy.status === 'syncing' || mail.syncing) { sy.again = true; if (mail.syncing) scheduleSync(2000); return; }
  if (!sync.isConnected()) {
    if (!interactive) return;
    await connectGoogle();
    if (!sync.isConnected()) throw new Error("Google Drive access wasn't allowed, so sync can't run. Connect again and tick Drive.");
  }
  sy.status = 'syncing';
  safeRender();
  try {
    store.state.settings.syncEnabled = true;
    const remote = await sync.download();
    if (remote) {
      let data;
      try {
        data = await store.openSynced(remote);
      } catch (err) {
        if (err.code !== 'NEEDS_PASS') throw err;
        if (!interactive) { sy.status = 'needs-pass'; return; }
        const pass = prompt('Your synced data uses the passphrase from your other device. Enter it to sync. This device will use that passphrase from now on.');
        if (!pass) { sy.status = 'needs-pass'; return; }
        try { data = await store.adoptSynced(remote, pass); } catch { throw new Error('Wrong passphrase for your synced data'); }
        toast('Linked. This device now uses the same passphrase as your other device.');
      }
      const before = JSON.stringify(store.syncPayload());
      const merged = mergeState(store.syncBase(), store.syncPayload(), data);
      store.replaceState(merged);
      if (JSON.stringify(merged) !== JSON.stringify(data)) await sync.upload(await store.sealForSync(merged));
      store.setSyncBase(merged);
      await store.save();
      if (JSON.stringify(merged) !== before) safeRender();
    } else {
      const payload = store.syncPayload();
      await sync.upload(await store.sealForSync(payload));
      store.setSyncBase(payload);
      await store.save();
    }
    sy.status = 'ok';
    sy.lastSynced = Date.now();
    sy.msg = '';
  } catch (err) {
    sy.status = 'error';
    sy.msg = err.message;
    if (interactive) throw err;
    console.warn(err);
  } finally {
    safeRender();
    if (sy.again) { sy.again = false; scheduleSync(300); }
  }
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
  await connectGoogle();
  if (!gcal.isConnected()) throw new Error("Calendar access wasn't allowed. Connect again and tick Calendar.");
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

// ---------------- expenses from DBS alert emails ----------------
// Money received becomes an income entry; anything else is an expense. Returns 'income' | 'expense' | null.
function addFromAlert(p, source, msgId = '') {
  const s = store.state;
  if (p.incoming) {
    if (p.currency !== s.settings.currency) return null;
    s.income.push({ id: store.uid(), source: p.merchant, amount: p.amount, date: isoDay(p.when), recurring: 'none', fromEmail: source === 'email', msgId });
    return 'income';
  }
  addExpense(p, source, msgId);
  return 'expense';
}

function addExpense(p, source, msgId = '') {
  const s = store.state;
  s.expenses.push({
    id: store.uid(), when: p.when.toISOString(), amount: p.amount, currency: p.currency, merchant: p.merchant,
    category: categorize(p.merchant, p.via, { rules: s.categoryRules, bills: s.bills }), via: p.via, source, msgId,
  });
}

// interactive: true when you pressed the button (may open Google's sign-in); false for the quiet background check.
async function syncExpenses(interactive) {
  if (mail.syncing) return;
  if (!gmail.isConnected()) {
    if (!interactive) return;
    await connectGoogle();
    if (!gmail.isConnected()) throw new Error("Gmail access wasn't allowed. Connect again and tick Gmail.");
    // get your other device's imports first, so nothing is logged twice (a sync problem shouldn't block the import)
    if (sync.isConnected()) await syncNow(true).catch((err) => toast(`Sync: ${err.message}`, true));
  }
  // never import while a sync is swapping in merged data
  for (let i = 0; sy.status === 'syncing' && i < 150; i++) await new Promise((r) => setTimeout(r, 200));
  mail.connected = true;
  mail.syncing = true;
  if (current === 'money' || current === 'today') safeRender();
  const s = store.state;
  const es = s.expenseSync;
  const seen = new Set(es.seen);
  const now = new Date();
  // first time: from the start of this month; after that, re-check 2 days back so nothing slips through
  const after = es.lastSync ? es.lastSync - 2 * 86400 : new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  let added = 0, incomeAdded = 0, skipped = 0, unverified = 0;
  try {
    const ids = (await gmail.listAlertIds(after)).filter((id) => !seen.has(id));
    for (const id of ids) {
      const d = gmail.decode(await gmail.getMessage(id));
      es.seen.push(id);
      if (!gmail.isGenuineDbs(d)) { unverified++; continue; }
      const p = parseAlert(d.body, { subject: d.subject, sender: d.sender, sentAt: d.sentAt });
      if (p.skip) { skipped++; continue; }
      const kind = addFromAlert(p, 'email', id);
      if (kind === 'expense') added++;
      else if (kind === 'income') incomeAdded++;
      else skipped++;
    }
    es.seen = es.seen.slice(-2000);
    es.lastSync = Math.floor(now.getTime() / 1000);
    mail.lastChecked = Date.now();
    mail.note = [
      unverified && `${unverified} email${unverified === 1 ? '' : 's'} ignored because ${unverified === 1 ? 'it' : 'they'} couldn't be verified as really from DBS`,
      skipped && `${skipped} alert${skipped === 1 ? " wasn't" : "s weren't"} spending (e.g. money in, OTPs, declined)`,
    ].filter(Boolean).join(' · ');
    await store.save();
    scheduleSync();
    const parts = [added && `${added} expense${added === 1 ? '' : 's'}`, incomeAdded && `${incomeAdded} income`].filter(Boolean);
    if (interactive || parts.length) toast(parts.length ? `Logged ${parts.join(' and ')} from DBS` : 'Nothing new from DBS');
  } catch (err) {
    mail.connected = gmail.isConnected();
    throw err;
  } finally {
    mail.syncing = false;
    safeRender();
  }
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
      case 'gmail-sync': return await syncExpenses(true);
      case 'gmail-disconnect':
      case 'gcal-disconnect':
      case 'google-disconnect':
        google.disconnect(); sync.reset();
        cal = { connected: false, events: [] }; mail = { connected: false, syncing: false, lastChecked: 0, note: '' };
        sy = { ...sy, status: 'off' };
        toast('Disconnected from Google on this device'); return render();
      case 'google-connect': await connectGoogle(); toast('Connected to Google'); return afterConnect();
      case 'sync-now': await syncNow(true); return toast(sy.status === 'ok' ? 'Synced' : 'Sync needs your passphrase');
      case 'sync-off': {
        if (!confirm('Turn off sync and delete the synced copy from your Google Drive? Each device keeps its own data.')) return;
        await sync.remove(); store.state.settings.syncEnabled = false; delete store.state.__syncBase; sy = { ...sy, status: 'off' };
        await store.save(); render(); return toast('Sync turned off. Synced copy deleted from Drive.');
      }
      case 'exp-del': s.expenses = s.expenses.filter((x) => x.id !== id); return commit('Expense deleted');
      case 'gcal-connect': await connectGoogle(); toast('Connected to Google'); return afterConnect();
      case 'gcal-refresh': return refreshCalendar();
      case 'notif-enable': await Notification.requestPermission(); return render();
      case 'brief-now': return sendBrief(true);
      case 'export': {
        const text = await store.exportBackup();
        return download(`cadentracker-${isoDay()}.ctbackup`, text, 'application/json');
      }
      case 'lock': return await doLock();
    }
  } catch (err) {
    toast(err.message, true);
  }
});

viewEl.addEventListener('change', async (e) => {
  if (e.target.dataset.act === 'exp-cat') {
    const s = store.state;
    const x = s.expenses.find((ex) => ex.id === e.target.dataset.id);
    const cat = e.target.value;
    if (!x || !CATEGORIES.includes(cat)) return;
    const key = merchantKey(x.merchant);
    let others = 0;
    if (key) {
      s.categoryRules[key] = cat; // remembered for future imports from this payee
      for (const ex of s.expenses) if (ex !== x && merchantKey(ex.merchant) === key && ex.category !== cat) { ex.category = cat; others++; }
    }
    x.category = cat;
    return commit(others ? `Updated ${others + 1} from ${x.merchant}; future ones too` : `Got it, ${x.merchant} will go under ${cat} from now on`);
  }
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

      case 'expense': {
        const when = f.date === isoDay() ? new Date() : parseDay(f.date);
        if (f.date !== isoDay()) when.setHours(12);
        s.expenses.push({ id: store.uid(), when: when.toISOString(), amount: num(f.amount), currency: s.settings.currency, merchant: f.merchant.trim(),
          category: CATEGORIES.includes(f.category) ? f.category : 'Other', via: 'cash', source: 'manual', msgId: '' });
        return commit('Expense logged');
      }

      case 'paste-alert': {
        const p = parseAlert(f.alert, { sentAt: new Date() });
        if (p.skip) throw new Error(p.skip === 'no amount' || p.skip === 'no payee' ? "Couldn't find an amount and payee in that text" : `That alert isn't spending (${p.skip})`);
        if (p.incoming && p.currency !== s.settings.currency) throw new Error(`That's money received in ${p.currency}; add it under Income in ${s.settings.currency}`);
        addFromAlert(p, 'pasted');
        form.reset();
        return commit(p.incoming ? `Logged ${p.currency} ${p.amount.toFixed(2)} received as income` : `Logged ${p.currency} ${p.amount.toFixed(2)} at ${p.merchant}`);
      }

      case 'saving': {
        const pct = Math.min(100, num(f.pct));
        if (!pct && !num(f.monthly)) throw new Error('Enter an amount per month or a % of income');
        s.savings.push({ id: store.uid(), name: f.name.trim(), monthly: pct ? 0 : num(f.monthly), pct, target: num(f.target), saved: num(f.saved), log: [] });
        return commit('Budget added');
      }

      case 'deposit': {
        const g = s.savings.find((x) => x.id === id);
        g.saved = Math.round((num(g.saved) + num(f.amount)) * 100) / 100;
        (g.log ||= []).push({ date: isoDay(), amount: num(f.amount) });
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
        rememberClientId(s.settings.googleClientId);
        return commit('Settings saved');

      case 'passphrase':
        if (f.p1 !== f.p2) throw new Error("Passphrases don't match");
        if (s.settings.syncEnabled) {
          // bring in your other devices' changes under the old passphrase, then re-lock the synced copy with the new one
          await syncNow(true);
          if (!sync.isConnected()) throw new Error('Connect Google first, so your synced data can be switched to the new passphrase too');
        }
        await store.changePassphrase(f.p1);
        if (store.state.settings.syncEnabled && sync.isConnected()) {
          const payload = store.syncPayload();
          await sync.upload(await store.sealForSync(payload));
          store.setSyncBase(payload);
          await store.save();
        }
        form.reset();
        return toast(store.state.settings.syncEnabled
          ? 'Passphrase changed here and for your synced data. Your other devices will ask for it once.'
          : 'Passphrase changed. Old backups still use the old passphrase.');

      case 'wipe':
        if (f.confirm !== 'ERASE') throw new Error('Type ERASE exactly to confirm');
        clearTimeout(syncTimer); syncTimer = null;
        await store.wipe();
        google.disconnect();
        sy = { status: 'off', lastSynced: 0, msg: '', again: false };
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
    if (gmail.isConnected() && Date.now() - mail.lastChecked > 10 * 60_000) syncExpenses(false).catch((err) => console.warn(err));
    if (sync.isConnected() && sy.status !== 'syncing' && Date.now() - sy.lastSynced > 2 * 60_000) syncNow(false);
  };
  tick();
  ticker = setInterval(tick, 30_000);
}

['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, () => (lastActivity = Date.now()), { passive: true }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !store.isUnlocked()) return;
  if (Date.now() - lastActivity > Number(store.state.settings.autoLockMin || 10) * 60000) doLock();
  else { render(); if (sync.isConnected()) syncNow(false); } // pick up changes made on your other device
});

// ---------------- boot ----------------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW failed', err));
}
showLock();
