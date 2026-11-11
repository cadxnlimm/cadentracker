// Merges two copies of your data (this device's and the synced one) using the last copy both agreed on
// ("base"). Whatever changed on only one side wins; deletions carry over; things added on either side
// are kept. If the same item was changed on both devices, this device's version wins.
// Pure functions: no network, no storage.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isRecordList = (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object' && typeof x.id === 'string');
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function pick(b, l, r) {
  if (same(l, r)) return clone(l);
  if (same(l, b)) return clone(r); // only the other device changed it
  return clone(l);                 // only this device changed it, or both did
}

function mergeRecords(base = [], local = [], remote = []) {
  const B = new Map(base.map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const ids = [...local.map((x) => x.id), ...remote.map((x) => x.id).filter((id) => !L.has(id))];
  const out = [];
  for (const id of ids) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) out.push(pick(b, l, r));
    else if (l) { if (!(b && same(b, l))) out.push(clone(l)); }  // missing remotely: deleted there unless changed/added here
    else if (r) { if (!(b && same(b, r))) out.push(clone(r)); }  // missing here: deleted here unless changed/added there
  }
  return out;
}

function mergeObject(base = {}, local = {}, remote = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const b = base?.[k], l = local[k], r = remote[k];
    if (k in local && k in remote) out[k] = isPlainObject(l) && isPlainObject(r) ? mergeObject(b, l, r) : pick(b, l, r);
    else if (k in local) { if (!(base && k in base && same(b, l))) out[k] = clone(l); }
    else if (!(base && k in base && same(b, r))) out[k] = clone(r);
  }
  return out;
}

// Things the merge would otherwise duplicate when both devices did the same job before syncing.
function tidy(s) {
  // the same DBS alert imported on both devices
  for (const key of ['expenses', 'income']) {
    if (!Array.isArray(s[key])) continue;
    const seen = new Set();
    s[key] = s[key].filter((x) => !x.msgId || (seen.has(x.msgId) ? false : seen.add(x.msgId)));
  }
  // the Tithe budget, added automatically on each device
  if (Array.isArray(s.savings)) {
    const tithes = s.savings.filter((g) => /^tithe$/i.test(g.name));
    if (tithes.length > 1) {
      const keep = tithes[0];
      for (const t of tithes.slice(1)) {
        keep.log = [...(keep.log || []), ...(t.log || [])];
        keep.saved = Math.round((Number(keep.saved) + Number(t.saved)) * 100) / 100;
      }
      s.savings = s.savings.filter((g) => g === keep || !tithes.includes(g));
    }
  }
  return s;
}

export function mergeState(base, local, remote) {
  if (!remote) return clone(local);
  base = base || {};
  const out = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[k], l = local[k], r = remote[k];
    if (k === 'expenseSync') {
      const seen = [...new Set([...(r?.seen || []), ...(l?.seen || [])])].slice(-2000);
      out[k] = { lastSync: Math.max(Number(l?.lastSync) || 0, Number(r?.lastSync) || 0), seen };
    } else if (l === undefined) out[k] = clone(r);
    else if (r === undefined) out[k] = clone(l);
    else if (isRecordList(l) && isRecordList(r)) out[k] = mergeRecords(b, l, r);
    else if (isPlainObject(l) && isPlainObject(r)) out[k] = mergeObject(b, l, r);
    else out[k] = pick(b, l, r);
  }
  return tidy(out);
}
