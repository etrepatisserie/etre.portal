// Order-to-cash phase 2: amount received + payment date, uploaded invoice details, invoice / DO replacement
// history, manual DOs, per-company invoice / DO method, collection view and follow-up notes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer, pdfBlob } from './helpers.js';

isolatedEnv();
let api, db, T = {}, sku = {};
before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  for (const [k, e, p] of [['admin', 'admin@demo.test', 'admin123'], ['adminIPH', 'admin.ipoh@demo.test', 'admin123'], ['finance', 'finance@demo.test', 'finance123'],
    ['kitchen', 'kitchen@demo.test', 'kitchen123'], ['harbor', 'harbor@demo.test', 'customer123'], ['bean', 'beanbloom@demo.test', 'customer123'], ['cafe', 'cafe@demo.test', 'customer123']]) T[k] = await api.login(e, p);
  for (const p of (await api.call('GET', '/admin/products', { token: T.admin })).body) sku[p.sku] = p.id;
});
after(() => api.close());

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const get = (url, who) => api.call('GET', url, { token: T[who] });
async function approvedOrder(who = 'harbor') {
  const i = (await get('/customer/checkout-info', who)).body;
  const r = await api.call('POST', '/customer/orders', { token: T[who], body: { lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method: 'pickup', fulfil_date: i.window.by_method.pickup[0], time_slot: i.pickup_slots[0] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await api.call('POST', `/admin/sales-orders/${r.body.id}/approve`, { token: T.admin })).status, 200);
  return r.body.id;
}
const invoiceGenerated = (soId) => { const f = new FormData(); f.append('mode', 'generate'); return api.call('POST', `/finance/orders/${soId}/invoice`, { token: T.finance, form: f }); };

test('Verify records the amount received and payment date; a different amount is flagged', async () => {
  const so = await approvedOrder();
  const inv = (await invoiceGenerated(so)).body;
  const f = new FormData(); f.append('invoice_ids', String(inv.id)); f.append('reference', 'IBG 123'); f.append('slip', pdfBlob('slip'), 'slip.pdf');
  const slip = await api.call('POST', '/customer/slips', { token: T.harbor, form: f });
  assert.equal(slip.status, 201, JSON.stringify(slip.body));
  const listed = (await get('/finance/slips?status=Pending', 'finance')).body.find((s) => s.id === slip.body.id);
  assert.equal(listed.expected, inv.total, 'expected = amount still owed');
  const v = (body) => api.call('POST', `/finance/slips/${slip.body.id}/verify`, { token: T.finance, body });
  assert.equal((await v({})).status, 400, 'amount + date required');
  assert.equal((await v({ amount_received: inv.total, payment_date: '2999-01-01' })).status, 400, 'no future dates');
  const less = Math.round((inv.total - 10) * 100) / 100;
  const ok = await v({ amount_received: less, payment_date: today() });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.mismatch, true);
  assert.equal(ok.body.difference, -10);
  const row = db.prepare('SELECT amount_received, payment_date FROM payment_slips WHERE id = ?').get(slip.body.id);
  assert.equal(row.amount_received, less); assert.equal(row.payment_date, today());
  assert.equal(db.prepare('SELECT paid_at FROM invoices WHERE id = ?').get(inv.id).paid_at.slice(0, 10), today(), 'paid on the payment date');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE entity = 'payment_slip' AND action = 'verified' AND entity_id = ?").get(slip.body.id));
  const hist = (await get(`/finance/customers/${db.prepare("SELECT customer_id FROM users WHERE email='harbor@demo.test'").get().customer_id}/collection`, 'finance')).body;
  assert.ok(hist.payments.some((p) => p.id === slip.body.id && p.amount_received === less && p.payment_date === today()), 'payment history per customer');
});

test('Manual invoice upload records its number, dates and amount; only Finance replaces it, with a reason and history', async () => {
  const so = await approvedOrder();
  const f = new FormData(); f.append('mode', 'upload'); f.append('invoice_file', pdfBlob('bukku invoice'), 'inv.pdf');
  assert.equal((await api.call('POST', `/finance/orders/${so}/invoice`, { token: T.finance, form: f })).status, 400, 'invoice number required');
  const g = new FormData(); g.append('mode', 'upload'); g.append('invoice_file', pdfBlob('bukku invoice'), 'inv.pdf');
  g.append('external_number', 'IV-00451'); g.append('invoice_date', today()); g.append('due_date', today()); g.append('amount', '1.00');
  const r = await api.call('POST', `/finance/orders/${so}/invoice`, { token: T.finance, form: g });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.external_number, 'IV-00451');
  assert.equal(r.body.issue_method, 'uploaded');
  assert.equal(r.body.amount_mismatch, true, 'amount differs from the order total');
  assert.ok(r.body.uploaded_by && r.body.uploaded_at);
  // replace: finance only, reason required, history kept
  const rep = (who, reason) => { const h = new FormData(); h.append('kind', 'invoice'); h.append('file', pdfBlob('corrected'), 'inv2.pdf'); if (reason) h.append('reason', reason); return api.call('POST', `/finance/invoices/${r.body.id}/documents`, { token: T[who], form: h }); };
  assert.equal((await rep('finance')).status, 400, 'reason required to replace');
  assert.equal((await rep('admin', 'x')).status, 403, 'admin cannot use the finance endpoint');
  assert.equal((await rep('finance', 'Wrong SST on first copy')).status, 200);
  const hist = (await get(`/finance/invoices/${r.body.id}/documents`, 'finance')).body;
  assert.equal(hist.versions.length, 1); assert.equal(hist.versions[0].reason, 'Wrong SST on first copy'); assert.ok(hist.versions[0].replaced_file_id);
  // a generated invoice can't be replaced by a file
  const so2 = await approvedOrder();
  const gen = (await invoiceGenerated(so2)).body;
  const h = new FormData(); h.append('kind', 'invoice'); h.append('file', pdfBlob('x'), 'x.pdf'); h.append('reason', 'x');
  assert.equal((await api.call('POST', `/finance/invoices/${gen.id}/documents`, { token: T.finance, form: h })).status, 400);
});

