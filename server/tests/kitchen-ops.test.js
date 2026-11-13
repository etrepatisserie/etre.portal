// Order-to-cash phase 4: production calendar, consolidated summary, Completed step with actual / shortage / wastage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer } from './helpers.js';

isolatedEnv();
let api, db, T = {}, sku = {};
before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  for (const [k, e, p] of [['admin', 'admin@demo.test', 'admin123'], ['kitchen', 'kitchen@demo.test', 'kitchen123'], ['kitchenIPH', 'kitchen.ipoh@demo.test', 'kitchen123'],
    ['harbor', 'harbor@demo.test', 'customer123'], ['oven', 'littleoven@demo.test', 'customer123']]) T[k] = await api.login(e, p);
  for (const p of (await api.call('GET', '/admin/products', { token: T.admin })).body) sku[p.sku] = p.id;
});
after(() => api.close());

const EMAIL = { harbor: 'harbor@demo.test', oven: 'littleoven@demo.test' };
const get = (url, who = 'kitchen') => api.call('GET', url, { token: T[who] }).then((r) => r.body);
const tomorrowMY = () => new Date(Date.now() + 32 * 3600e3).toISOString().slice(0, 10);
// an order whose production date is tomorrow: place it, then move its dates (the window starts later)
async function orderForTomorrow(who, lines, { approve = true } = {}) {
  const i = (await api.call('GET', '/customer/checkout-info', { token: T[who] })).body;
  const body = { lines: lines.map(([s, q]) => ({ product_id: sku[s], quantity: q })), method: 'pickup', fulfil_date: i.window.by_method.pickup[0], time_slot: i.pickup_slots[0] };
  // COD customers need a slip in the portal — enter theirs as an Admin phone order (approved on entry)
  const cod = i.payment_term === 'COD';
  const r = cod
    ? await api.call('POST', '/admin/sales-orders', { token: T.admin, body: { ...body, customer_id: db.prepare('SELECT customer_id FROM users WHERE email = ?').get(EMAIL[who]).customer_id } })
    : await api.call('POST', '/customer/orders', { token: T[who], body });
  if (cod) approve = false;
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const prod = tomorrowMY();
  db.prepare('UPDATE sales_orders SET production_date = ?, fulfil_date = date(?, \'+1 day\') WHERE id = ?').run(prod, prod, r.body.id);
  if (approve) assert.equal((await api.call('POST', `/admin/sales-orders/${r.body.id}/approve`, { token: T.admin })).status, 200);
  return r.body.id;
}
const FORBIDDEN_KEYS = /price|total|amount|sst|fee|cost|invoice|payment|slip|bank|paid|due|term/i;
function noMoney(obj, where) {
  const walk = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { assert.ok(!FORBIDDEN_KEYS.test(k), `${where}: money field ${path}.${k}`); walk(x, `${path}.${k}`); }
    if (typeof v === 'string') assert.ok(!/RM\s?\d/.test(v), `${where}: money text at ${path}`);
  };
  walk(obj, '');
}

test('Calendar and consolidated summary: approved orders only, correct totals per product × customer, no money', async () => {
  const a = await orderForTomorrow('harbor', [['V-BCR-001', 10], ['V-PAC-001', 5]]);
  const b = await orderForTomorrow('oven', [['V-BCR-001', 20]]);
  const pending = await orderForTomorrow('harbor', [['V-BCR-001', 99]], { approve: false });
  const cal = await get('/kitchen/calendar?view=tomorrow');
  const day = cal.days[0];
  assert.equal(day.date, tomorrowMY());
  const ids = day.orders.map((o) => o.id);
  assert.ok(ids.includes(a) && ids.includes(b), 'approved orders are in the calendar');
  assert.ok(!ids.includes(pending), 'unapproved order is not');
  const sum = await get(`/kitchen/summary?date=${tomorrowMY()}`);
  const bcr = sum.products.find((p) => p.sku === 'V-BCR-001');
  const harborName = day.orders.find((o) => o.id === a).customer_name, ovenName = day.orders.find((o) => o.id === b).customer_name;
  assert.ok(bcr.by_customer[harborName] >= 10 && bcr.by_customer[ovenName] >= 20);
  assert.equal(bcr.units, Object.values(bcr.by_customer).reduce((x, y) => x + y, 0), 'total = sum of customers');
  assert.ok(sum.customers.find((c) => c.name === harborName).orders.some((o) => o.id === a), 'drill into each customer order');
  for (const v of ['today', 'tomorrow', 'week', 'upcoming']) noMoney(await get(`/kitchen/calendar?view=${v}`), `calendar ${v}`);
  noMoney(sum, 'summary');
  // the other outlet's kitchen doesn't see KL orders
  assert.ok(!(await get('/kitchen/calendar?view=tomorrow', 'kitchenIPH')).days[0].orders.some((o) => o.id === a));
});

