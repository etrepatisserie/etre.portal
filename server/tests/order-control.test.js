// Order-to-cash phase 1: add-on orders, Finance overrides, closure management, audit trail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer } from './helpers.js';

isolatedEnv();
let api, db, T = {}, sku = {};
before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  for (const [k, e, p] of [['admin', 'admin@demo.test', 'admin123'], ['adminIPH', 'admin.ipoh@demo.test', 'admin123'], ['finance', 'finance@demo.test', 'finance123'],
    ['kitchen', 'kitchen@demo.test', 'kitchen123'], ['harbor', 'harbor@demo.test', 'customer123'], ['maple', 'maple@demo.test', 'customer123'], ['bean', 'beanbloom@demo.test', 'customer123']]) T[k] = await api.login(e, p);
  for (const p of (await api.call('GET', '/admin/products', { token: T.admin })).body) sku[p.sku] = p.id;
});
after(() => api.close());

const get = (url, who) => api.call('GET', url, { token: T[who] }).then((r) => r.body);
const post = (url, who, body) => api.call('POST', url, { token: T[who], body });
const cid = (email) => db.prepare('SELECT customer_id FROM users WHERE email = ?').get(email).customer_id;
async function order(who, { method = 'delivery', dateIndex = 0, addon_of, date } = {}) {
  const i = await get('/customer/checkout-info', who);
  const dates = i.window.by_method[method];
  return post('/customer/orders', who, { lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method, fulfil_date: date || dates[dateIndex], time_slot: (method === 'pickup' ? i.pickup_slots : i.delivery_slots)[0], area_confirmed: true, addon_of });
}

test('Add-on order: linked both ways, own number, approval and invoice; flagged for Admin and the kitchen', async () => {
  const first = await order('harbor');
  assert.equal(first.status, 201);
  assert.equal((await post(`/admin/sales-orders/${first.body.id}/approve`, 'admin')).status, 200);
  const add = await order('harbor', { addon_of: first.body.id });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const a = await get(`/admin/sales-orders/${add.body.id}`, 'admin');
  assert.equal(a.status, 'Pending', 'add-on has its own approval');
  assert.notEqual(a.so_number, (await get(`/admin/sales-orders/${first.body.id}`, 'admin')).so_number);
  assert.ok(a.addon_of_number);
  assert.ok((await get(`/admin/sales-orders/${first.body.id}`, 'admin')).addons.some((x) => x.id === add.body.id), 'original lists its add-on');
  assert.ok((await get('/admin/sales-orders?status=Pending', 'admin')).some((x) => x.id === add.body.id && x.addon_of_number), 'flagged in the admin list');
  await post(`/admin/sales-orders/${add.body.id}/approve`, 'admin');
  const k = (await get(`/kitchen/orders/${add.body.id}`, 'kitchen'));
  assert.equal(k.addon_of_number, a.addon_of_number, 'kitchen sees the add-on flag');
  const f = new FormData(); f.append('mode', 'generate');
  const inv = await api.call('POST', `/finance/orders/${add.body.id}/invoice`, { token: T.finance, form: f });
  assert.equal(inv.status, 201, 'own invoice + DO');
  // must link to the same customer's open order
  const other = db.prepare("SELECT id FROM sales_orders WHERE customer_id <> ? AND status NOT IN ('Cancelled','Received') LIMIT 1").get(cid('harbor@demo.test'));
  assert.equal((await order('harbor', { addon_of: other.id })).status, 400);
});

test('Finance override: lets a blocked customer order, then expires; single-order overrides are used up; all audited', async () => {
  const maple = cid('maple@demo.test');
  assert.equal((await order('maple')).status, 409, 'maple is blocked (overdue)');
  assert.ok((await get('/finance/blocked', 'finance')).customers.some((c) => c.id === maple), 'listed as blocked');
  // validation
  assert.equal((await post(`/finance/customers/${maple}/override`, 'finance', { reason: '', single_order: true })).status, 400);
  assert.equal((await post(`/finance/customers/${maple}/override`, 'finance', { reason: 'x', expires_on: '2099-01-01' })).status, 400, 'max 14 days');
  assert.equal((await post(`/finance/customers/${maple}/override`, 'admin', { reason: 'x', single_order: true })).status, 403, 'finance only');
  // one order
  assert.equal((await post(`/finance/customers/${maple}/override`, 'finance', { reason: 'Paying Friday — confirmed by phone', single_order: true })).status, 201);
  assert.equal((await get('/customer/checkout-info', 'maple')).blocked, false, 'checkout open under the override');
  const o1 = await order('maple');
  assert.equal(o1.status, 201, JSON.stringify(o1.body));
  assert.equal((await post(`/admin/sales-orders/${o1.body.id}/approve`, 'admin')).status, 200, 'admin can approve it under the override');
  assert.equal((await order('maple')).status, 409, 'single-order override used up');
  // until a date, then it expires
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const g = await post(`/finance/customers/${maple}/override`, 'finance', { reason: 'Big event order', expires_on: today });
  assert.equal(g.status, 201);
  assert.equal((await order('maple')).status, 201, 'allowed while in force');
  db.prepare('UPDATE block_overrides SET expires_on = ? WHERE id = ?').run('2000-01-01', g.body.id);
  assert.equal((await order('maple')).status, 409, 'blocked again after it expires');
  // revoke + audit trail
  const g2 = await post(`/finance/customers/${maple}/override`, 'finance', { reason: 'Again', single_order: true });
  assert.equal((await post(`/finance/overrides/${g2.body.id}/revoke`, 'finance')).status, 200);
  assert.equal((await order('maple')).status, 409);
  const actions = db.prepare("SELECT action FROM audit_log WHERE entity = 'customer' AND entity_id = ?").all(maple).map((x) => x.action);
  assert.ok(actions.includes('override_granted') && actions.includes('override_revoked'));
  // a pending order from a now-blocked customer needs the override to be approved
  const harbor = cid('harbor@demo.test');
  const p = await order('harbor');
  const inv = db.prepare("SELECT id, due_date FROM invoices WHERE customer_id = ? AND payment_status <> 'Paid' AND void = 0 ORDER BY id LIMIT 1").get(harbor);
  db.prepare("UPDATE invoices SET due_date = '2000-01-01' WHERE id = ?").run(inv.id);
  assert.equal((await post(`/admin/sales-orders/${p.body.id}/approve`, 'admin')).status, 409);
  await post(`/finance/customers/${harbor}/override`, 'finance', { reason: 'Payment on the way', single_order: true });
  assert.equal((await post(`/admin/sales-orders/${p.body.id}/approve`, 'admin')).status, 200);
  db.prepare('UPDATE invoices SET due_date = ? WHERE id = ?').run(inv.due_date, inv.id);
});

