// Bukku integration against a FAKE Bukku server (no real credentials are used or needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isolatedEnv, startServer } from './helpers.js';

isolatedEnv();
// fake Bukku: records requests; answers 500 while `failing` is set
const fake = { requests: [], failing: false, seq: 100 };
const bukku = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    fake.requests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });
    res.setHeader('Content-Type', 'application/json');
    if (fake.failing) { res.statusCode = 500; return res.end(JSON.stringify({ message: 'Server error' })); }
    res.statusCode = 201; res.end(JSON.stringify({ transaction: { id: ++fake.seq, number: `IV-${fake.seq}` } }));
  });
});
await new Promise((r) => bukku.listen(0, r));
Object.assign(process.env, { BUKKU_BASE_URL: `http://127.0.0.1:${bukku.address().port}`, BUKKU_KL_TOKEN: 'test-token-kl', BUKKU_KL_SUBDOMAIN: 'etre-kl-test' });

let api, db, T = {}, sku = {};
before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  for (const [k, e, p] of [['admin', 'admin@demo.test', 'admin123'], ['finance', 'finance@demo.test', 'finance123'], ['kitchen', 'kitchen@demo.test', 'kitchen123'], ['harbor', 'harbor@demo.test', 'customer123']]) T[k] = await api.login(e, p);
  for (const p of (await api.call('GET', '/admin/products', { token: T.admin })).body) sku[p.sku] = p.id;
});
after(() => { api.close(); bukku.close(); });

async function approvedOrder() {
  const i = (await api.call('GET', '/customer/checkout-info', { token: T.harbor })).body;
  const r = await api.call('POST', '/customer/orders', { token: T.harbor, body: { lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method: 'pickup', fulfil_date: i.window.by_method.pickup[0], time_slot: i.pickup_slots[0] } });
  await api.call('POST', `/admin/sales-orders/${r.body.id}/approve`, { token: T.admin });
  return r.body.id;
}
const issueBukku = (so) => { const f = new FormData(); f.append('mode', 'bukku'); return api.call('POST', `/finance/orders/${so}/invoice`, { token: T.finance, form: f }); };

test('Switched off by default: issuing with Bukku is refused and nothing is sent', async () => {
  delete process.env.BUKKU_ENABLED;
  const so = await approvedOrder();
  const r = await issueBukku(so);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /switched off/);
  assert.equal(fake.requests.length, 0);
  assert.equal((await api.call('GET', '/finance/integration-log', { token: T.finance })).body.status.KL.ready, false);
});

test('Creates the invoice in the right Bukku company; retry never duplicates; credentials never reach the browser', async () => {
  process.env.BUKKU_ENABLED = '1';
  const so = await approvedOrder();
  const r = await issueBukku(so);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'sent');
  assert.match(r.body.bukku_number, /^IV-/);
  const req = fake.requests.at(-1);
  assert.equal(req.url, '/sales/invoices'); assert.equal(req.method, 'POST');
  assert.equal(req.headers.authorization, 'Bearer test-token-kl');
  assert.equal(req.headers['company-subdomain'], 'etre-kl-test', 'KL invoice goes to the KL company');
  assert.equal(req.body.contact_code, db.prepare("SELECT c.code FROM customers c JOIN users u ON u.customer_id = c.id WHERE u.email = 'harbor@demo.test'").get().code);
  assert.ok(req.body.form_items.every((l) => l.quantity > 0));
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.body.id);
  assert.equal(inv.bukku_status, 'sent'); assert.equal(inv.external_number, r.body.bukku_number);
  const before = fake.requests.length;
  const again = await api.call('POST', `/finance/invoices/${inv.id}/bukku/retry`, { token: T.finance });
  assert.equal(again.body.skipped, true);
  assert.equal(fake.requests.length, before, 'no duplicate in Bukku');
  const log = (await api.call('GET', '/finance/integration-log', { token: T.finance })).body;
  assert.ok(log.log.some((l) => l.invoice_id === inv.id && l.status === 'ok'));
  assert.ok(!JSON.stringify(log).includes('test-token-kl'), 'token never sent to the browser');
});

test('Bukku fails: error logged, Finance alerted, order still in the kitchen; retry sends once; upload fallback works', async () => {
  process.env.BUKKU_ENABLED = '1';
  fake.failing = true;
  const so = await approvedOrder();
  const r = await issueBukku(so);
  assert.equal(r.status, 201, 'the invoice record is kept');
  assert.equal(r.body.status, 'failed');
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.body.id);
  assert.equal(inv.bukku_status, 'failed'); assert.match(inv.bukku_error, /500/);
  assert.ok(db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'finance' AND n.title = ?").get(`Bukku failed: ${inv.inv_number}`), 'finance alerted');
  assert.ok((await api.call('GET', '/kitchen/orders?status=New', { token: T.kitchen })).body.some((o) => o.id === so), 'order still reached the kitchen');
  assert.ok((await api.call('GET', '/finance/invoices?bukku=failed', { token: T.finance })).body.some((i) => i.id === inv.id));
  fake.failing = false;
  const n = fake.requests.length;
  const retry = await api.call('POST', `/finance/invoices/${inv.id}/bukku/retry`, { token: T.finance });
  assert.equal(retry.body.status, 'sent');
  assert.equal(fake.requests.length, n + 1, 'sent exactly once');
  // another failed one → Finance uploads the invoice file instead
  fake.failing = true;
  const so2 = await approvedOrder();
  const r2 = await issueBukku(so2);
  fake.failing = false;
  const f = new FormData(); f.append('kind', 'invoice'); f.append('file', new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), 'inv.pdf');
  const up = await api.call('POST', `/finance/invoices/${r2.body.id}/documents`, { token: T.finance, form: f });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.source, 'uploaded'); assert.equal(up.body.issue_method, 'uploaded');
  delete process.env.BUKKU_ENABLED;
});
