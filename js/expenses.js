// Turns DBS/POSB alert emails into expenses, and sorts expenses into categories.
// Pure functions only: no network, no storage. The raw email is never kept, only what's parsed out.

export const CATEGORIES = [
  'Food & drinks', 'Groceries', 'Transport', 'Shopping', 'Subscriptions & bills', 'Health',
  'Entertainment', 'Tithe & giving', 'Transfers to others', 'Moved to own account', 'Already in Bills list', 'Other',
];

// Not counted as day-to-day spending: money that stays yours, bills already counted in Bills & subscriptions,
// and giving, which counts towards your Tithe budget instead.
export const NOT_SPENDING = new Set(['Moved to own account', 'Already in Bills list', 'Tithe & giving']);
export const GIVING = 'Tithe & giving';

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

// HTML or plain email body -> plain text, one label per line.
export function toText(body) {
  return String(body || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function cleanMerchant(raw) {
  let m = String(raw || '')
    .replace(/\((?:mobile|uen|nric|a\/c|account)[^)]*\)/gi, '')   // "(Mobile ending 1234)"
    .replace(/\b(?:mobile|a\/c|account) (?:no\.? )?ending \d+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // drop trailing city/country codes card networks append: "KOPITIAM SINGAPORE SGP"
  for (let i = 0; i < 2; i++) m = m.replace(/\s+(?:SINGAPORE|SGP|SG|SIN)$/i, '').trim();
  return m || 'Unknown';
}

/**
 * Reads one DBS alert. Returns {amount, currency, merchant, via, when, incoming} or {skip: reason}.
 * incoming: true for money received (logged as income, payer in `merchant`).
 * Card alerts look like:
 *   Date & Time: 09 OCT 20:01 (SGT)
 *   Amount: SGD12.34
 *   From: DBS/POSB card ending 1234
 *   To: SOME MERCHANT SINGAPORE SGP
 * PayNow / transfer / PayLah! alerts use the same "Amount / From / To" labels.
 */
export function parseAlert(body, { subject = '', sender = '', sentAt = new Date() } = {}) {
  const text = toText(body);
  const all = `${subject}\n${text}`;

  if (/\b(declined|unsuccessful|was not successful|could not be completed)\b/i.test(all)) return { skip: 'declined' };
  if (/\b(refund(?:ed)?|reversal|cashback|rebate)\b/i.test(all)) return { skip: 'refund' };
  const incoming = /\b(you have received|received (?:a |an )?(?:paynow|transfer|payment|fund)|incoming (?:paynow|transfer|fund|payment)|has been credited|credited (?:to|into) your)\b/i.test(all);

  const amt = text.match(/Amount\s*:?\s*(S\$|[A-Z]{3})\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (!amt) return { skip: 'no amount' };
  const amount = Number(amt[2].replace(/,/g, ''));
  if (!(amount > 0)) return { skip: 'no amount' };
  const currency = amt[1].toUpperCase() === 'S$' ? 'SGD' : amt[1].toUpperCase();

  const to = text.match(/^To\s*:?\s*(.+)$/im);
  const from = text.match(/^From\s*:?\s*(.+)$/im)?.[1] || '';
  if (!to && !incoming) return { skip: 'no payee' };

  let via = 'transfer';
  if (/card/i.test(from)) via = 'card';
  else if (/paylah/i.test(`${from} ${sender} ${subject}`)) via = 'paylah';
  else if (/paynow/i.test(all)) via = 'paynow';

  // "09 OCT 20:01" has no year: pick the one that puts it closest to (not after) when the email was sent.
  let when = new Date(sentAt);
  const dt = text.match(/Date\s*(?:&|and)\s*Time\s*:?\s*(\d{1,2})\s*([A-Za-z]{3})[a-z]*\s*(\d{4})?,?\s+(\d{1,2}):(\d{2})/i);
  if (dt && MONTHS[dt[2].toUpperCase()] !== undefined) {
    const year = dt[3] ? Number(dt[3]) : sentAt.getFullYear();
    let d = new Date(year, MONTHS[dt[2].toUpperCase()], Number(dt[1]), Number(dt[4]), Number(dt[5]));
    if (!dt[3] && d - sentAt > 2 * 86_400_000) d = new Date(year - 1, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
    if (!Number.isNaN(d.getTime())) when = d;
  }

  if (incoming) {
    // payer: "From: NAME", or "from NAME" in the sentence
    const payer = from || text.match(/\bfrom\s+([A-Z][A-Z0-9 .&'-]{2,40})/)?.[1] || 'Money received';
    return { amount, currency, merchant: cleanMerchant(payer), via, when, incoming: true };
  }
  return { amount, currency, merchant: cleanMerchant(to[1]), via, when, incoming: false };
}

// ---------- categories ----------
const KEYWORDS = [
  ['Tithe & giving', /CHURCH|PARISH|CATHEDRAL|CHAPEL|MINISTR|TITHE|OFFERING|MISSION|GOSPEL|BIBLE/],
  ['Food & drinks', /GRAB\s*\*?\s*FOOD|GRABFOOD|FOODPANDA|DELIVEROO|MCDONALD|\bKFC\b|BURGER|SUBWAY|STARBUCKS|COFFEE|KOPI|TOAST\s*BOX|YA\s*KUN|BAKERY|BREAD|CAFE|RESTAURANT|KITCHEN|DINING|FOOD|HAWKER|BBQ|SUSHI|RAMEN|PIZZA|BUBBLE|\bTEA\b|CHICKEN|NOODLE|BISTRO|EATERY|JOLLIBEE|DIN TAI|LIHO|\bKOI\b|GONG CHA|MR BEAN|OLD CHANG|PRATA/],
  ['Groceries', /NTUC|FAIRPRICE|FAIR PRICE|COLD STORAGE|SHENG SIONG|GIANT|DON DON DONKI|DONKI|PRIME SUPERMARKET|SUPERMARKET|MARKET PLACE|REDMART|7-ELEVEN|7 ELEVEN|CHEERS/],
  ['Transport', /GRAB|GOJEK|TADA|RYDE|COMFORT|\bCDG\b|\bZIG\b|SMRT|\bSBS\b|TRANSIT|EZ-?LINK|SIMPLYGO|\bBUS\b|\bMRT\b|\bSHELL\b|\bESSO\b|CALTEX|\bSPC\b|PARKING|CARPARK|\bLTA\b|TAXI/],
  ['Subscriptions & bills', /NETFLIX|SPOTIFY|DISNEY|YOUTUBE|APPLE\.COM|ITUNES|GOOGLE\s*\*|ICLOUD|SINGTEL|STARHUB|\bM1\b|CIRCLES|SIMBA|GIGA|SP DIGITAL|SP SERVICES|SP GROUP|TOWN COUNCIL|INSURANCE|PRUDENTIAL|\bAIA\b|GREAT EASTERN|INCOME INSURANCE|CHATGPT|OPENAI|ANTHROPIC|CLAUDE/],
  ['Health', /GUARDIAN|WATSONS|UNITY|PHARMACY|CLINIC|MEDICAL|DENTAL|HOSPITAL|POLYCLINIC|RAFFLES MEDICAL|GYM|FITNESS|ACTIVESG|ANYTIME FITNESS/],
  ['Entertainment', /GOLDEN VILLAGE|\bGV\b|SHAW|CATHAY|STEAM|PLAYSTATION|NINTENDO|XBOX|TIMEZONE|KARAOKE|TEO HENG|SISTIC|KLOOK|TICKET/],
  ['Shopping', /SHOPEE|LAZADA|AMAZON|TAOBAO|QOO10|UNIQLO|H&M|ZARA|IKEA|DAISO|MUJI|COURTS|CHALLENGER|HARVEY NORMAN|BEST DENKI|DECATHLON|POPULAR|KINOKUNIYA|SEPHORA|CHARLES|PEDRO|COTTON ON|TEMU|SHEIN/],
];

// What a merchant is "known as" for remembering your corrections: letters only, first 3 words.
export function merchantKey(m) {
  return String(m || '').toUpperCase().replace(/[^A-Z& ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ');
}

export function categorize(merchant, via, { rules = {}, bills = [] } = {}) {
  const key = merchantKey(merchant);
  if (key && rules[key]) return rules[key];
  const up = String(merchant || '').toUpperCase();
  for (const b of bills) {
    const words = String(b.name || '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4);
    if (words.some((w) => up.includes(w))) return 'Already in Bills list';
  }
  for (const [cat, re] of KEYWORDS) if (re.test(up)) return cat;
  if (via === 'paynow' || via === 'transfer' || via === 'paylah') return 'Transfers to others';
  return 'Other';
}