test('Closures: what they block, reason shown, yearly repeat, existing orders flagged not moved', async () => {
  const i = await get('/customer/checkout-info', 'bean');
  const d = i.window.by_method.delivery[3];
  const prev = new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  // an approved order already on that date
  const placed = await order('harbor', { date: d });
  assert.equal(placed.status, 201);
  await post(`/admin/sales-orders/${placed.body.id}/approve`, 'admin');
  // close delivery only on d (KL)
  const KL = db.prepare("SELECT id FROM outlets WHERE code = 'KL'").get().id;
  const c = await post('/admin/closures', 'admin', { title: 'Staff training', reason: 'Staff training day', outlet_id: KL, closure_from: d, blocks: ['delivery'] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.ok(c.body.affected.some((o) => o.id === placed.body.id), 'existing order flagged');
  assert.equal((await get(`/admin/sales-orders/${placed.body.id}`, 'admin')).fulfil_date, d, 'not moved');
  const after = (await get('/customer/checkout-info', 'harbor')).window;
  assert.ok(!after.by_method.delivery.includes(d), 'delivery blocked');
  assert.ok(after.by_method.pickup.includes(d), 'pickup still open');
  assert.match(after.blocked_info.find((b) => b.date === d).delivery, /Staff training day/);
  const refused = await order('harbor', { date: d });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /closed for delivery.*Nearest available/s);
  // production closure blocks the following day for both methods
  const p = await post('/admin/closures', 'admin', { title: 'Oven repair', outlet_id: KL, closure_from: prev, blocks: ['production'] });
  assert.equal(p.status, 201);
  const w = (await get('/customer/checkout-info', 'harbor')).window;
  assert.ok(!w.by_method.pickup.includes(d), 'no production the day before → no pickup');
  // yearly repeat: last year's closure applies this year
  const lastYear = `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  const nextDay = w.by_method.pickup.find((x) => x > d);
  const ny = `${Number(nextDay.slice(0, 4)) - 1}${nextDay.slice(4)}`;
  await post('/admin/closures', 'admin', { title: 'Founders day', outlet_id: KL, closure_from: ny, blocks: ['collection', 'delivery'], repeat_yearly: true });
  assert.ok(!(await get('/customer/checkout-info', 'harbor')).window.by_method.pickup.includes(nextDay), 'yearly closure repeats');
  assert.ok(lastYear);
  // Ipoh admin can't edit a KL closure; Ipoh customers aren't affected by it
  assert.equal((await api.call('PUT', `/admin/closures/${c.body.id}`, { token: T.adminIPH, body: { title: 'x', closure_from: d, blocks: ['delivery'] } })).status, 403);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE entity = 'closure' AND action = 'created'").get(), 'audited');
});

test('Audit trail: placed, approved, adjusted, cancelled — with who and old/new values', async () => {
  const o = await order('harbor', { dateIndex: 2 });
  await api.call('POST', `/admin/sales-orders/${o.body.id}/adjust`, { token: T.admin, body: { changes: [{ line_id: (await get(`/admin/sales-orders/${o.body.id}`, 'admin')).lines[0].id, quantity: 4, reason: 'One short' }] } });
  await post(`/admin/sales-orders/${o.body.id}/approve`, 'admin');
  await post(`/admin/sales-orders/${o.body.id}/cancel`, 'admin', { reason: 'Customer phoned' });
  const so = await get(`/admin/sales-orders/${o.body.id}`, 'admin');
  assert.deepEqual(so.audit.map((a) => a.action), ['placed', 'adjusted', 'approved', 'cancelled']);
  assert.ok(so.audit.slice(1).every((a) => a.user_name), 'who did it');
  const adj = so.audit.find((a) => a.action === 'adjusted');
  assert.equal(adj.before.lines[0].qty, 5); assert.equal(adj.after.lines[0].qty, 4);
});

test('Red dots: the customer is told what needs action now (pay, re-upload, confirm receipt)', async () => {
  const maple = await get('/customer/attention', 'maple');           // overdue 14-day customer
  assert.ok(maple.payments && maple.payments.count >= 1, 'overdue invoice → Payments dot');
  assert.match(maple.payments.reason, /INV-/);
  const harbor = cid('harbor@demo.test');
  const ready = db.prepare("SELECT id FROM sales_orders WHERE customer_id = ? AND status IN ('Ready for Pickup','Out for Delivery') LIMIT 1").get(harbor);
  const h = await get('/customer/attention', 'harbor');
  if (ready) assert.ok(h.orders && h.orders.count >= 1, 'order to receive → orders dot');
  // only their own records
  assert.equal((await api.call('GET', '/customer/attention', { token: T.admin })).status, 403);
});
