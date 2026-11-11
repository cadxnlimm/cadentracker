// Small helpers shared by the views.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const DAY = 86_400_000;

// "2026-11-11" -> local midnight (new Date("2026-11-11") would be UTC midnight)
export const parseDay = (s) => (s ? new Date(`${s}T00:00`) : null);
export const parseDT = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00` : s) : null);

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

export const isoDay = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const isoLocalDT = (d) => `${isoDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function money(n, currency = 'SGD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(n) || 0);
  } catch {
    return `${currency} ${(Number(n) || 0).toFixed(2)}`;
  }
}

export function fmtDay(d) {
  if (!d) return '';
  const today = startOfDay();
  const diff = Math.round((startOfDay(d) - today) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

export function fmtTime(d) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtDT(d, hasTime = true) {
  if (!d) return '';
  return hasTime ? `${fmtDay(d)}, ${fmtTime(d)}` : fmtDay(d);
}

// Bills: monthly-equivalent cost and moving the due date on once paid.
export function monthlyCost(bill) {
  const a = Number(bill.amount) || 0;
  return bill.cycle === 'weekly' ? (a * 52) / 12 : bill.cycle === 'yearly' ? a / 12 : a;
}

export function advanceDue(dayStr, cycle) {
  const d = parseDay(dayStr) || startOfDay();
  if (cycle === 'weekly') d.setDate(d.getDate() + 7);
  else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return isoDay(d);
}

export function download(filename, text, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());
