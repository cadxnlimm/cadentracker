// Run with: node tests/expenses.test.mjs  (sample alerts below use made-up values)
import { parseAlert, categorize, merchantKey, toText } from '../js/expenses.js';
import assert from 'node:assert/strict';
const sent = new Date(2026, 9, 9, 20, 2);
// 1. card alert, HTML with <br>
let r = parseAlert('<p>Transaction Ref: 123<br>Dear Sir / Madam,<br>We refer to your card transaction request dated 09/10/26.<br>Date &amp; Time: 09 OCT 20:01 (SGT)<br>Amount: SGD12.34<br>From: DBS/POSB card ending 1234<br>To: KOPITIAM SINGAPORE SGP<br></p>', { subject: 'Card Transaction Alert', sender: 'ibanking.alert@dbs.com', sentAt: sent });
assert.equal(r.amount, 12.34); assert.equal(r.currency, 'SGD'); assert.equal(r.merchant, 'KOPITIAM'); assert.equal(r.via, 'card');
assert.equal(r.when.getMonth(), 9); assert.equal(r.when.getDate(), 9); assert.equal(r.when.getHours(), 20);
// 2. table layout, comma amount, space after currency
r = parseAlert('<table><tr><td>Amount:</td><td>SGD 1,234.50</td></tr><tr><td>From:</td><td>DBS/POSB card ending 9999</td></tr><tr><td>To:</td><td>SHOPEE SINGAPORE</td></tr></table>', { sentAt: sent });
assert.equal(r.amount, 1234.5); assert.equal(r.merchant, 'SHOPEE');
// 3. year rollover: alert dated 31 DEC, email sent 2 Jan
r = parseAlert('Date & Time: 31 DEC 23:50 (SGT)\nAmount: SGD5.00\nFrom: DBS/POSB card ending 1\nTo: GRAB*FOOD', { sentAt: new Date(2027, 0, 2) });
assert.equal(r.when.getFullYear(), 2026);
// 4. PayNow outgoing
r = parseAlert('Date & Time: 10 NOV 09:15 (SGT)\nAmount: SGD20.00\nFrom: My Account A/C ending 1234\nTo: TAN AH KOW (Mobile ending 5678)\nvia PayNow', { subject: 'iBanking Alerts', sentAt: new Date(2026,10,10) });
assert.equal(r.via, 'paynow'); assert.equal(r.merchant, 'TAN AH KOW');
// 5. PayLah
r = parseAlert('Amount: SGD 4.50\nFrom: PayLah! Wallet (Mobile ending 1234)\nTo: TOAST BOX', { sender: 'paylah.alert@dbs.com', sentAt: sent });
assert.equal(r.via, 'paylah');
// 6. skips
assert.equal(parseAlert('Your OTP is 123456', {}).skip, 'no amount');
assert.equal(parseAlert('You have received SGD 50.00 via PayNow\nAmount: SGD50.00\nTo: My account', {}).skip, 'incoming');
assert.equal(parseAlert('Your transaction was declined\nAmount: SGD50.00\nTo: X', {}).skip, 'declined');
// 7. foreign currency
r = parseAlert('Amount: USD15.99\nFrom: DBS/POSB card ending 1\nTo: NETFLIX.COM LOS GATOS USA', { sentAt: sent });
assert.equal(r.currency, 'USD');
// categories
assert.equal(categorize('GRAB*FOOD', 'card'), 'Food & drinks');
assert.equal(categorize('GRAB* RIDES', 'card'), 'Transport');
assert.equal(categorize('STEAM GAMES', 'card'), 'Entertainment');
assert.equal(categorize('BUSINESS TIMES', 'card'), 'Other');
assert.equal(categorize('NTUC FP-BEDOK', 'card'), 'Groceries');
assert.equal(categorize('TAN AH KOW', 'paynow'), 'Transfers to others');
assert.equal(categorize('NETFLIX.COM', 'card', { bills: [{ name: 'Netflix' }] }), 'Already in Bills list');
assert.equal(categorize('NETFLIX.COM', 'card'), 'Subscriptions & bills');
assert.equal(categorize('KOPITIAM', 'card', { rules: { [merchantKey('KOPITIAM 123')]: 'Groceries' } }), 'Groceries');
console.log('all parser tests passed');
