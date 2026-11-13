// Security & access: session expiry, sign-in throttling, CORS, role / outlet checks on the new endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer } from './helpers.js';

isolatedEnv();
let api, db, T = {};
before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  for (const [k, e, p] of [['admin', 'admin@demo.test', 'admin123'], ['adminIPH', 'admin.ipoh@demo.test', 'admin123'], ['finance', 'finance@demo.test', 'finance123'],
    ['kitchen', 'kitchen@demo.test', 'kitchen123'], ['harbor', 'harbor@demo.test', 'customer123'], ['perak', 'perakhotel@demo.test', 'customer123']]) T[k] = await api.login(e, p);
});
after(() => api.close());

test('Sessions expire after 30 days, or 7 days unused', async () => {
  const tok = await api.login('maple@demo.test', 'customer123');
  assert.equal((await api.call('GET', '/auth/me', { token: tok })).status, 200);
  db.prepare("UPDATE sessions SET last_seen = datetime('now', '-8 days') WHERE token = ?").run(tok);
  const r = await api.call('GET', '/auth/me', { token: tok });
  assert.equal(r.status, 401); assert.match(r.body.error, /expired/);
  const tok2 = await api.login('maple@demo.test', 'customer123');
  db.prepare("UPDATE sessions SET created_at = datetime('now', '-31 days') WHERE token = ?").run(tok2);
  assert.equal((await api.call('GET', '/auth/me', { token: tok2 })).status, 401);
});

test('Sign-in is throttled after 5 failed attempts for an email', async () => {
  const bad = () => api.call('POST', '/auth/login', { body: { email: 'kinta@demo.test', password: 'wrong' } });
  for (let i = 0; i < 5; i++) assert.equal((await bad()).status, 401);
  const r = await bad();
  assert.equal(r.status, 429); assert.match(r.body.error, /Too many/);
  assert.equal((await api.call('POST', '/auth/login', { body: { email: 'kinta@demo.test', password: 'customer123' } })).status, 429, 'even the right password waits');
  assert.equal((await api.call('POST', '/auth/login', { body: { email: 'bean@demo.test', password: 'x' } })).status, 401, 'other accounts unaffected');
});

test('CORS: only the portal origin gets access headers', async () => {
  const base = api.base || '';
  const ask = (origin) => fetch(`${base}/outlets`, { headers: { Origin: origin } });
  const good = await ask(process.env.APP_URL || 'http://localhost:5173');
  assert.ok(good.headers.get('access-control-allow-origin'));
  const evil = await ask('https://evil.example');
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('New endpoints keep role and outlet rules', async () => {
  const kl = db.prepare("SELECT id FROM outlets WHERE code = 'KL'").get().id;
  const klOrder = db.prepare("SELECT id FROM sales_orders WHERE outlet_id = ? AND status = 'Out for Delivery' LIMIT 1").get(kl) || db.prepare('SELECT id FROM sales_orders WHERE outlet_id = ? LIMIT 1').get(kl);
  const klInvoice = db.prepare('SELECT id FROM invoices WHERE outlet_id = ? LIMIT 1').get(kl);
  const klCustomer = db.prepare('SELECT id FROM customers WHERE outlet_id = ? LIMIT 1').get(kl);
  const checks = [
    ['kitchen', 'POST', `/admin/sales-orders/${klOrder.id}/approve`, 403], ['finance', 'POST', `/admin/sales-orders/${klOrder.id}/reject`, 403],
    ['harbor', 'GET', '/admin/closures', 403], ['kitchen', 'GET', '/finance/blocked', 403], ['admin', 'GET', '/finance/collection', 403],
    ['harbor', 'GET', '/finance/integration-log', 403], ['kitchen', 'GET', `/finance/invoices/${klInvoice.id}/documents`, 403],
    ['finance', 'GET', '/kitchen/calendar', 403], ['harbor', 'GET', '/kitchen/summary', 403], ['admin', 'POST', `/kitchen/orders/${klOrder.id}/complete`, 403],
    ['adminIPH', 'POST', `/admin/sales-orders/${klOrder.id}/failed-delivery`, 404], ['adminIPH', 'GET', `/admin/invoices/${klInvoice.id}/documents`, 404],
    ['kitchen', 'GET', '/customer/attention', 403], ['perak', 'POST', `/finance/customers/${klCustomer.id}/override`, 403],
  ];
  for (const [who, method, url, want] of checks) assert.equal((await api.call(method, url, { token: T[who], body: method === 'GET' ? undefined : {} })).status, want, `${who} ${method} ${url}`);
  // Ipoh admin's lists never include KL orders
  assert.ok((await api.call('GET', '/admin/sales-orders?status=all', { token: T.adminIPH })).body.every((o) => o.outlet_code === 'IPH'));
  assert.ok((await api.call('GET', '/admin/closures', { token: T.adminIPH })).body.affected.every((o) => o.outlet_code === 'IPH'));
});

test('Failed delivery: back to "In production" with a reason, stock returned, rebook clears the flag', async () => {
  const o = db.prepare("SELECT id, so_number FROM sales_orders WHERE status = 'Out for Delivery' LIMIT 1").get();
  if (!o) return;
  assert.equal((await api.call('POST', `/admin/sales-orders/${o.id}/failed-delivery`, { token: T.admin, body: {} })).status, 400, 'reason required');
  const r = await api.call('POST', `/admin/sales-orders/${o.id}/failed-delivery`, { token: T.admin, body: { reason: 'Customer closed' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'Processing'); assert.equal(r.body.failed_reason, 'Customer closed'); assert.ok(r.body.failed_at);
  assert.ok((await api.call('GET', '/admin/dashboard', { token: T.admin })).body.counts.failedDelivery >= 1);
  assert.ok(db.prepare("SELECT 1 FROM stock_movements WHERE ref = ? AND reason LIKE 'Failed delivery%'").get(o.so_number), 'stock returned');
  assert.equal((await api.call('POST', `/admin/sales-orders/${o.id}/dispatch`, { token: T.admin })).status, 200, 'rebooked');
  assert.equal(db.prepare('SELECT failed_at FROM sales_orders WHERE id = ?').get(o.id).failed_at, null);
});
