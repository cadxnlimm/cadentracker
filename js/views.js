// Each view returns an HTML string. Every piece of user data passes through esc().
import { CATEGORIES, NOT_SPENDING, GIVING } from './expenses.js';
import { suggest, busyTimes } from './planner.js';
import { progress, needsLogging, isUpcoming, attendees, sessionStart } from './training.js';
import { esc, money, fmtDay, fmtDT, fmtTime, parseDay, parseDT, startOfDay, sameDay, isoDay, DAY, monthlyCost } from './util.js';

const hasTime = (s) => !!s && s.length > 10;

// ---------- shared calculations ----------
// Income received in the month starting at m0. A monthly income counts in every month from its start date.
function incomeIn(s, m0) {
  const m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1);
  return s.income.reduce((sum, i) => {
    const d = parseDay(i.date);
    if (!d) return sum;
    if (i.recurring === 'monthly') return d < m1 ? sum + Number(i.amount) : sum;
    return d >= m0 && d < m1 ? sum + Number(i.amount) : sum;
  }, 0);
}

// A budget is either a fixed amount a month or a % of the month's income (e.g. Tithe = 10%).
export const budgetFor = (g, income) => (Number(g.pct) > 0 ? Math.round(income * Number(g.pct)) / 100 : Number(g.monthly) || 0);

export function monthSummary(s) {
  const now = new Date();
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const m1 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const income = incomeIn(s, m0);
  let yearIncome = 0;
  for (let m = 0; m <= now.getMonth(); m++) yearIncome += incomeIn(s, new Date(now.getFullYear(), m, 1));
  const committed = s.bills.reduce((sum, b) => sum + monthlyCost(b), 0);
  const saving = s.savings.reduce((sum, g) => sum + budgetFor(g, income), 0);
  const cur = s.settings.currency;
  const monthExp = (s.expenses || []).filter((x) => { const d = new Date(x.when); return d >= m0 && d < m1; });
  const counted = monthExp.filter((x) => x.currency === cur && !NOT_SPENDING.has(x.category));
  const spent = counted.reduce((sum, x) => sum + Number(x.amount), 0);
  const byCat = {};
  for (const x of counted) byCat[x.category] = (byCat[x.category] || 0) + Number(x.amount);
  // giving paid from your account this month (imported or added) counts towards the Tithe budget
  const givenThisMonth = monthExp.filter((x) => x.currency === cur && x.category === GIVING).reduce((sum, x) => sum + Number(x.amount), 0);
  return { income, yearIncome, committed, saving, spent, byCat, monthExp, givenThisMonth, left: income - committed - saving - spent };
}

export function upcoming(s, days = 7) {
  const today = startOfDay();
  const until = new Date(today.getTime() + days * DAY);
  const open = s.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && parseDT(t.due) < (hasTime(t.due) ? new Date() : today));
  const todayTasks = open.filter((t) => t.due && sameDay(parseDT(t.due), today) && !overdue.includes(t));
  const week = open.filter((t) => t.due && parseDT(t.due) >= new Date(today.getTime() + DAY) && parseDT(t.due) < until);
  // planned training sessions this week, plus any whose time has passed and still need logging
  const trainings = (s.sessions || [])
    .filter((x) => x.status === 'planned' && sessionStart(x) && (needsLogging(x) || (sessionStart(x) >= today && sessionStart(x) < until)))
    .sort((a, b) => sessionStart(a) - sessionStart(b));
  // the next few after this week, so Today never looks empty when trainings are planned further out
  const trainingsLater = (s.sessions || [])
    .filter((x) => x.status === 'planned' && sessionStart(x) && sessionStart(x) >= until)
    .sort((a, b) => sessionStart(a) - sessionStart(b))
    .slice(0, 3);
  const bills = s.bills
    .filter((b) => b.nextDue && parseDay(b.nextDue) < until)
    .sort((a, b) => parseDay(a.nextDue) - parseDay(b.nextDue));
  const byDue = (a, b) => parseDT(a.due) - parseDT(b.due);
  return { overdue: overdue.sort(byDue), todayTasks: todayTasks.sort(byDue), week: week.sort(byDue), trainings, trainingsLater, bills };
}

// ---------- pieces ----------
const empty = (msg) => `<p class="empty">${esc(msg)}</p>`;

function taskRow(t, { compact = false } = {}) {
  const due = parseDT(t.due);
  const late = !t.done && due && due < (hasTime(t.due) ? new Date() : startOfDay());
  return `<li class="row ${t.done ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-act="task-toggle" data-id="${esc(t.id)}" ${t.done ? 'checked' : ''}><span></span></label>
    <div class="row-main">
      <div class="row-title">${esc(t.title)}</div>
      ${due ? `<div class="row-sub ${late ? 'late' : ''}">${t.remind ? '🔔 ' : ''}${esc(fmtDT(due, hasTime(t.due)))}</div>` : ''}
      ${!t.done && t.planned ? `<div class="row-sub booked">${new Date(t.planned.end) < new Date() ? 'Booked time has passed' : 'Booked'} · ${esc(slotText(new Date(t.planned.start), new Date(t.planned.end)))}</div>` : ''}
      ${!compact && t.notes ? `<div class="row-note">${esc(t.notes)}</div>` : ''}
    </div>
    ${compact ? '' : `<div class="row-actions">
      ${!t.done && t.planned && new Date(t.planned.end) > new Date() ? `<button class="btn-ghost sm" data-act="task-unplan" data-id="${esc(t.id)}" title="Remove the booked time">Unbook</button>` : ''}
      ${due ? `<button class="btn-ghost sm" data-act="task-gcal" data-id="${esc(t.id)}" title="Add to Google Calendar">+ Cal</button>
      <button class="btn-ghost sm" data-act="task-ics" data-id="${esc(t.id)}" title="Download calendar file">.ics</button>` : ''}
      <button class="btn-ghost sm danger" data-act="task-del" data-id="${esc(t.id)}" aria-label="Delete">✕</button>
    </div>`}
  </li>`;
}

