// Each view returns an HTML string. Every piece of user data passes through esc().
import { esc, money, fmtDay, fmtDT, fmtTime, parseDay, parseDT, startOfDay, sameDay, isoDay, DAY, monthlyCost } from './util.js';

const hasTime = (s) => !!s && s.length > 10;

// ---------- shared calculations ----------
export function monthSummary(s) {
  const now = new Date();
  const m0 = new Date(now.getFullYear(), now.getMonth(), 1);
  const m1 = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const income = s.income.reduce((sum, i) => {
    const d = parseDay(i.date);
    if (!d) return sum;
    if (i.recurring === 'monthly') return d < m1 ? sum + Number(i.amount) : sum;
    return d >= m0 && d < m1 ? sum + Number(i.amount) : sum;
  }, 0);
  const committed = s.bills.reduce((sum, b) => sum + monthlyCost(b), 0);
  const saving = s.savings.reduce((sum, g) => sum + (Number(g.monthly) || 0), 0);
  return { income, committed, saving, left: income - committed - saving };
}

export function upcoming(s, days = 7) {
  const today = startOfDay();
  const until = new Date(today.getTime() + days * DAY);
  const open = s.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && parseDT(t.due) < (hasTime(t.due) ? new Date() : today));
  const todayTasks = open.filter((t) => t.due && sameDay(parseDT(t.due), today) && !overdue.includes(t));
  const week = open.filter((t) => t.due && parseDT(t.due) >= new Date(today.getTime() + DAY) && parseDT(t.due) < until);
  const trainings = s.trainings
    .filter((t) => t.nextSession && parseDT(t.nextSession) >= today && parseDT(t.nextSession) < until)
    .sort((a, b) => parseDT(a.nextSession) - parseDT(b.nextSession));
  const bills = s.bills
    .filter((b) => b.nextDue && parseDay(b.nextDue) < until)
    .sort((a, b) => parseDay(a.nextDue) - parseDay(b.nextDue));
  const byDue = (a, b) => parseDT(a.due) - parseDT(b.due);
  return { overdue: overdue.sort(byDue), todayTasks: todayTasks.sort(byDue), week: week.sort(byDue), trainings, bills };
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
      ${!compact && t.notes ? `<div class="row-note">${esc(t.notes)}</div>` : ''}
    </div>
    ${compact ? '' : `<div class="row-actions">
      ${due ? `<button class="btn-ghost sm" data-act="task-gcal" data-id="${esc(t.id)}" title="Add to Google Calendar">+ Cal</button>
      <button class="btn-ghost sm" data-act="task-ics" data-id="${esc(t.id)}" title="Download calendar file">.ics</button>` : ''}
      <button class="btn-ghost sm danger" data-act="task-del" data-id="${esc(t.id)}" aria-label="Delete">✕</button>
    </div>`}
  </li>`;
}

function trainingMini(t) {
  const d = parseDT(t.nextSession);
  return `<li class="row"><div class="dot dot-train"></div><div class="row-main">
    <div class="row-title">${esc(t.name)} · Lesson ${esc(t.currentLesson)}${t.totalLessons ? ` of ${esc(t.totalLessons)}` : ''}</div>
    <div class="row-sub">${esc(fmtDT(d, hasTime(t.nextSession)))}${t.trainees ? ` · ${esc(t.trainees)}` : ''}</div></div></li>`;
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

// ---------- TODAY (morning brief) ----------
export function today(s, cal) {
  const u = upcoming(s);
  const m = monthSummary(s);
  const cur = s.settings.currency;
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const todayEvents = (cal.events || []).filter((e) => sameDay(new Date(e.start), new Date()));

  return `<header class="page-head"><div><p class="eyebrow">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    <h1>${greet}, Caden</h1></div></header>

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
          ? `<ul class="list">${todayEvents.map((e) => `<li class="row"><div class="dot dot-cal"></div><div class="row-main"><div class="row-title">${esc(e.title)}</div><div class="row-sub">${e.allDay ? 'All day' : `${esc(fmtTime(new Date(e.start)))} – ${esc(fmtTime(new Date(e.end)))}`}</div></div></li>`).join('')}</ul>`
          : empty('No events today.'))
        : `<p class="muted">Connect Google Calendar to see today's events here.</p><button class="btn-ghost" data-act="gcal-connect">Connect Google Calendar</button>`}
    </section>
  </div>

  <section class="card">
    <h2>This week</h2>
    <div class="grid-3">
      <div><h3>To-dos</h3>${u.week.length ? `<ul class="list">${u.week.map((t) => taskRow(t, { compact: true })).join('')}</ul>` : empty('Clear week.')}</div>
      <div><h3>Trainings</h3>${u.trainings.length ? `<ul class="list">${u.trainings.map(trainingMini).join('')}</ul>` : empty('No sessions scheduled.')}</div>
      <div><h3>Bills due</h3>${u.bills.length ? `<ul class="list">${u.bills.map((b) => billMini(b, cur)).join('')}</ul>` : empty('Nothing due.')}</div>
    </div>
  </section>

  <section class="card">
    <h2>Money this month</h2>
    <div class="stats">
      ${stat('Income', money(m.income, cur))}
      ${stat('Bills & subs', money(m.committed, cur))}
      ${stat('Set aside to save', money(m.saving, cur))}
      ${stat('Left to spend', money(m.left, cur), m.left < 0 ? 'neg' : 'pos')}
    </div>
  </section>`;
}

// ---------- MONEY ----------
export function moneyView(s) {
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
      ${stat('Left to spend', money(m.left, cur), m.left < 0 ? 'neg' : 'pos')}
    </div>
    ${m.income > 0 ? `<div class="split-bar" aria-hidden="true">
      <span class="seg seg-bills" data-w="${Math.min(100, (m.committed / m.income) * 100)}"></span>
      <span class="seg seg-save" data-w="${Math.min(100, (m.saving / m.income) * 100)}"></span>
    </div>
    <div class="legend"><span><i class="seg-bills"></i>Bills & subs</span><span><i class="seg-save"></i>Savings</span><span><i class="seg-free"></i>Free</span></div>` : ''}
  </section>

  <div class="grid-2">
    <section class="card">
      <h2>Income</h2>
      <form class="stack-form" data-form="income">
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
        <div class="row-sub">${i.recurring === 'monthly' ? `Monthly since ${esc(fmtDay(parseDay(i.date)))}` : esc(fmtDay(parseDay(i.date)))}</div></div>
        <button class="btn-ghost sm danger" data-act="income-del" data-id="${esc(i.id)}" aria-label="Delete">✕</button></li>`).join('')}</ul>` : empty('No income logged yet.')}
    </section>

    <section class="card">
      <h2>Savings budgets</h2>
      <form class="stack-form" data-form="saving">
        <div class="field-row">
          <label>Name<input name="name" required placeholder="e.g. Emergency fund"></label>
          <label>Set aside / month<input name="monthly" type="number" step="0.01" min="0" required inputmode="decimal"></label>
        </div>
        <div class="field-row">
          <label>Goal (optional)<input name="target" type="number" step="0.01" min="0" inputmode="decimal"></label>
          <label>Saved so far<input name="saved" type="number" step="0.01" min="0" value="0" inputmode="decimal"></label>
        </div>
        <button class="btn">Add budget</button>
      </form>
      ${s.savings.length ? `<ul class="list">${s.savings.map((g) => {
        const pct = g.target ? Math.min(100, (Number(g.saved) / Number(g.target)) * 100) : 0;
        return `<li class="row col"><div class="row-head"><div class="row-main">
          <div class="row-title">${esc(g.name)}</div>
          <div class="row-sub">${esc(money(g.monthly, cur))}/month · saved ${esc(money(g.saved, cur))}${g.target ? ` of ${esc(money(g.target, cur))}` : ''}</div></div>
          <button class="btn-ghost sm danger" data-act="saving-del" data-id="${esc(g.id)}" aria-label="Delete">✕</button></div>
          ${g.target ? `<div class="progress"><span data-w="${pct}"></span></div>` : ''}
          <form class="inline-form" data-form="deposit" data-id="${esc(g.id)}">
            <input name="amount" type="number" step="0.01" placeholder="Amount (negative to withdraw)" required inputmode="decimal">
            <button class="btn-ghost">Log</button>
          </form></li>`;
      }).join('')}</ul>` : empty('No savings budgets yet.')}
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
export function tasksView(s, cal) {
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
        <label class="check-label"><input type="checkbox" name="remind" checked> Remind me</label>
      </div>
      <label>Notes<textarea name="notes" rows="2"></textarea></label>
      ${cal.connected ? `<label class="check-label"><input type="checkbox" name="toCal" checked> Also add to Google Calendar (so your phone reminds you even when this app is closed)</label>` : ''}
      <button class="btn">Add to-do</button>
    </form>
  </section>
  <section class="card"><h2>Upcoming</h2>${dated.length ? `<ul class="list">${dated.map((t) => taskRow(t)).join('')}</ul>` : empty('Nothing scheduled.')}</section>
  ${undated.length ? `<section class="card"><h2>Anytime</h2><ul class="list">${undated.map((t) => taskRow(t)).join('')}</ul></section>` : ''}
  ${done.length ? `<section class="card"><details><summary>Recently done (${done.length})</summary><ul class="list">${done.map((t) => taskRow(t)).join('')}</ul>
    <button class="btn-ghost sm" data-act="tasks-clear-done">Clear done</button></details></section>` : ''}`;
}