test('Manual DO upload: Admin or Finance; one DO per order (new upload replaces, with a reason); customer can view; kitchen cannot', async () => {
  const so = await approvedOrder();
  const inv = (await invoiceGenerated(so)).body;
  const up = (who, path, reason) => { const f = new FormData(); f.append('file', pdfBlob('signed do'), 'do.pdf'); f.append('do_date', today()); if (path.includes('documents')) f.append('kind', 'do'); if (reason) f.append('reason', reason); return api.call('POST', path, { token: T[who], form: f }); };
  const a = await up('admin', `/admin/invoices/${inv.id}/do`);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.do_source, 'uploaded'); assert.equal(a.body.do_number, inv.do_number, 'still one DO number for the order');
  assert.equal((await up('finance', `/finance/invoices/${inv.id}/documents`)).status, 400, 'replacing needs a reason');
  assert.equal((await up('finance', `/finance/invoices/${inv.id}/documents`, 'Customer signed copy')).status, 200);
  assert.equal((await get(`/finance/invoices/${inv.id}/documents`, 'finance')).body.versions.filter((v) => v.kind === 'do').length, 2);
  assert.equal((await get(`/documents/invoices/${inv.id}/do`, 'harbor')).status, 200, 'customer downloads the DO');
  assert.equal((await get(`/documents/invoices/${inv.id}/do`, 'kitchen')).status, 403);
  assert.equal((await up('adminIPH', `/admin/invoices/${inv.id}/do`)).status, 404, 'other outlet cannot');
});

test('Per-company DO method: "uploaded" hides the generated DO until one is uploaded; methods are head-office settings', async () => {
  const KL = db.prepare("SELECT id FROM outlets WHERE code = 'KL'").get().id;
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${KL}`, { token: T.admin, body: { do_method: 'bad' } })).status, 400);
  assert.equal((await api.call('PUT', `/admin/settings/outlets/${KL}`, { token: T.admin, body: { do_method: 'uploaded', invoice_method: 'uploaded' } })).status, 200);
  const so = await approvedOrder();
  const inv = (await invoiceGenerated(so)).body;
  assert.equal((await get(`/documents/invoices/${inv.id}/do`, 'finance')).status, 404, 'no DO until uploaded');
  assert.equal((await get(`/documents/invoices/${inv.id}/invoice`, 'finance')).status, 200, 'invoice workflow unaffected');
  await api.call('PUT', `/admin/settings/outlets/${KL}`, { token: T.admin, body: { do_method: 'generated', invoice_method: 'generated' } });
  assert.equal((await get(`/documents/invoices/${inv.id}/do`, 'finance')).status, 200);
});

test('Collection view: due today / within 7 days / overdue 1–7, 8–14, >14 per company; follow-up notes', async () => {
  const c = (await get('/finance/collection', 'finance')).body;
  assert.deepEqual(c.companies.map((x) => x.code).sort(), ['IPH', 'KL'], 'each company separately');
  const kl = c.companies.find((x) => x.code === 'KL');
  assert.deepEqual(kl.buckets.map((b) => b.key), ['due_today', 'due_7', 'over_1_7', 'over_8_14', 'over_15']);
  const all = kl.buckets.flatMap((b) => b.invoices);
  assert.ok(all.length > 0);
  for (const b of kl.buckets) for (const i of b.invoices) {
    if (b.key === 'due_today') assert.equal(i.days_late, 0);
    if (b.key === 'over_8_14') assert.ok(i.days_late >= 8 && i.days_late <= 14);
    if (b.key === 'over_15') assert.ok(i.days_late > 14);
  }
  // outlet scoping: the KL tab shows KL only
  const only = (await api.call('GET', '/finance/collection', { token: T.finance, headers: { 'X-Outlet': String(db.prepare("SELECT id FROM outlets WHERE code='KL'").get().id) } })).body;
  assert.deepEqual(only.companies.map((x) => x.code), ['KL']);
  const cid = all[0].customer_id;
  assert.equal((await api.call('POST', `/finance/customers/${cid}/notes`, { token: T.finance, body: {} })).status, 400);
  const n = await api.call('POST', `/finance/customers/${cid}/notes`, { token: T.finance, body: { contact: 'Spoke to the owner', promised_date: today(), remarks: 'Will transfer today' } });
  assert.equal(n.status, 201);
  assert.ok((await get(`/finance/customers/${cid}/collection`, 'finance')).body.notes.some((x) => x.remarks === 'Will transfer today'));
  assert.equal((await api.call('GET', '/finance/collection', { token: T.admin })).status, 403, 'finance only');
});
