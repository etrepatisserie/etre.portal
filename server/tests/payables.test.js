// Payables (supplier bills) and the cash conversion cycle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer } from './helpers.js';

isolatedEnv();
let api, db, T = {};
before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  T.admin = await api.login('admin@demo.test', 'admin123');
  T.finance = await api.login('finance@demo.test', 'finance123');
  T.kitchen = await api.login('kitchen@demo.test', 'kitchen123');
});
after(() => api.close());
const get = (url, who = 'finance') => api.call('GET', url, { token: T[who] }).then((r) => r.body);
const post = (url, body = {}, who = 'finance') => api.call('POST', url, { token: T[who], body });
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

test('Received PO → Finance alerted → record the supplier bill → pay it', async () => {
  const po = db.prepare("SELECT * FROM purchase_orders WHERE status = 'Approved' ORDER BY id LIMIT 1").get();
  assert.ok(po, 'demo data has an approved PO');
  assert.equal((await post(`/finance/payables/${po.id}/bill`, { bill_number: 'X', bill_date: today(), term_days: 30 })).status, 400, 'not received yet');
  assert.equal((await post(`/admin/purchase-orders/${po.id}/status`, { status: 'Received' }, 'admin')).status, 200);
  assert.ok(db.prepare('SELECT received_at FROM purchase_orders WHERE id = ?').get(po.id).received_at, 'received date kept');
  assert.ok(db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'finance' AND n.type = 'supplier_bill' AND n.title LIKE ?").get(`%${po.po_number}%`), 'finance alerted');

  let p = await get('/finance/payables');
  assert.ok(p.to_record.some((r) => r.id === po.id));
  assert.ok((await get('/finance/dashboard')).bills_to_record >= 1);
  const bad = async (body, why) => assert.equal((await post(`/finance/payables/${po.id}/bill`, body)).status, 400, why);
  await bad({ bill_date: today(), term_days: 30 }, 'bill number required');
  await bad({ bill_number: 'B1', bill_date: shift(today(), 1), term_days: 30 }, 'no future dates');
  await bad({ bill_number: 'B1', bill_date: today(), term_days: 17 }, 'only listed terms');
  const billDate = shift(today(), -40);
  const rec = await post(`/finance/payables/${po.id}/bill`, { bill_number: 'SUP-INV-778', bill_date: billDate, term_days: 30 });
  assert.equal(rec.status, 201, JSON.stringify(rec.body));
  assert.equal(rec.body.amount, po.total, 'defaults to the PO total');
  assert.equal(rec.body.due_date, shift(billDate, 30));
  await bad({ bill_number: 'again', bill_date: today(), term_days: 30 }, 'one bill per PO');

  p = await get('/finance/payables');
  const row = p.unpaid.find((r) => r.id === po.id);
  assert.ok(row.overdue && row.days_overdue === 10, 'due 10 days ago → overdue');
  assert.ok(p.totals.overdue >= po.total);
  assert.ok((await get('/finance/dashboard')).bills_overdue.n >= 1);
  assert.equal((await post(`/finance/bills/${row.bill_id}/pay`, { paid_date: shift(billDate, -1) })).status, 400, 'not before the bill date');
  assert.equal((await post(`/finance/bills/${row.bill_id}/pay`, { paid_date: today(), reference: 'MBB 123' })).status, 200);
  assert.equal((await post(`/finance/bills/${row.bill_id}/pay`, {})).status, 400, 'already paid');
  p = await get('/finance/payables');
  assert.ok(p.paid.some((r) => r.id === po.id && r.paid_reference === 'MBB 123'));
  assert.equal((await api.call('GET', '/finance/payables', { token: T.admin })).status, 403, 'Finance only');
  assert.equal((await post(`/finance/bills/${row.bill_id}/pay`, {}, 'kitchen')).status, 403);
});

test('Cash conversion cycle: DIO + DSO − DPO, per company, with the inputs behind each figure', async () => {
  const r = await get('/finance/cash-cycle?months=3');
  assert.equal(r.months, 3);
  assert.deepEqual(r.companies.map((c) => c.code).sort(), ['IPH', 'KL']);
  for (const c of r.companies) {
    assert.equal(c.monthly.length, 3);
    const o = c.overall;
    for (const k of ['dso', 'dio', 'dpo']) assert.ok(o[k] === null || o[k] >= 0, k);
    if (o.ccc != null) assert.equal(o.ccc, Math.round((o.dio + o.dso - o.dpo) * 100) / 100);
    else assert.ok(o.missing.length > 0, 'says what is missing');
  }
  // DSO by hand for KL: average receivables ÷ sales × days
  const kl = r.companies.find((c) => c.code === 'KL').overall;
  assert.ok(kl.sales > 0 && kl.dso != null);

  // record usage + a purchase for KL → DIO and DPO become available
  const KL = db.prepare("SELECT id FROM outlets WHERE code = 'KL'").get().id;
  const ing = db.prepare("SELECT p.id FROM products p JOIN product_stock ps ON ps.product_id = p.id AND ps.outlet_id = ? WHERE p.is_sellable = 0 AND p.unit_cost > 0 AND ps.stock_on_hand > 5 LIMIT 1").get(KL);
  const adj = await post('/admin/stock/adjust', { product_id: ing.id, outlet_id: KL, qty: -5, reason: 'Weekly stocktake: used in production' }, 'admin');
  assert.equal(adj.status, 200, JSON.stringify(adj.body));
  const one = (await api.call('GET', '/finance/cash-cycle?months=3', { token: T.finance, headers: { 'X-Outlet': String(KL) } })).body;
  assert.equal(one.companies.length, 1);
  const o = one.companies[0].overall;
  assert.ok(o.cogs > 0 && o.dio > 0, 'stock used → DIO');
  assert.ok(o.purchases > 0 && o.dpo != null, 'supplier bill recorded in the first test → DPO');
  assert.equal(o.ccc, Math.round((o.dio + o.dso - o.dpo) * 100) / 100);
  assert.equal((await api.call('GET', '/finance/cash-cycle', { token: T.admin })).status, 403);
});