test('Completed step: actual quantity, shortage, wastage, remarks; shortage alerts Admin; flags in the calendar', async () => {
  const id = await orderForTomorrow('harbor', [['V-BCR-001', 10], ['V-PAC-001', 5]]);
  const so = await get(`/kitchen/orders/${id}`);
  assert.equal((await api.call('POST', `/kitchen/orders/${id}/complete`, { token: T.kitchen, body: {} })).status, 400, 'must start production first');
  await api.call('POST', `/kitchen/orders/${id}/printed`, { token: T.kitchen });
  await api.call('POST', `/kitchen/orders/${id}/processing`, { token: T.kitchen });
  const bcr = so.lines.find((l) => l.sku === 'V-BCR-001');
  assert.equal((await api.call('POST', `/kitchen/orders/${id}/complete`, { token: T.kitchen, body: { lines: [{ line_id: bcr.id, actual_qty: -1 }] } })).status, 400);
  const r = await api.call('POST', `/kitchen/orders/${id}/complete`, { token: T.kitchen, body: { lines: [{ line_id: bcr.id, actual_qty: 8, wastage: 2, remarks: 'Two burnt' }], remarks: 'Oven 2 ran hot' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.completed_at);
  const res = r.body.production_results.find((x) => x.line_id === bcr.id);
  assert.deepEqual([res.planned_qty, res.actual_qty, res.shortage, res.wastage], [10, 8, 2, 2]);
  noMoney(r.body, 'complete');
  assert.ok(db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'admin' AND n.title = ?").get(`Shortage on ${so.so_number}`), 'admin alerted');
  assert.equal((await api.call('POST', `/kitchen/orders/${id}/complete`, { token: T.kitchen, body: {} })).status, 400, 'only once');
  // another unfinished order for the same day with that product is flagged as a possible shortage
  const other = await orderForTomorrow('oven', [['V-BCR-001', 5]]);
  const day = (await get('/kitchen/calendar?view=tomorrow')).days[0];
  assert.ok(day.orders.find((o) => o.id === other).flags.includes('shortage_risk'));
  assert.ok((await api.call('GET', `/admin/sales-orders/${id}`, { token: T.admin })).body.production_results.length > 0, 'admin sees the results');
});

test('Flags: add-on and changed-after-approval orders are highlighted for the kitchen', async () => {
  const base = await orderForTomorrow('harbor', [['V-BCR-001', 10]]);
  const i = (await api.call('GET', '/customer/checkout-info', { token: T.harbor })).body;
  const add = await api.call('POST', '/customer/orders', { token: T.harbor, body: { lines: [{ product_id: sku['V-PAC-001'], quantity: 5 }], method: 'pickup', fulfil_date: i.window.by_method.pickup[0], time_slot: i.pickup_slots[0], addon_of: base } });
  db.prepare("UPDATE sales_orders SET production_date = ?, fulfil_date = date(?, '+1 day') WHERE id = ?").run(tomorrowMY(), tomorrowMY(), add.body.id);
  await api.call('POST', `/admin/sales-orders/${add.body.id}/approve`, { token: T.admin });
  const line = (await api.call('GET', `/admin/sales-orders/${base}`, { token: T.admin })).body.lines[0];
  db.prepare("UPDATE sales_orders SET confirmed_at = datetime('now', '-1 hour') WHERE id = ?").run(base);
  await api.call('POST', `/admin/sales-orders/${base}/adjust`, { token: T.admin, body: { changes: [{ line_id: line.id, quantity: 9, reason: 'One short' }] } });
  const day = (await get('/kitchen/calendar?view=tomorrow')).days[0];
  assert.ok(day.orders.find((o) => o.id === add.body.id).flags.includes('addon'));
  assert.ok(day.orders.find((o) => o.id === base).flags.includes('changed'));
});