export const dayWord = (d) => { const w = fmtDay(d); return w === 'Today' || w === 'Tomorrow' ? w.toLowerCase() : `on ${w}`; };
const slotText = (a, b) => `${fmtDay(a)}, ${fmtTime(a)} – ${fmtTime(b)}`;
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
const durLabel = (m) => (m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`.replace('1.5 hrs', '1½ hrs'));
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

// "Suggested times": a free slot in your calendar for each open to-do.
function suggestionsCard(s, cal, plan) {
  const st = s.settings;
  const open = s.tasks.filter((t) => !t.done);
  if (!open.length) return '';
  const busy = busyTimes({ events: cal.connected ? cal.events : [], sessions: s.sessions || [], tasks: s.tasks });
  const list = suggest(s.tasks, busy, { dayStart: Number(st.planStart ?? 9), dayEnd: Number(st.planEnd ?? 22), skips: plan.skips || {} });
  const byId = Object.fromEntries(s.tasks.map((t) => [t.id, t]));
  const calList = cal.calendars || [];
  const bookInto = st.planCalendarId || st.calendarId;
  return `<section class="card">
    <div class="row-head"><h2>Suggested times</h2><span class="muted small">Free slots, ${esc(hourLabel(st.planStart ?? 9))}–${esc(hourLabel(st.planEnd ?? 22))}</span></div>
    ${cal.connected ? '' : `<div class="notice"><p>Connect Google so suggestions avoid your calendar events. Right now they only avoid your trainings.</p>
      ${st.googleClientId ? '<button type="button" class="btn-ghost sm" data-act="google-connect">Connect Google</button>' : ''}</div>`}
    ${list.length ? `<ul class="list">${list.map((x) => {
      const t = byId[x.taskId];
      const mins = Number(t.mins) || 30;
      return `<li class="row col sugg">
        <div class="row-main"><div class="row-title">${esc(t.title)}</div>
          <div class="row-sub ${x.late ? 'late' : ''}">${esc(slotText(x.start, x.end))}${x.late ? " · after it's due (no free time before)" : ''}</div></div>
        <div class="sugg-actions">
          <label class="sr-only" for="mins-${esc(t.id)}">How long ${esc(t.title)} takes</label>
          <select class="sm-select" id="mins-${esc(t.id)}" data-act="task-mins" data-id="${esc(t.id)}">${DURATIONS.map((m) => `<option value="${m}" ${m === mins ? 'selected' : ''}>${esc(durLabel(m))}</option>`).join('')}</select>
          <button type="button" class="btn-ghost sm" data-act="plan-other" data-id="${esc(t.id)}">Another time</button>
          <button type="button" class="btn sm" data-act="plan-book" data-id="${esc(t.id)}" data-start="${esc(x.start.toISOString())}" data-end="${esc(x.end.toISOString())}">Book it</button>
        </div></li>`;
    }).join('')}</ul>` : empty(open.every((t) => t.planned && new Date(t.planned.end) > new Date()) ? 'Every open to-do has a booked time.' : 'No free time found in the next 7 days within your hours.')}
    ${cal.connected && calList.length ? `<label class="inline-label">Book into<select class="sm-select" data-act="plan-cal">${calendarOptions(cal, bookInto)}</select></label>` : ''}
  </section>`;
}

function trainingMini(x, names = {}) {
  const who = (x.traineeIds || []).map((id) => names[id]).filter(Boolean).join(', ');
  const late = needsLogging(x);
  return `<li class="row"><div class="dot dot-train"></div><div class="row-main">
    <div class="row-title">${esc(x.title)}</div>
    <div class="row-sub ${late ? 'late' : ''}">${esc(fmtDT(sessionStart(x), hasTime(x.date)))}${who ? ` · ${esc(who)}` : ''}${late ? ' · needs logging' : ''}</div></div></li>`;
}

function trainingsBox(s, u) {
  const names = Object.fromEntries((s.trainees || []).map((t) => [t.id, t.name]));
  if (!u.trainings.length && !u.trainingsLater.length) {
    return `${empty('No trainings planned.')}<button class="btn-ghost sm" data-act="goto" data-view="training">+ Add a training</button>`;
  }
  return `${u.trainings.length ? `<ul class="list">${u.trainings.map((x) => trainingMini(x, names)).join('')}</ul>` : empty('None this week.')}
    ${u.trainingsLater.length ? `<p class="sub-label">Later</p><ul class="list">${u.trainingsLater.map((x) => trainingMini(x, names)).join('')}</ul>` : ''}`;
}

function billMini(b, cur) {
  const d = parseDay(b.nextDue);
  const late = d < startOfDay();
  return `<li class="row"><div class="dot dot-bill"></div><div class="row-main">
    <div class="row-title">${esc(b.name)} <span class="muted">${esc(money(b.amount, cur))}</span></div>
    <div class="row-sub ${late ? 'late' : ''}">${late ? 'Overdue · ' : ''}${esc(fmtDay(d))}</div></div>
    <button class="btn-ghost sm" data-act="bill-paid" data-id="${esc(b.id)}">Paid</button></li>`;
}

function stat(label, value, cls = '') {
  return `<div class="stat ${cls}"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div></div>`;
}

// ---------- sync status ----------
function syncChip(sync) {
  if (!sync) return '';
  if (sync.status === 'syncing') return `<span class="chip"><span class="pulse" aria-hidden="true"></span>Syncing…</span>`;
  if (sync.status === 'connecting') return `<span class="chip"><span class="pulse" aria-hidden="true"></span>Connecting to Google…</span>`;
  if (sync.status === 'ok' && sync.drive) return `<span class="chip"><span class="dot dot-ok" aria-hidden="true"></span>Synced ${esc(fmtTime(new Date(sync.lastSynced)))}</span>`;
  return '';
}

// Shown on Today when this device isn't signed in to Google, or sync needs attention.
function syncBanner(s, sync) {
  if (!sync) return '';
  if (sync.status === 'needs-pass') {
    return `<section class="card banner"><div><h2>Your other device changed the passphrase</h2>
      <p class="muted">Enter it once to keep syncing. This device will use it too.</p></div>
      <button class="btn" data-act="sync-now">Enter passphrase &amp; sync</button></section>`;
  }
  if (sync.status === 'error' && sync.drive) {
    return `<section class="card banner"><div><h2>Sync didn't finish</h2><p class="muted">${esc(sync.msg)}</p></div>
      <button class="btn-ghost" data-act="sync-now">Try again</button></section>`;
  }
  if (sync.status === 'connecting' && !sync.google) return '';
  if (!sync.google && (s.settings.syncEnabled || s.settings.googleClientId)) {
    const why = sync.auto ? (sync.autoErr ? `Couldn't reconnect automatically: ${esc(sync.autoErr)}` : 'Tap anywhere to reconnect.') : '';
    return `<section class="card banner"><div><h2>${s.settings.syncEnabled ? 'Sync with your other devices' : 'Connect Google'}</h2>
      <p class="muted">${why ? `${why} ` : ''}One tap ${s.settings.syncEnabled ? 'syncs your phone and laptop, ' : ''}imports new DBS spending and shows your calendar.${sync.auto ? '' : ' After this, it reconnects by itself whenever you unlock.'}</p></div>
      <button class="btn" data-act="google-connect">Connect Google</button></section>`;
  }
  return '';
}

