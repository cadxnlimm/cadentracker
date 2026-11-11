// Each view returns an HTML string. Every piece of user data passes through esc().
import { CATEGORIES, NOT_SPENDING, GIVING } from './expenses.js';
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

// ---------- sync status ----------
function syncChip(sync) {
  if (!sync) return '';
  if (sync.status === 'syncing') return `<span class="chip"><span class="pulse" aria-hidden="true"></span>Syncing…</span>`;
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
  if (!sync.google && (s.settings.syncEnabled || s.settings.googleClientId)) {
    return `<section class="card banner"><div><h2>${s.settings.syncEnabled ? 'Sync with your other devices' : 'Connect Google'}</h2>
      <p class="muted">One tap ${s.settings.syncEnabled ? 'syncs your phone and laptop, ' : ''}imports new DBS spending and shows your calendar. Needed once each time you unlock.</p></div>
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
      ${stat('Spent so far', money(m.spent, cur))}
      ${stat('Left to spend', money(m.left, cur), m.left < 0 ? 'neg' : 'pos')}
    </div>

  </section>`;
}

// ---------- MONEY ----------
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
    ${list.length ? `<ul class="list">${list.map((x) => expenseRow(x, cur)).join('')}</ul>` : empty('No spending logged this month yet.')}
    ${earlier.length ? `<details><summary class="muted">Earlier (${earlier.length})</summary><ul class="list">${earlier.map((x) => expenseRow(x, cur)).join('')}</ul></details>` : ''}
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
      <p class="muted">One Google sign-in covers Calendar, DBS spending import and sync. It lasts about an hour and is never saved to disk; after locking the app, tap Connect again.</p>
      <button class="btn" data-act="gcal-connect">Connect Google</button></section>`;
  } else {
    const days = {};
    for (const e of cal.events) {
      const k = isoDay(new Date(e.start));
      (days[k] ||= []).push(e);
    }
    body = `<section class="card"><div class="row-head"><h2>Next 7 days</h2>
        <div><button class="btn-ghost sm" data-act="gcal-refresh">Refresh</button> <button class="btn-ghost sm" data-act="google-disconnect">Disconnect Google</button></div></div>
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
