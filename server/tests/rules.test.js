// Unit tests: order timeline (cutoff / weekend / closures), pricing (delivery fee + SST), credit-term eligibility
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv } from './helpers.js';

isolatedEnv();
const { orderWindow, processingDay, mytDate, dayName } = await import('../schedule.js');
const { computeTotals } = await import('../pricing.js');
const { addMonths, termStatus } = await import('../billing.js');

// Week of Monday 9 Nov 2026 (MYT)
const MON = '2026-11-09', TUE = '2026-11-10', WED = '2026-11-11', THU = '2026-11-12', FRI = '2026-11-13', SAT = '2026-11-14', SUN = '2026-11-15';
const NEXT_MON = '2026-11-16', NEXT_TUE = '2026-11-17', NEXT_WED = '2026-11-18';
const win = (date, time, closures = []) => orderWindow(mytDate(date, time), { closures: new Set(closures), maxDaysAhead: 30, cutoff: '13:00' });

test('timeline table: every row', () => {
  const rows = [
    ['Monday before 1 PM', MON, '10:00', WED],
    ['Tuesday before 1 PM', TUE, '10:00', THU],
    ['Wednesday before 1 PM', WED, '10:00', FRI],
    ['Thursday before 1 PM', THU, '10:00', SAT],
    ['Friday before 1 PM', FRI, '12:59', SUN],
    ['Friday after 1 PM', FRI, '13:00', NEXT_WED],
    ['Saturday', SAT, '09:00', NEXT_WED],
    ['Sunday', SUN, '18:00', NEXT_WED],
  ];
  for (const [label, date, time, earliest] of rows) {
    const w = win(date, time);
    assert.equal(w.earliest, earliest, `${label}: earliest should be ${dayName(earliest)} ${earliest}, got ${w.earliest}`);
    assert.equal(w.dates[0], earliest, `${label}: first selectable date`);
    assert.ok(!w.dates.some((d) => d < earliest), `${label}: nothing before earliest`);
  }
});

test('Friday before 1 PM → Sunday, Monday and Tuesday are allowed', () => {
  const w = win(FRI, '12:59');
  for (const d of [SUN, NEXT_MON, NEXT_TUE]) assert.ok(w.dates.includes(d), `${d} should be allowed`);
  assert.ok(!w.dates.includes(SAT), 'Saturday is too early for a Friday order');
});

test('Friday after 1 PM / Saturday / Sunday → treated as Monday → Wednesday onwards (no Sun/Mon/Tue)', () => {
  for (const [d, t] of [[FRI, '13:00'], [FRI, '17:45'], [SAT, '09:00'], [SUN, '23:59']]) {
    const w = win(d, t);
    assert.equal(w.processing_day, NEXT_MON);
    for (const blocked of [SUN, NEXT_MON, NEXT_TUE]) assert.ok(!w.dates.includes(blocked), `${d} ${t}: ${blocked} must not be allowed`);
    assert.equal(w.dates[0], NEXT_WED);
  }
});

test('cutoff is exactly 1:00 PM MYT, independent of the server timezone', () => {
  assert.equal(processingDay(mytDate(MON, '12:59')), MON);
  assert.equal(processingDay(mytDate(MON, '13:00')), TUE);
  assert.equal(processingDay(new Date('2026-11-09T04:59:00Z')), MON); // 12:59 MYT
  assert.equal(processingDay(new Date('2026-11-09T05:00:00Z')), TUE); // 13:00 MYT
});

test('closure dates are blocked and skipped as working days', () => {
  const w = win(MON, '10:00', [WED]);
  assert.ok(!w.dates.includes(WED), 'closure date not selectable');
  assert.equal(w.dates[0], THU);
  assert.deepEqual(w.blocked_closures, [WED]);
  assert.equal(processingDay(mytDate(MON, '10:00'), { closures: new Set([MON]) }), TUE, 'closed Monday → order counts as Tuesday');
});

test('explanation mentions the Friday cutoff for Sunday–Tuesday', () => {
  assert.ok(win(MON, '10:00').explanation.some((x) => x.includes('Orders for Sunday–Tuesday close Friday 1:00 PM')));
});

const S = { sst_rate: 0.06, delivery_fee: 25, free_delivery_threshold: 500 };
test('delivery fee: RM25 below RM500, free at RM500 or more, none for pickup', () => {
  assert.equal(computeTotals(499.99, 'delivery', S).delivery_fee, 25);
  assert.equal(computeTotals(500, 'delivery', S).delivery_fee, 0);
  assert.equal(computeTotals(500.01, 'delivery', S).delivery_fee, 0);
  assert.equal(computeTotals(10, 'pickup', S).delivery_fee, 0);
  assert.equal(computeTotals(480, 'delivery', S).amount_to_free_delivery, 20);
});

test('SST 6% on subtotal + delivery fee, rounded to 2 decimals', () => {
  const t = computeTotals(123.45, 'delivery', S); // (123.45 + 25) × 6% = 8.907 → 8.91
  assert.deepEqual([t.subtotal, t.delivery_fee, t.sst_amount, t.total], [123.45, 25, 8.91, 157.36]);
  const big = computeTotals(550, 'delivery', S); // free delivery: 550 × 6% = 33
  assert.deepEqual([big.delivery_fee, big.sst_amount, big.total], [0, 33, 583]);
  const p = computeTotals(22.5, 'pickup', S); // 1.35
  assert.deepEqual([p.sst_amount, p.total], [1.35, 23.85]);
  for (let sub = 0.01; sub < 700; sub += 13.37) {
    const x = computeTotals(sub, 'delivery', S);
    assert.equal(x.total, Math.round((x.subtotal + x.delivery_fee + x.sst_amount) * 100) / 100);
    assert.equal(x.sst_amount, Math.round(((x.subtotal + x.delivery_fee) * 0.06 + Number.EPSILON) * 100) / 100);
  }
});

test('credit term: only available 2 months after the account start date', () => {
  assert.equal(addMonths('2026-09-10', 2), '2026-11-10');
  assert.equal(addMonths('2025-12-31', 2), '2026-02-28');
  const c = (start, term = 'COD') => ({ id: -1, payment_term: term, account_start_date: start });
  const now = mytDate('2026-11-10', '10:00');
  assert.equal(termStatus(c('2026-09-11'), now).can_request, false, '1 day short of 2 months');
  assert.equal(termStatus(c('2026-09-10'), now).can_request, true, 'exactly 2 months');
  assert.equal(termStatus(c('2026-01-01'), now).can_request, true);
  assert.equal(termStatus(c('2026-01-01', 'NET14'), now).can_request, false, 'already on 14 days');
});
