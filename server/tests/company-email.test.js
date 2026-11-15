// Each company (KL, Ipoh) has its own email: sender of its customer emails, shown in the footer and on invoices.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer } from './helpers.js';

isolatedEnv();
let api, db, admin;
before(async () => { api = await startServer(); db = (await import('../db.js')).default; admin = await api.login('admin@demo.test', 'admin123'); });
after(() => api.close());

test('Company emails: defaults, sender per company, footer, settings validation', async () => {
  const { listOutlets } = await import('../outlets.js');
  const { senderOf, renderEmail } = await import('../email.js');
  const by = Object.fromEntries(listOutlets().map((o) => [o.code, o]));
  assert.equal(by.KL.email, 'kl.etrepatisserie@gmail.com');
  assert.equal(by.IPH.email, 'etrepatisserie@gmail.com');
  assert.match(senderOf(by.KL), /Être Patisserie KL" <kl\.etrepatisserie@gmail\.com>$/);
  assert.match(senderOf(by.IPH), /Être Patisserie Ipoh" <etrepatisserie@gmail\.com>$/);
  const cust = db.prepare('SELECT * FROM customers WHERE outlet_id = ? LIMIT 1').get(by.IPH.id);
  const m = renderEmail('term_result', { customer: cust, approved: true });
  assert.ok(m.html.includes('etrepatisserie@gmail.com') && !m.html.includes('kl.etrepatisserie'), 'Ipoh email shows Ipoh address');
  const bad = await api.call('PUT', `/admin/settings/outlets/${by.KL.id}`, { token: admin, body: { email: 'not-an-email' } });
  assert.equal(bad.status, 400);
  const ok = await api.call('PUT', `/admin/settings/outlets/${by.KL.id}`, { token: admin, body: { email: 'kl.etrepatisserie@gmail.com' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('Delivery fee is set per company and used at checkout and on orders', async () => {
  const { listOutlets } = await import('../outlets.js');
  const by = Object.fromEntries(listOutlets().map((o) => [o.code, o]));
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${by.KL.id}`, { token: admin, body: { delivery_fee: -1 } })).status, 400);
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${by.KL.id}`, { token: admin, body: { delivery_fee: 30, free_delivery_threshold: 600 } })).status, 200);
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${by.IPH.id}`, { token: admin, body: { delivery_fee: 15, free_delivery_threshold: 300 } })).status, 200);
  const kl = await api.login('harbor@demo.test', 'customer123'), iph = await api.login('perakhotel@demo.test', 'customer123');
  const ik = (await api.call('GET', '/customer/checkout-info', { token: kl })).body, ii = (await api.call('GET', '/customer/checkout-info', { token: iph })).body;
  assert.deepEqual([ik.delivery_fee, ik.free_delivery_threshold], [30, 600]);
  assert.deepEqual([ii.delivery_fee, ii.free_delivery_threshold], [15, 300]);
  // a small KL delivery order is charged KL's fee
  const p = (await api.call('GET', '/customer/products', { token: kl })).body.find((x) => x.moq <= 5 && x.price < 20);
  const r = await api.call('POST', '/customer/orders', { token: kl, body: { lines: [{ product_id: p.id, quantity: p.moq }], method: 'delivery', fulfil_date: ik.window.by_method.delivery[0], time_slot: ik.delivery_slots[0] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const so = (await api.call('GET', `/customer/orders/${r.body.id}`, { token: kl })).body;
  assert.equal(so.delivery_fee, 30, 'KL fee charged');
});