// ---------- TODAY (morning brief) ----------
export function today(s, cal, mail = {}, sync = null) {
  const u = upcoming(s);
  const m = monthSummary(s);
  const cur = s.settings.currency;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const todayEvents = (cal.events || []).filter((e) => sameDay(new Date(e.start), new Date()));

  return `<header class="page-head head-row"><div><p class="eyebrow">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    <h1>${greet}, Caden</h1></div>${syncChip(sync)}</header>
  ${syncBanner(s, sync)}

  <div class="grid-2">
    <section class="card">
      <h2>Today</h2>
      ${u.overdue.length ? `<h3 class="late">Overdue</h3><ul class="list">${u.overdue.map((t) => taskRow(t, { compact: true })).join('')}</ul>` : ''}
      ${u.todayTasks.length ? `<ul class="list">${u.todayTasks.map((t) => taskRow(t, { compact: true })).join('')}</ul>` : u.overdue.length ? '' : empty('Nothing due today.')}
      <form class="inline-form" data-form="quick-task">
        <input name="title" placeholder="Quick add a to-do for today" required autocomplete="off">
        <button class="btn">Add</button>
      </form>
    </section>

    <section class="card">
      <h2>On your calendar today</h2>
      ${cal.connected
        ? (todayEvents.length
          ? `<ul class="list">${todayEvents.map((e) => eventRow(e, cal)).join('')}</ul>`
          : empty('No events today.'))
        : `<p class="muted">Connect Google Calendar to see today's events here.</p><button class="btn-ghost" data-act="gcal-connect">Connect Google Calendar</button>`}
    </section>
  </div>

  <section class="card">
    <h2>This week</h2>
    <div class="grid-3">
      <div><h3>To-dos</h3>${u.week.length ? `<ul class="list">${u.week.map((t) => taskRow(t, { compact: true })).join('')}</ul>` : empty('Clear week.')}</div>
      <div><h3>Trainings</h3>${trainingsBox(s, u)}</div>
      <div><h3>Bills due</h3>${u.bills.length ? `<ul class="list">${u.bills.map((b) => billMini(b, cur)).join('')}</ul>` : empty('Nothing due.')}</div>
    </div>
  </section>

  <section class="card">
    <h2>Money this month</h2>
    <div class="stats">
      ${stat('Income', money(m.income, cur))}
      ${stat('Bills & subs', money(m.committed, cur))}
      ${stat('Set aside to save', money(m.saving, cur))}
      ${stat('Spent so far', money(m.spent, cur))}
      ${stat('Left to spend', money(m.left, cur), m.left < 0 ? 'neg' : 'pos')}
    </div>

  </section>`;
}

// ---------- MONEY ----------
// Which fold-away sections are open (kept while the app is open; the app updates it).
export const ui = { open: {} };

const VIA = { card: 'Card', paynow: 'PayNow', paylah: 'PayLah!', transfer: 'Transfer', cash: 'Added by you' };

function expenseRow(x, cur) {
  const d = new Date(x.when);
  const foreign = x.currency !== cur;
  const excluded = NOT_SPENDING.has(x.category);
  return `<li class="row col exp-row">
    <div class="row-head">
      <div class="row-main">
        <div class="row-title">${esc(x.merchant)}</div>
        <div class="row-sub">${esc(fmtDT(d, x.source !== 'manual'))} · ${esc(VIA[x.via] || x.via)}${foreign ? ' · other currency, not in totals' : excluded ? ' · not counted as spending' : ''}</div>
      </div>
      <div class="exp-amt ${excluded || foreign ? 'muted' : ''}">${esc(money(x.amount, x.currency))}</div>
    </div>
    <div class="exp-actions">
      <label class="sr-only" for="cat-${esc(x.id)}">Category for ${esc(x.merchant)}</label>
      <select class="sm-select" id="cat-${esc(x.id)}" data-act="exp-cat" data-id="${esc(x.id)}">${CATEGORIES.map((c) => `<option ${c === x.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <button class="btn-ghost sm danger" data-act="exp-del" data-id="${esc(x.id)}" aria-label="Delete expense">✕</button>
    </div>
  </li>`;
}

function spendingCard(s, m, mail) {
  const cur = s.settings.currency;
  const cats = Object.entries(m.byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  const list = [...m.monthExp].sort((a, b) => new Date(b.when) - new Date(a.when));
  const earlier = (s.expenses || []).filter((x) => !m.monthExp.includes(x)).sort((a, b) => new Date(b.when) - new Date(a.when)).slice(0, 100);
  const last = s.expenseSync?.lastSync ? new Date(s.expenseSync.lastSync * 1000) : null;

  let sync;
  if (!s.settings.googleClientId) {
    sync = `<p class="muted">Add your Google Client ID in Settings first, then come back here to connect your DBS alert emails.</p>
      <button class="btn-ghost" data-act="goto" data-view="settings">Go to Settings</button>`;
  } else if (mail.syncing) {
    sync = `<p class="sync-line"><span class="pulse" aria-hidden="true"></span>Checking your DBS alert emails…</p>`;
  } else if (mail.connected) {
    sync = `<p class="sync-line"><span class="dot dot-ok" aria-hidden="true"></span>Auto-importing from DBS emails while the app is open${last ? ` · last checked ${esc(fmtTime(last))}` : ''}</p>
      ${mail.note ? `<p class="muted small">${esc(mail.note)}</p>` : ''}
      <div class="btn-row"><button class="btn-ghost sm" data-act="gmail-sync">Check now</button><button class="btn-ghost sm" data-act="google-disconnect">Disconnect Google</button></div>`;
  } else {
    sync = `<p class="muted">${last ? `Last imported ${esc(fmtDT(last))}. ` : ''}Your DBS alert emails become expenses automatically. Nothing to type.</p>
      <button class="btn" data-act="gmail-sync">${last ? 'Import new DBS spending' : 'Connect Gmail & import'}</button>
      ${last ? '' : `<details class="setup"><summary class="muted">First time? 2 things to set up</summary>
        <ol class="steps">
          <li><strong>Get an email for every DBS payment.</strong> In digibank: <em>More → Manage Alerts</em>. For your cards, set the alert threshold to <strong>S$0.01</strong> and tick <strong>Email</strong>. Do the same for <em>Funds transfer / PayNow</em>. For PayLah!, turn on <em>Outgoing Payments</em> email alerts in the PayLah! app.</li>
          <li><strong>Turn on the Gmail API</strong> in the same Google Cloud project as your Calendar setup: <em>APIs &amp; Services → Library → Gmail API → Enable</em>.</li>
        </ol>
        <p class="muted small">The app only asks Gmail for emails from ibanking.alert@dbs.com and paylah.alert@dbs.com, checks each is genuinely from DBS, and keeps just the amount, payee and date, encrypted on this device. Google's screen will say "read your email" because Gmail has no narrower permission.</p>
      </details>`}`;
  }

  return `<section class="card">
    <div class="row-head"><h2>Spending this month</h2><span class="big-num">${esc(money(m.spent, cur))}</span></div>
    ${sync}
    ${cats.length ? `<ul class="cat-bars">${cats.map(([c, v]) => `<li><span class="cat-name">${esc(c)}</span><span class="progress"><span data-w="${(v / max) * 100}"></span></span><span class="cat-amt">${esc(money(v, cur))}</span></li>`).join('')}</ul>` : ''}
    ${list.length || earlier.length ? `<details class="fold" data-fold="tx" ${ui.open.tx ? 'open' : ''}>
      <summary><span class="fold-label">${ui.open.tx ? 'Hide' : 'Show'} transactions</span><span class="muted small">${list.length} this month${earlier.length ? ` · ${earlier.length} earlier` : ''}</span><span class="chev" aria-hidden="true"></span></summary>
      ${list.length ? `<ul class="list">${list.map((x) => expenseRow(x, cur)).join('')}</ul>` : empty('No spending logged this month yet.')}
      ${earlier.length ? `<details class="fold inner" data-fold="txEarlier" ${ui.open.txEarlier ? 'open' : ''}><summary><span class="fold-label">Earlier</span><span class="muted small">${earlier.length}</span><span class="chev" aria-hidden="true"></span></summary><ul class="list">${earlier.map((x) => expenseRow(x, cur)).join('')}</ul></details>` : ''}
    </details>` : empty('No spending logged this month yet.')}
    <div class="add-row">
    <details class="add-exp"><summary class="btn-ghost sm">+ Cash or other spending</summary>
      <form class="stack-form" data-form="expense">
        <div class="field-row">
          <label>What / where<input name="merchant" required placeholder="e.g. Hawker lunch" autocomplete="off"></label>
          <label>Amount<input name="amount" type="number" step="0.01" min="0.01" required inputmode="decimal"></label>
        </div>
        <div class="field-row">
          <label>Category<select name="category">${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label>Date<input name="date" type="date" value="${isoDay()}" required></label>
        </div>
        <button class="btn">Add expense</button>
      </form>
    </details>
    <details class="add-exp"><summary class="btn-ghost sm">Paste a DBS alert</summary>
      <form class="stack-form" data-form="paste-alert">
        <label>Copy the text of a DBS alert (email, SMS or digibank notification) and paste it here<textarea name="alert" rows="4" required placeholder="Amount: SGD12.34&#10;From: DBS/POSB card ending 1234&#10;To: ..."></textarea></label>
        <button class="btn-ghost">Log it</button>
      </form>
    </details>
    </div>
  </section>`;
}

export function moneyView(s, mail = {}) {
  const cur = s.settings.currency;
  const m = monthSummary(s);
  const yearly = s.bills.reduce((sum, b) => sum + monthlyCost(b) * 12, 0);
  const incomes = [...s.income].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const bills = [...s.bills].sort((a, b) => (a.nextDue || '').localeCompare(b.nextDue || ''));

  return `<header class="page-head"><h1>Money</h1></header>
  <section class="card">
    <div class="stats">
      ${stat('Income this month', money(m.income, cur))}
      ${stat('Bills & subs / month', money(m.committed, cur))}
      ${stat('Saving / month', money(m.saving, cur))}
      ${stat('Spent so far', money(m.spent, cur))}
      ${stat('Left to spend', money(m.left, cur), m.left < 0 ? 'neg' : 'pos')}
    </div>
    ${m.income > 0 ? `<div class="split-bar" aria-hidden="true">
      <span class="seg seg-bills" data-w="${Math.min(100, (m.committed / m.income) * 100)}"></span>
      <span class="seg seg-save" data-w="${Math.min(100, (m.saving / m.income) * 100)}"></span>
      <span class="seg seg-spent" data-w="${Math.min(100, (m.spent / m.income) * 100)}"></span>
    </div>
    <div class="legend"><span><i class="seg-bills"></i>Bills & subs</span><span><i class="seg-save"></i>Savings</span><span><i class="seg-spent"></i>Spent</span><span><i class="seg-free"></i>Free</span></div>` : ''}
  </section>

  ${spendingCard(s, m, mail)}

  <div class="grid-2">
    <section class="card">
      <h2>Income</h2>
      <div class="stats two">
        ${stat('This month', money(m.income, cur))}
        ${stat(`Total ${new Date().getFullYear()}`, money(m.yearIncome, cur))}
      </div>
      <form class="stack-form spaced" data-form="income">
        <div class="field-row">
          <label>Source<input name="source" required placeholder="e.g. Salary"></label>
          <label>Amount<input name="amount" type="number" step="0.01" min="0" required inputmode="decimal"></label>
        </div>
        <div class="field-row">
          <label>Date<input name="date" type="date" value="${isoDay()}" required></label>
          <label class="check-label"><input type="checkbox" name="recurring" value="monthly"> Repeats monthly</label>
        </div>
        <button class="btn">Add income</button>
      </form>
      ${incomes.length ? `<ul class="list">${incomes.map((i) => `<li class="row"><div class="row-main">
        <div class="row-title">${esc(i.source)} <span class="muted">${esc(money(i.amount, cur))}</span></div>
        <div class="row-sub">${i.recurring === 'monthly' ? `Monthly since ${esc(fmtDay(parseDay(i.date)))}` : esc(fmtDay(parseDay(i.date)))}${i.fromEmail ? ' · from DBS alert' : ''}</div></div>
        <button class="btn-ghost sm danger" data-act="income-del" data-id="${esc(i.id)}" aria-label="Delete">✕</button></li>`).join('')}</ul>` : empty('No income logged yet.')}
    </section>

    <section class="card">
      <h2>Budgets &amp; savings</h2>
      <form class="stack-form" data-form="saving">
        <label>Name<input name="name" required placeholder="e.g. Emergency fund"></label>
        <div class="field-row">
          <label>Set aside / month<input name="monthly" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Amount"></label>
          <label>or % of income<input name="pct" type="number" step="0.5" min="0" max="100" inputmode="decimal" placeholder="e.g. 10"></label>
        </div>
        <div class="field-row">
          <label>Goal (optional)<input name="target" type="number" step="0.01" min="0" inputmode="decimal"></label>
          <label>Saved so far<input name="saved" type="number" step="0.01" min="0" value="0" inputmode="decimal"></label>
        </div>
        <button class="btn">Add budget</button>
      </form>
      ${s.savings.length ? `<ul class="list">${s.savings.map((g) => {
        const pct = g.target ? Math.min(100, (Number(g.saved) / Number(g.target)) * 100) : 0;
        const amt = budgetFor(g, m.income);
        const isPct = Number(g.pct) > 0;
        const isTithe = /^tithe$/i.test(g.name);
        // this month: amounts you logged here, plus (for Tithe) giving paid from your account
        const m0 = isoDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
        const logged = (g.log || []).filter((l) => l.date >= m0).reduce((sum, l) => sum + Number(l.amount), 0);
        const done = logged + (isTithe ? m.givenThisMonth : 0);
        const monthPct = amt > 0 ? Math.min(100, (done / amt) * 100) : 0;
        return `<li class="row col ${isTithe ? 'tithe' : ''}"><div class="row-head"><div class="row-main">
          <div class="row-title">${esc(g.name)}${isPct ? ` <span class="tag">${esc(g.pct)}% of income</span>` : ''}</div>
          <div class="row-sub">${esc(money(amt, cur))} this month${isPct && !m.income ? ' (add your income to work this out)' : ''} · ${isTithe ? 'given' : 'set aside'} ${esc(money(done, cur))}${done >= amt && amt > 0 ? ' ✓' : ''}</div>
          ${g.target ? `<div class="row-sub">Saved ${esc(money(g.saved, cur))} of ${esc(money(g.target, cur))}</div>` : !isTithe && Number(g.saved) ? `<div class="row-sub">Saved in total ${esc(money(g.saved, cur))}</div>` : ''}</div>
          <button class="btn-ghost sm danger" data-act="saving-del" data-id="${esc(g.id)}" aria-label="Delete">✕</button></div>
          ${amt > 0 ? `<div class="progress" title="This month"><span data-w="${monthPct}"></span></div>` : ''}
          ${g.target ? `<div class="progress thin"><span class="alt" data-w="${pct}"></span></div>` : ''}
          ${isTithe ? `<p class="muted small">Paid by PayNow or card? Set that payment's category to "Tithe &amp; giving" and it counts here automatically (and isn't counted as spending).</p>` : ''}
          <form class="inline-form" data-form="deposit" data-id="${esc(g.id)}">
            <input name="amount" type="number" step="0.01" placeholder="${/^tithe$/i.test(g.name) ? 'Log an amount given' : 'Amount (minus to withdraw)'}" required inputmode="decimal">
            <button class="btn-ghost">Log</button>
          </form></li>`;
      }).join('')}</ul>` : empty('No budgets yet.')}
    </section>
  </div>

  <section class="card">
    <h2>Bills & subscriptions <span class="muted small">${esc(money(m.committed, cur))}/month · ${esc(money(yearly, cur))}/year</span></h2>
    <form class="stack-form" data-form="bill">
      <div class="field-row four">
        <label>Name<input name="name" required placeholder="e.g. Spotify"></label>
        <label>Amount<input name="amount" type="number" step="0.01" min="0" required inputmode="decimal"></label>
        <label>Every<select name="cycle"><option value="monthly">Month</option><option value="yearly">Year</option><option value="weekly">Week</option></select></label>
        <label>Next due<input name="nextDue" type="date" value="${isoDay()}" required></label>
      </div>
      <div class="field-row">
        <label>Type<select name="kind"><option value="subscription">Subscription</option><option value="bill">Bill</option></select></label>
        <div class="end"><button class="btn">Add</button></div>
      </div>
    </form>
    ${bills.length ? `<table class="table"><thead><tr><th>Name</th><th>Type</th><th>Amount</th><th>Next due</th><th></th></tr></thead><tbody>
      ${bills.map((b) => {
        const d = parseDay(b.nextDue);
        const late = d < startOfDay();
        return `<tr><td>${esc(b.name)}</td><td><span class="tag ${b.kind === 'bill' ? 'tag-bill' : ''}">${b.kind === 'bill' ? 'Bill' : 'Sub'}</span></td>
          <td>${esc(money(b.amount, cur))}<span class="muted"> /${b.cycle === 'weekly' ? 'wk' : b.cycle === 'yearly' ? 'yr' : 'mo'}</span></td>
          <td class="${late ? 'late' : ''}">${esc(fmtDay(d))}</td>
          <td class="actions"><button class="btn-ghost sm" data-act="bill-paid" data-id="${esc(b.id)}">Paid</button>
          <button class="btn-ghost sm danger" data-act="bill-del" data-id="${esc(b.id)}" aria-label="Delete">✕</button></td></tr>`;
      }).join('')}</tbody></table>` : empty('No bills or subscriptions logged yet.')}
  </section>`;
}

// ---------- TASKS ----------
export function tasksView(s, cal, plan = {}) {
  const open = s.tasks.filter((t) => !t.done);
  const dated = open.filter((t) => t.due).sort((a, b) => parseDT(a.due) - parseDT(b.due));
  const undated = open.filter((t) => !t.due);
  const done = s.tasks.filter((t) => t.done).slice(-15).reverse();
  return `<header class="page-head"><h1>To-dos & reminders</h1></header>
  <section class="card">
    <form class="stack-form" data-form="task">
      <label>What needs doing?<input name="title" required autocomplete="off"></label>
      <div class="field-row">
        <label>Due<input name="due" type="datetime-local"></label>
        <label>How long?<select name="mins">${DURATIONS.map((m) => `<option value="${m}" ${m === 30 ? 'selected' : ''}>${esc(durLabel(m))}</option>`).join('')}</select></label>
      </div>
      <label class="check-label"><input type="checkbox" name="remind" checked> Remind me</label>
      <label>Notes<textarea name="notes" rows="2"></textarea></label>
      ${cal.connected ? `<label class="check-label"><input type="checkbox" name="toCal" checked> Also add to Google Calendar (so your phone reminds you even when this app is closed)</label>` : ''}
      <button class="btn">Add to-do</button>
    </form>
  </section>
  ${suggestionsCard(s, cal, plan)}
  <section class="card"><h2>Upcoming</h2>${dated.length ? `<ul class="list">${dated.map((t) => taskRow(t)).join('')}</ul>` : empty('Nothing scheduled.')}</section>
  ${undated.length ? `<section class="card"><h2>Anytime</h2><ul class="list">${undated.map((t) => taskRow(t)).join('')}</ul></section>` : ''}
  ${done.length ? `<section class="card"><details><summary>Recently done (${done.length})</summary><ul class="list">${done.map((t) => taskRow(t)).join('')}</ul>
    <button class="btn-ghost sm" data-act="tasks-clear-done">Clear done</button></details></section>` : ''}`;
}

// ---------- TRAINING ----------
// Shown instead of a calendar picker when Google hasn't allowed the app to see your calendar list yet.
function calendarAccessNote(cal) {
  if (!cal.connected || (cal.calendars || []).length) return '';
  return `<div class="notice"><p>${cal.canList ? "Couldn't load your calendars." : 'To choose which calendar, Google needs to let the app see your list of calendars (names only).'} Until then, events go to your main calendar.</p>
    <button type="button" class="btn-ghost sm" data-act="${cal.canList ? 'gcal-refresh' : 'gcal-allow-list'}">${cal.canList ? 'Try again' : 'Allow'}</button></div>`;
}

// Options for a calendar <select>: your calendars, main one first, `chosen` selected (else the main one).
function calendarOptions(cal, chosen) {
  const list = cal.calendars || [];
  const pick = list.some((c) => c.id === chosen) ? chosen : (list.find((c) => c.primary) || list[0])?.id;
  return list.map((c) => `<option value="${esc(c.id)}" ${c.id === pick ? 'selected' : ''}>${esc(c.primary ? `${c.name} (main)` : c.name)}</option>`).join('');
}

const LENGTHS = [30, 45, 60, 90, 120, 180, 240];
const lengthLabel = (m) => (m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`.replace('1.5 hrs', '1½ hrs'));
const sessionWhen = (x) => { const d = sessionStart(x); return d ? fmtDT(d, hasTime(x.date)) : 'No date'; };
const longDate = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

// "Who is being trained?": a drop-down list of your trainees with tick boxes, plus "add a new trainee".
function traineePicker(trainees) {
  return `<div class="field"><span class="field-label" id="who-label">Who is being trained?</span>
    <details class="picker" data-picker aria-labelledby="who-label">
      <summary><span data-picker-text>Choose trainees</span><span class="chev" aria-hidden="true"></span></summary>
      <div class="picker-body">
        <div class="picker-list">${trainees.map((t) => `<label class="check-label"><input type="checkbox" name="traineeIds" value="${esc(t.id)}"> ${esc(t.name)}</label>`).join('')}</div>
        <p class="muted small picker-empty" ${trainees.length ? 'hidden' : ''}>No trainees yet. Add one below.</p>
        <div class="inline-form"><input data-new-trainee placeholder="Add a new trainee" aria-label="New trainee's name" autocomplete="off">
          <button type="button" class="btn-ghost sm" data-act="trainee-quick-add">Add</button></div>
      </div>
    </details></div>`;
}

function sessionRow(x, mode, names) {
  const who = (x.traineeIds || []);
  const start = sessionStart(x);
  const timed = hasTime(x.date);
  const dateInput = (name, val) => `<input name="${name}" type="${timed ? 'datetime-local' : 'date'}" value="${esc(val || '')}" required>`;
  return `<li class="row col session">
    <div class="row-head"><div class="row-main">
      <div class="row-title">${esc(x.title)}</div>
      <div class="row-sub ${mode === 'log' ? 'late' : ''}">${esc(sessionWhen(x))}${timed ? ` · ${esc(lengthLabel(Number(x.durationMin) || 60))}` : ''}${x.gcal?.eventId ? ' · in Google Calendar' : ''}</div>
      ${who.length ? `<div class="chips">${who.map((id) => `<span class="tag">${esc(names[id] || 'Removed trainee')}</span>`).join('')}</div>` : ''}
      ${x.description ? `<div class="row-note">${esc(x.description)}</div>` : ''}
      ${x.notes ? `<div class="row-note"><strong>Notes:</strong> ${esc(x.notes)}</div>` : ''}
    </div>
    <button class="btn-ghost sm danger" data-act="session-del" data-id="${esc(x.id)}" aria-label="Delete training">✕</button></div>
    <div class="row-actions wrap">
      <details class="inline"><summary class="btn sm">✓ Log as covered</summary>
        <form class="stack-form" data-form="session-done" data-id="${esc(x.id)}">
          ${who.length ? `<fieldset class="attend"><legend>Who was there?</legend>${who.map((id) => `<label class="check-label"><input type="checkbox" name="attended" value="${esc(id)}" checked> ${esc(names[id] || 'Removed trainee')}</label>`).join('')}</fieldset>` : ''}
          <label>Date taught${dateInput('date', x.date)}</label>
          <label>What did you cover? (optional)<textarea name="doneNote" rows="2"></textarea></label>
          <button class="btn sm">Save to log</button>
        </form></details>
      ${mode === 'log' ? `<button class="btn-ghost sm" data-act="session-cancel" data-id="${esc(x.id)}">Didn't happen</button>` : ''}
      ${mode === 'upcoming' && timed && !x.gcal?.eventId ? `<button class="btn-ghost sm" data-act="session-gcal" data-id="${esc(x.id)}">+ Google Cal</button>` : ''}
      ${mode === 'upcoming' && start ? `<button class="btn-ghost sm" data-act="session-ics" data-id="${esc(x.id)}">.ics</button>` : ''}
      ${mode === 'upcoming' ? `<details class="inline"><summary class="btn-ghost sm">Reschedule</summary>
        <form class="inline-form" data-form="session-resched" data-id="${esc(x.id)}">${dateInput('date', x.date)}<button class="btn sm">Save</button></form></details>` : ''}
    </div>
  </li>`;
}

export function trainingView(s, cal = {}) {
  const now = new Date();
  const calOk = cal.connected && (cal.calendars || []).length > 0;
  const trainingDefault = s.settings.trainingCalendarId || s.settings.calendarId;
  const all = s.sessions || [];
  const active = (s.trainees || []).filter((t) => !t.archived).sort((a, b) => a.name.localeCompare(b.name));
  const names = Object.fromEntries((s.trainees || []).map((t) => [t.id, t.name]));
  const toLog = all.filter((x) => needsLogging(x, now)).sort((a, b) => sessionStart(a) - sessionStart(b));
  const upcomingList = all.filter((x) => isUpcoming(x, now)).sort((a, b) => (sessionStart(a) || Infinity) - (sessionStart(b) || Infinity));
  const history = all.filter((x) => x.status === 'done').sort((a, b) => sessionStart(b) - sessionStart(a));
  const prog = progress(s, now);

  return `<header class="page-head"><h1>Training</h1></header>
  ${cal.connected && !calOk ? `<section class="card">${calendarAccessNote(cal)}</section>` : ''}

  <section class="card">
    <details class="fold" data-fold="newTraining" ${ui.open.newTraining ?? !all.length ? 'open' : ''}>
      <summary><span class="fold-label">+ New training</span><span class="chev" aria-hidden="true"></span></summary>
      <form class="stack-form spaced" data-form="session">
        <label>Title of training<input name="title" required autocomplete="off" placeholder="e.g. First aid: CPR"></label>
        <label>Description<textarea name="description" rows="2" placeholder="What this training covers"></textarea></label>
        ${traineePicker(active)}
        <div class="field-row">
          <label>Training date<input name="date" type="datetime-local" required></label>
          <label>Length<select name="durationMin">${LENGTHS.map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${esc(lengthLabel(m))}</option>`).join('')}</select></label>
        </div>
        <label>Notes<textarea name="notes" rows="2"></textarea></label>
        ${s.settings.googleClientId ? `<div class="gcal-row">
          <label class="check-label"><input type="checkbox" name="toCal" checked> Add to Google Calendar</label>
          ${calOk ? `<label class="inline-label">Calendar<select class="sm-select" name="calendarId">${calendarOptions(cal, trainingDefault)}</select></label>` : ''}
        </div>` : ''}
        <p class="hint">A date in the past is saved straight into the log as covered.</p>
        <button class="btn">Save training</button>
      </form>
    </details>
  </section>

  ${toLog.length ? `<section class="card"><h2>Did these happen?</h2>
    <p class="muted small">Log each one as covered (and who was there), or mark it as not happened.</p>
    <ul class="list">${toLog.map((x) => sessionRow(x, 'log', names)).join('')}</ul></section>` : ''}

  <section class="card"><h2>Upcoming</h2>
    ${upcomingList.length ? `<ul class="list">${upcomingList.map((x) => sessionRow(x, 'upcoming', names)).join('')}</ul>` : empty('No trainings planned.')}
  </section>

  <section class="card"><h2>Trainees' progress</h2>
    ${prog.length ? `<ul class="list">${prog.map(({ trainee: t, covered, next, last }) => `<li class="row col trainee">
      <div class="row-head"><div class="row-main">
        <div class="row-title">${esc(t.name)}</div>
        <div class="row-sub"><strong class="count">${covered.length}</strong> lesson${covered.length === 1 ? '' : 's'} covered${last ? ` · last ${esc(longDate(sessionStart(last)))}` : ''} · next: ${next ? `${esc(next.title)}, ${esc(sessionWhen(next))}` : 'none planned'}</div>
      </div>
      <button class="btn-ghost sm danger" data-act="trainee-remove" data-id="${esc(t.id)}" aria-label="Remove ${esc(t.name)}">✕</button></div>
      ${covered.length ? `<details class="fold inner" data-fold="log-${esc(t.id)}" ${ui.open[`log-${t.id}`] ? 'open' : ''}>
        <summary><span class="fold-label">Lesson log</span><span class="muted small">${covered.length}</span><span class="chev" aria-hidden="true"></span></summary>
        <ol class="log-list">${covered.map((x) => `<li><span class="log-date">${esc(longDate(sessionStart(x)))}</span><span class="log-what">${esc(x.title)}${x.doneNote ? `<span class="muted"> · ${esc(x.doneNote)}</span>` : ''}</span></li>`).join('')}</ol>
      </details>` : ''}
    </li>`).join('')}</ul>` : empty('No trainees yet.')}
    <form class="inline-form" data-form="trainee-add">
      <input name="name" required placeholder="Add a trainee" aria-label="Trainee's name" autocomplete="off"><button class="btn-ghost">Add</button>
    </form>
  </section>

  ${history.length ? `<section class="card"><details class="fold" data-fold="trainHistory" ${ui.open.trainHistory ? 'open' : ''}>
    <summary><span class="fold-label">All lessons covered</span><span class="muted small">${history.length}</span><span class="chev" aria-hidden="true"></span></summary>
    <ol class="log-list">${history.map((x) => `<li><span class="log-date">${esc(longDate(sessionStart(x)))}</span><span class="log-what">${esc(x.title)}
      <span class="muted"> · ${esc(attendees(x).map((id) => names[id] || 'Removed trainee').join(', ') || 'no one marked present')}${x.doneNote ? ` · ${esc(x.doneNote)}` : ''}</span></span>
      <button class="btn-ghost sm" data-act="session-undo" data-id="${esc(x.id)}" title="Move back to planned">Undo</button></li>`).join('')}</ol>
  </details></section>` : ''}`;
}

// ---------- CALENDAR ----------
function eventRow(e, cal) {
  const many = (cal.calendars || []).filter((c) => c.shown).length > 1;
  const when = e.allDay ? 'All day' : `${fmtTime(new Date(e.start))} – ${fmtTime(new Date(e.end))}`;
  return `<li class="row"><div class="dot dot-cal" ${e.color ? `data-color="${esc(e.color)}"` : ''}></div><div class="row-main">
    <div class="row-title">${esc(e.title)}</div><div class="row-sub">${esc(when)}${many && e.calendar ? ` · ${esc(e.calendar)}` : ''}</div></div></li>`;
}

function calendarPicker(s, cal) {
  const list = cal.calendars || [];
  if (!cal.connected) return '';
  if (!list.length) return calendarAccessNote(cal);
  const chosen = list.some((c) => c.id === s.settings.calendarId) ? s.settings.calendarId : (list.find((c) => c.primary) || list[0]).id;
  return `<label>Calendar<select name="calendarId">${list.map((c) => `<option value="${esc(c.id)}" ${c.id === chosen ? 'selected' : ''}>${esc(c.primary ? `${c.name} (main)` : c.name)}</option>`).join('')}</select>
    <span class="hint">Remembered, and also used when you send to-dos and trainings to Google Calendar.</span></label>`;
}

export function calendarView(s, cal) {
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  start.setMinutes(0, 0, 0);
  const startVal = `${isoDay(start)}T${String(start.getHours()).padStart(2, '0')}:00`;

  let body;
  if (!s.settings.googleClientId) {
    body = `<section class="card"><h2>Connect Google Calendar</h2>
      <p>To keep things private, this app talks to Google directly from your device using your own Google Cloud "Client ID". It's a one-time 5-minute setup (steps are in the README).</p>
      <button class="btn" data-act="goto" data-view="settings">Add Client ID in Settings</button></section>`;
  } else if (!cal.connected) {
    body = `<section class="card"><h2>Google Calendar</h2>
      <p class="muted">One Google sign-in covers Calendar, DBS spending import and sync. After the first time, it reconnects by itself when you unlock.</p>
      <button class="btn" data-act="gcal-connect">Connect Google</button></section>`;
  } else {
    const days = {};
    for (const e of cal.events) {
      const k = isoDay(new Date(e.start));
      (days[k] ||= []).push(e);
    }
    body = `<section class="card"><h2>Next 7 days</h2>
        <div class="btn-row">${'<button class="btn-ghost sm" data-act="gcal-refresh">Refresh</button>'} <button class="btn-ghost sm" data-act="google-disconnect">Disconnect Google</button></div>
      ${Object.keys(days).length ? Object.entries(days).map(([k, evs]) => `<h3>${esc(fmtDay(parseDay(k)))}</h3><ul class="list">${evs.map((e) => eventRow(e, cal)).join('')}</ul>`).join('') : empty('Nothing on your calendar this week.')}
    </section>`;
  }

  return `<header class="page-head"><h1>Calendar</h1></header>
  ${body}
  <section class="card"><h2>Add an event</h2>
    <form class="stack-form" data-form="event">
      <label>Title<input name="title" required autocomplete="off"></label>
      ${calendarPicker(s, cal)}
      <div class="field-row three">
        <label>Starts<input name="start" type="datetime-local" value="${startVal}" required></label>
        <label>Length<select name="duration"><option value="30">30 min</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="480">All day-ish (8h)</option></select></label>
        <label>Remind me<select name="reminder"><option value="10">10 min before</option><option value="30" selected>30 min before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label>
      </div>
      <label>Details<textarea name="description" rows="2"></textarea></label>
      <div class="btn-row">
        ${cal.connected ? '<button class="btn" name="target" value="gcal">Add to Google Calendar</button>' : ''}
        <button class="btn${cal.connected ? '-ghost' : ''}" name="target" value="ics">Download .ics file</button>
      </div>
    </form>
  </section>`;
}

// ---------- SETTINGS ----------
function syncCard(s, sync) {
  const on = s.settings.syncEnabled;
  let body;
  if (!s.settings.googleClientId) {
    body = `<p class="muted">Add your Google OAuth Client ID above first.</p>`;
  } else if (sync?.drive) {
    body = `<p class="sync-line">${sync.status === 'syncing' ? '<span class="pulse" aria-hidden="true"></span>Syncing…'
      : sync.status === 'ok' ? `<span class="dot dot-ok" aria-hidden="true"></span>Synced ${esc(fmtDT(new Date(sync.lastSynced)))}. Changes sync automatically while the app is open.`
      : sync.status === 'error' ? `Last sync failed: ${esc(sync.msg)}` : sync.status === 'needs-pass' ? 'Waiting for the passphrase from your other device.' : 'Connected.'}</p>
      <div class="btn-row"><button class="btn-ghost sm" data-act="sync-now">Sync now</button>
      <button class="btn-ghost sm" data-act="google-disconnect">Disconnect Google</button>
      ${on ? '<button class="btn-ghost sm danger" data-act="sync-off">Turn off sync</button>' : ''}</div>`;
  } else {
    body = `<p class="muted">${on ? 'Sync is on. Connect Google to send and fetch changes.' : 'Keep your phone and laptop in step using your own Google account.'}</p>
      <button class="btn" data-act="google-connect">${on ? 'Connect Google & sync' : 'Turn on sync'}</button>`;
  }
  return `<section class="card"><h2>Sync between devices</h2>
    ${body}
    <details class="setup"><summary class="muted">How it works &amp; setting up a new device</summary>
      <ul class="steps">
        <li>Your data is encrypted with your passphrase <strong>before</strong> it leaves this device, then kept in a hidden app-only folder in your Google Drive. Google stores only unreadable data, and the app can't see your other Drive files.</li>
        <li>One-time setup: in your Google Cloud project, enable the <strong>Google Drive API</strong> (APIs &amp; Services → Library).</li>
        <li><strong>New device:</strong> open the app, and on the first screen choose <em>"Already use it on another device? Get your data"</em>. Sign in with the same Google account and enter your passphrase.</li>
        <li>All your devices use the same passphrase. If you change it on one, the others will ask for the new one once.</li>
        <li>Changes made on both devices are combined. If the exact same item was edited on both before syncing, the latest device to sync keeps its version.</li>
      </ul>
    </details>
  </section>`;
}

export function settingsView(s, perm, sync = null) {
  const st = s.settings;
  return `<header class="page-head"><h1>Settings</h1></header>
  <section class="card"><h2>General</h2>
    <form class="stack-form" data-form="settings">
      <div class="field-row three">
        <label>Currency<input name="currency" value="${esc(st.currency)}" maxlength="3" pattern="[A-Za-z]{3}" required></label>
        <label>Morning brief at<select name="morningHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${Number(st.morningHour) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
        <label>Suggest to-do times from<select name="planStart">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${Number(st.planStart ?? 9) === h ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select></label>
        <label>until<select name="planEnd">${Array.from({ length: 24 }, (_, h) => h + 1).map((h) => `<option value="${h}" ${Number(st.planEnd ?? 22) === h ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}</select></label>
        <label>Auto-lock after<select name="autoLockMin">${[1, 5, 10, 30, 60].map((m) => `<option value="${m}" ${Number(st.autoLockMin) === m ? 'selected' : ''}>${m} min idle</option>`).join('')}</select></label>
      </div>
      <label>Google OAuth Client ID <span class="muted small">(for Calendar, DBS spending import and sync; see README)</span><input name="googleClientId" value="${esc(st.googleClientId)}" placeholder="xxxxxxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
      <button class="btn">Save settings</button>
    </form>
  </section>

  ${syncCard(s, sync)}

  <section class="card"><h2>Notifications</h2>
    <p class="muted">Reminders and the morning brief pop up while the app is open and unlocked. For reminders when the app is closed, tick "Also add to Google Calendar" on a to-do, and your phone's calendar will notify you.</p>
    <p>Status: <strong>${esc(perm)}</strong></p>
    ${perm === 'default' ? '<button class="btn" data-act="notif-enable">Turn on notifications</button>' : ''}
    ${perm === 'granted' ? '<button class="btn-ghost" data-act="brief-now">Send me the brief now</button>' : ''}
    ${perm === 'denied' ? '<p class="muted">Notifications are blocked. Allow them in your browser or phone settings for this site.</p>' : ''}
  </section>

  <section class="card"><h2>Backup file</h2>
    <p class="muted">An encrypted copy of everything, as a file. It's unreadable without your passphrase, so it's safe to keep anywhere. Useful as a backup even with sync on.</p>
    <div class="btn-row">
      <button class="btn-ghost" data-act="export">Export encrypted backup</button>
      <label class="btn-ghost file-btn">Import backup<input type="file" accept=".ctbackup,application/json" data-act="import" hidden></label>
    </div>
  </section>

  <section class="card"><h2>Security</h2>
    <form class="stack-form" data-form="passphrase">
      <div class="field-row">
        <label>New passphrase<input name="p1" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>Repeat<input name="p2" type="password" minlength="8" required autocomplete="new-password"></label>
      </div>
      <button class="btn-ghost">Change passphrase</button>
    </form>
    <div class="btn-row"><button class="btn" data-act="lock">Lock now</button></div>
  </section>

  <section class="card danger-zone"><h2>Erase this device</h2>
    <form class="inline-form" data-form="wipe">
      <input name="confirm" placeholder='Type "ERASE" to delete all data on this device' required autocomplete="off">
      <button class="btn danger">Erase</button>
    </form>
  </section>`;
}