// ---------- TRAINING ----------
export function trainingView(s) {
  const list = [...s.trainings].sort((a, b) => (a.nextSession || '9999').localeCompare(b.nextSession || '9999'));
  return `<header class="page-head"><h1>Training tracker</h1></header>
  <section class="card">
    <details ${list.length ? '' : 'open'}><summary class="btn-ghost">+ New training programme</summary>
    <form class="stack-form" data-form="training">
      <div class="field-row">
        <label>Training name<input name="name" required placeholder="e.g. First aid course"></label>
        <label>Group / trainees<input name="trainees" placeholder="e.g. Platoon 2"></label>
      </div>
      <div class="field-row three">
        <label>Total lessons<input name="totalLessons" type="number" min="1" inputmode="numeric"></label>
        <label>Current lesson<input name="currentLesson" type="number" min="1" value="1" required inputmode="numeric"></label>
        <label>Next session<input name="nextSession" type="datetime-local"></label>
      </div>
      <label>Notes<textarea name="notes" rows="2"></textarea></label>
      <button class="btn">Add training</button>
    </form></details>
  </section>
  ${list.length ? `<div class="cards">${list.map((t) => {
    const total = Number(t.totalLessons) || 0;
    const cur = Number(t.currentLesson) || 1;
    const finished = total && cur > total;
    const pct = total ? Math.min(100, ((cur - 1) / total) * 100) : 0;
    const next = parseDT(t.nextSession);
    return `<article class="card training">
      <div class="row-head"><div><h2>${esc(t.name)}</h2>${t.trainees ? `<p class="muted">${esc(t.trainees)}</p>` : ''}</div>
        <button class="btn-ghost sm danger" data-act="training-del" data-id="${esc(t.id)}" aria-label="Delete">✕</button></div>
      <div class="lesson-line"><span class="big">${finished ? 'Completed' : `Lesson ${esc(cur)}`}</span>${total ? `<span class="muted">of ${esc(total)}</span>` : ''}</div>
      ${total ? `<div class="progress"><span data-w="${finished ? 100 : pct}"></span></div>` : ''}
      <p class="next ${next && next < new Date() ? 'late' : ''}">Next session: <strong>${next ? esc(fmtDT(next, hasTime(t.nextSession))) : 'not set'}</strong></p>
      ${t.notes ? `<p class="row-note">${esc(t.notes)}</p>` : ''}
      ${finished ? '' : `<details><summary class="btn">Lesson ${esc(cur)} done →</summary>
        <form class="stack-form" data-form="lesson-done" data-id="${esc(t.id)}">
          <label>How did it go? (optional)<input name="note" autocomplete="off"></label>
          <label>Next session${total && cur + 1 > total ? ' (not needed, this was the last lesson)' : ''}<input name="nextSession" type="datetime-local"></label>
          <button class="btn">Save & move to lesson ${esc(cur + 1)}</button>
        </form></details>`}
      <div class="row-actions wrap">
        ${next ? `<button class="btn-ghost sm" data-act="training-gcal" data-id="${esc(t.id)}">+ Google Cal</button>
        <button class="btn-ghost sm" data-act="training-ics" data-id="${esc(t.id)}">.ics</button>` : ''}
        <details class="inline"><summary class="btn-ghost sm">Reschedule</summary>
          <form class="inline-form" data-form="training-resched" data-id="${esc(t.id)}">
            <input name="nextSession" type="datetime-local" value="${esc(t.nextSession || '')}" required><button class="btn-ghost sm">Save</button>
          </form></details>
      </div>
      ${t.log?.length ? `<details><summary class="muted">History (${t.log.length})</summary><ul class="log">${[...t.log].reverse().map((l) => `<li><strong>Lesson ${esc(l.lesson)}</strong> · ${esc(fmtDay(parseDay(l.date)))}${l.note ? ` · ${esc(l.note)}` : ''}</li>`).join('')}</ul></details>` : ''}
    </article>`;
  }).join('')}</div>` : ''}`;
}

