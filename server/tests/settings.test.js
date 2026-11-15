// Settings: head-office admin edits company / outlet details and ordering rules; others can't.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer } from './helpers.js';

isolatedEnv();
let api, T = {};
before(async () => {
  api = await startServer();
  T.admin = await api.login('admin@demo.test', 'admin123');           // head office
  T.ipoh = await api.login('admin.ipoh@demo.test', 'admin123');       // outlet admin
  T.finance = await api.login('finance@demo.test', 'finance123');
  T.harbor = await api.login('harbor@demo.test', 'customer123');
});
after(() => api.close());

test('Head office edits outlet details; changes reach checkout', async () => {
  const s = (await api.call('GET', '/admin/settings', { token: T.admin })).body;
  assert.equal(s.can_edit, true);
  assert.equal(s.outlets.length, 2);
  const kl = s.outlets.find((o) => o.code === 'KL');
  const r = await api.call('PUT', `/admin/settings/outlets/${kl.id}`, { token: T.admin, body: { pickup_address: '12 Jalan Test, KL', pickup_slots: '9:00 AM – 11:00 AM\n2:00 PM – 4:00 PM\n', bank_account_no: '5140 1248 0012' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.pickup_slots, ['9:00 AM – 11:00 AM', '2:00 PM – 4:00 PM']);
  const info = (await api.call('GET', '/customer/checkout-info', { token: T.harbor })).body; // harbor is a KL customer
  assert.equal(info.pickup_address, '12 Jalan Test, KL');
  assert.deepEqual(info.pickup_slots, ['9:00 AM – 11:00 AM', '2:00 PM – 4:00 PM']);

  // validation
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${kl.id}`, { token: T.admin, body: { company_name: '  ' } })).status, 400);
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${kl.id}`, { token: T.admin, body: { delivery_slots: '' } })).status, 400);
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${kl.id}`, { token: T.admin, body: { bank_account_no: 'abc' } })).status, 400);
});

test('Ordering rules: validated, SST read-only, live for new orders', async () => {
  const r = await api.call('PUT', '/admin/settings/rules', { token: T.admin, body: { cutoff_time: '12:30', sst_rate: 0.5 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // the delivery fee is per company now (Settings › company › Pickup & delivery) — see company-email.test.js
  assert.equal(r.body.cutoff_time, '12:30');
  assert.equal(r.body.sst_rate, 0.06, 'SST cannot be changed here');
  assert.equal((await api.call('PUT', '/admin/settings/rules', { token: T.admin, body: { cutoff_time: '25:00' } })).status, 400);
  assert.equal((await api.call('PUT', '/admin/settings/rules', { token: T.admin, body: { max_days_ahead: 2.5 } })).status, 400);
  assert.equal((await api.call('PUT', '/admin/settings/rules', { token: T.admin, body: { credit_term_min_months: -1 } })).status, 400);
  await api.call('PUT', '/admin/settings/rules', { token: T.admin, body: { cutoff_time: '13:00' } }); // restore
});

test('Only head office can change settings', async () => {
  const s = (await api.call('GET', '/admin/settings', { token: T.ipoh })).body;
  assert.equal(s.can_edit, false);
  assert.deepEqual(s.outlets.map((o) => o.code), ['IPH'], 'outlet admin sees only their outlet');
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${s.outlets[0].id}`, { token: T.ipoh, body: { pickup_address: 'x' } })).status, 403);
  assert.equal((await api.call('PUT', '/admin/settings/rules', { token: T.ipoh, body: { cutoff_time: '12:00' } })).status, 403);
  assert.equal((await api.call('GET', '/admin/settings', { token: T.finance })).status, 403);
  assert.equal((await api.call('GET', '/admin/settings', { token: T.harbor })).status, 403);
});
