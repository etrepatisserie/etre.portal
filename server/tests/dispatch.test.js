// Admin: orders not yet dispatched are split by pickup / delivery date — today (incl. late) vs later dates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer } from './helpers.js';

isolatedEnv();
let api, db, T = {}, sku = {};
before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  T.admin = await api.login('admin@demo.test', 'admin123');
  T.harbor = await api.login('harbor@demo.test', 'customer123');
  for (const p of (await api.call('GET', '/admin/products', { token: T.admin })).body) sku[p.sku] = p.id;
});
after(() => api.close());

const list = async (status) => (await api.call('GET', `/admin/sales-orders?status=${status}`, { token: T.admin })).body;
const counts = async () => (await api.call('GET', '/admin/dashboard', { token: T.admin })).body.counts;
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

test('To dispatch today vs yet to dispatch', async () => {
  const i = (await api.call('GET', '/customer/checkout-info', { token: T.harbor })).body;
  const placed = await api.call('POST', '/customer/orders', { token: T.harbor, body: { lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method: 'delivery', fulfil_date: i.window.dates[0], time_slot: i.delivery_slots[0] } });
  assert.equal(placed.status, 201);
  const id = placed.body.id;

  // new orders are always for a later date
  assert.ok((await list('DispatchLater')).some((o) => o.id === id), 'later date → yet to dispatch');
  assert.ok(!(await list('DispatchToday')).some((o) => o.id === id));

  // every row is in the right group, and the dashboard counts match the lists
  const t = today();
  const todayRows = await list('DispatchToday'); const laterRows = await list('DispatchLater');
  assert.ok(todayRows.every((o) => o.fulfil_date <= t && ['Confirmed', 'Processing', 'Pending', 'Invoiced'].includes(o.status)));
  assert.ok(laterRows.every((o) => o.fulfil_date > t));
  const later = laterRows.map((o) => o.fulfil_date);
  assert.deepEqual(later, [...later].sort(), 'earliest date first');
  let c = await counts();
  assert.equal(c.dispatchToday, todayRows.length); assert.equal(c.dispatchLater, laterRows.length);

  // date is today → moves to "today"; date already passed → still "today", counted as late
  db.prepare("UPDATE sales_orders SET fulfil_date = ?, status = 'Processing' WHERE id = ?").run(t, id);
  assert.ok((await list('DispatchToday')).some((o) => o.id === id), 'today → to dispatch today');
  assert.ok(!(await list('DispatchLater')).some((o) => o.id === id));
  const lateBefore = (await counts()).dispatchLate;
  db.prepare('UPDATE sales_orders SET fulfil_date = ? WHERE id = ?').run(shift(t, -1), id);
  c = await counts();
  assert.equal(c.dispatchLate, lateBefore + 1, 'past date → counted as late');
  assert.ok((await list('DispatchToday')).some((o) => o.id === id), 'late orders stay in the today list');

  // once dispatched it leaves both groups
  assert.equal((await api.call('POST', `/admin/sales-orders/${id}/dispatch`, { token: T.admin })).status, 200);
  assert.ok(!(await list('DispatchToday')).some((o) => o.id === id));
  assert.ok(!(await list('DispatchLater')).some((o) => o.id === id));
});