// ---------- CALENDAR ----------
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
      <p class="muted">Sign-in lasts about an hour and is never saved to disk. You'll reconnect after locking the app.</p>
      <button class="btn" data-act="gcal-connect">Connect Google Calendar</button></section>`;
  } else {
    const days = {};
    for (const e of cal.events) {
      const k = isoDay(new Date(e.start));
      (days[k] ||= []).push(e);
    }
    body = `<section class="card"><div class="row-head"><h2>Next 7 days</h2>
        <div><button class="btn-ghost sm" data-act="gcal-refresh">Refresh</button> <button class="btn-ghost sm" data-act="gcal-disconnect">Disconnect</button></div></div>
      ${Object.keys(days).length ? Object.entries(days).map(([k, evs]) => `<h3>${esc(fmtDay(parseDay(k)))}</h3><ul class="list">${evs.map((e) => `<li class="row"><div class="dot dot-cal"></div><div class="row-main">
        <div class="row-title">${esc(e.title)}</div><div class="row-sub">${e.allDay ? 'All day' : `${esc(fmtTime(new Date(e.start)))} – ${esc(fmtTime(new Date(e.end)))}`}</div></div></li>`).join('')}</ul>`).join('') : empty('Nothing on your calendar this week.')}
    </section>`;
  }

  return `<header class="page-head"><h1>Calendar</h1></header>
  ${body}
  <section class="card"><h2>Add an event</h2>
    <form class="stack-form" data-form="event">
      <label>Title<input name="title" required autocomplete="off"></label>
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
export function settingsView(s, perm) {
  const st = s.settings;
  return `<header class="page-head"><h1>Settings</h1></header>
  <section class="card"><h2>General</h2>
    <form class="stack-form" data-form="settings">
      <div class="field-row three">
        <label>Currency<input name="currency" value="${esc(st.currency)}" maxlength="3" pattern="[A-Za-z]{3}" required></label>
        <label>Morning brief at<select name="morningHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${Number(st.morningHour) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
        <label>Auto-lock after<select name="autoLockMin">${[1, 5, 10, 30, 60].map((m) => `<option value="${m}" ${Number(st.autoLockMin) === m ? 'selected' : ''}>${m} min idle</option>`).join('')}</select></label>
      </div>
      <label>Google OAuth Client ID <span class="muted small">(for calendar; see README)</span><input name="googleClientId" value="${esc(st.googleClientId)}" placeholder="xxxxxxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
      <button class="btn">Save settings</button>
    </form>
  </section>

  <section class="card"><h2>Notifications</h2>
    <p class="muted">Reminders and the morning brief pop up while the app is open and unlocked. For reminders when the app is closed, tick "Also add to Google Calendar" on a to-do, and your phone's calendar will notify you.</p>
    <p>Status: <strong>${esc(perm)}</strong></p>
    ${perm === 'default' ? '<button class="btn" data-act="notif-enable">Turn on notifications</button>' : ''}
    ${perm === 'granted' ? '<button class="btn-ghost" data-act="brief-now">Send me the brief now</button>' : ''}
    ${perm === 'denied' ? '<p class="muted">Notifications are blocked. Allow them in your browser or phone settings for this site.</p>' : ''}
  </section>

  <section class="card"><h2>Phone ↔ laptop</h2>
    <p class="muted">Your data lives only on the device you entered it on. To move it, export an encrypted backup on one device and import it on the other. The file is unreadable without your passphrase, so it's safe to send via AirDrop, a USB drive or your own cloud storage.</p>
    <div class="btn-row">
      <button class="btn" data-act="export">Export encrypted backup</button>
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
