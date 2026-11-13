// Complaints → credit note (Finance issues) or replacement order; Finance's own credit notes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer, pdfBlob } from './helpers.js';

isolatedEnv();
let api, db, T = {}, sku = {};
before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  for (const [k, e, p] of [['admin', 'admin@demo.test', 'admin123'], ['finance', 'finance@demo.test', 'finance123'], ['kitchen', 'kitchen@demo.test', 'kitchen123'],
    ['harbor', 'harbor@demo.test', 'customer123'], ['maple', 'maple@demo.test', 'customer123']]) T[k] = await api.login(e, p);
  for (const p of (await api.call('GET', '/admin/products', { token: T.admin })).body) sku[p.sku] = p.id;
});
after(() => api.close());

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const get = (url, who) => api.call('GET', url, { token: T[who] }).then((r) => r.body);
const post = (url, who, body = {}) => api.call('POST', url, { token: T[who], body });

// a delivered order with one complaint: 10 croissants, 3 reported damaged
async function complaint(who = 'harbor', { invoice = true, method = 'delivery' } = {}) {
  const i = await get('/customer/checkout-info', who);
  const placed = await post('/customer/orders', who, { lines: [{ product_id: sku['V-BCR-001'], quantity: 10 }, { product_id: sku['V-PAC-001'], quantity: 5 }], method, fulfil_date: i.window.dates[0], time_slot: (method === 'pickup' ? i.pickup_slots : i.delivery_slots)[0] });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const id = placed.body.id;
  if (invoice) { const f = new FormData(); f.append('mode', 'generate'); assert.equal((await api.call('POST', `/finance/orders/${id}/invoice`, { token: T.finance, form: f })).status, 201); }
  db.prepare('UPDATE sales_orders SET status = ? WHERE id = ?').run(method === 'pickup' ? 'Ready for Pickup' : 'Out for Delivery', id);
  const so = await get(`/customer/orders/${id}`, who);
  const line = so.lines.find((l) => l.sku === 'V-BCR-001');
  const f = new FormData();
  f.append('data', JSON.stringify({ matches_do: false, discrepancies: [{ line_id: line.id, qty: 3, note: '3 croissants crushed' }] }));
  f.append('photo', pdfBlob('photo'), 'photo.pdf');
  assert.equal((await api.call('POST', `/customer/orders/${id}/receive`, { token: T[who], form: f })).status, 200);
  const d = (await get('/admin/discrepancies?status=Open', 'admin')).find((x) => x.so_id === id);
  return { id, line, d };
}

test('Complaint → Admin offers a credit note → Finance is alerted and issues it → amount due drops', async () => {
  const { id, line, d } = await complaint();
  assert.equal(d.line_qty, 10); assert.equal(d.unit_price, line.unit_price);
  assert.equal((await post(`/admin/discrepancies/${d.id}/resolve`, 'admin', { resolution: 'x' })).status, 404, 'free-text "resolve" is gone: credit note or replacement only');
  assert.equal((await post(`/admin/discrepancies/${d.id}/credit-note`, 'admin', { qty: 11 })).status, 400, 'cannot credit more than was ordered');

  const req = await post(`/admin/discrepancies/${d.id}/credit-note`, 'admin', { qty: 3 });
  assert.equal(req.status, 201);
  assert.equal(req.body.status, 'Requested'); assert.equal(req.body.cn_number, null, 'no number until Finance issues it');
  const expected = r2(r2(3 * line.unit_price) * 1.06);
  assert.equal(req.body.total, expected);
  const after = (await get('/admin/discrepancies?status=Resolved', 'admin')).find((x) => x.id === d.id);
  assert.equal(after.action, 'credit_note'); assert.equal(after.credit_note.status, 'Requested');
  assert.equal((await post(`/admin/discrepancies/${d.id}/replacement`, 'admin', {})).status, 400, 'already resolved');

  // Finance: alert + to-do count + list
  assert.ok(db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'finance' AND n.type = 'credit_note' AND n.link = '/finance/credit-notes'").get(), 'finance alerted');
  assert.ok((await get('/finance/dashboard', 'finance')).credit_notes_to_issue >= 1);
  const list = await get('/finance/credit-notes?status=Requested', 'finance');
  const cn = list.find((x) => x.id === req.body.id);
  assert.ok(cn.inv_number && cn.complaint_note === '3 croissants crushed');
  assert.equal((await get(`/customer/credit-notes`, 'harbor')).length, 0, 'customer sees nothing until it is issued');

  // Finance issues (lowers to 2)
  const inv = db.prepare('SELECT * FROM invoices WHERE so_id = ?').get(id);
  const issued = await post(`/finance/credit-notes/${cn.id}/issue`, 'finance', { items: [{ line_id: line.id, qty: 2 }] });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.match(issued.body.cn_number, /^CN-KL-\d{4}-0001$/);
  assert.equal(issued.body.total, r2(r2(2 * line.unit_price) * 1.06));
  assert.equal(issued.body.settlement, 'Reduces amount due');
  assert.equal((await post(`/finance/credit-notes/${cn.id}/issue`, 'finance')).status, 400, 'cannot issue twice');

  // balance everywhere: invoice list, aging, customer payments
  const row = (await get('/finance/invoices', 'finance')).find((x) => x.id === inv.id);
  assert.equal(row.credited, issued.body.total); assert.equal(row.balance, r2(inv.total - issued.body.total));
  assert.equal((await get('/finance/aging', 'finance')).invoices.find((x) => x.id === inv.id).balance, row.balance);
  const mine = (await get('/customer/invoices', 'harbor')).find((x) => x.id === inv.id);
  assert.equal(mine.balance, row.balance);
  const credits = await get('/customer/credit-notes', 'harbor');
  assert.equal(credits[0].cn_number, issued.body.cn_number);
  assert.ok(db.prepare("SELECT 1 FROM email_outbox WHERE template = 'credit_note_issued' AND subject LIKE ?").get(`%${issued.body.cn_number}%`), 'customer emailed');
  assert.ok(db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'admin' AND n.title LIKE ?").get(`%${issued.body.cn_number}%`), 'admin told it was issued');

  // PDF: customer, finance and admin can open it; another customer cannot
  const pdf = await api.call('GET', `/documents/credit-notes/${cn.id}`, { token: T.harbor });
  assert.equal(pdf.status, 200); assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  assert.equal((await api.call('GET', `/documents/credit-notes/${cn.id}`, { token: T.admin })).status, 200);
  assert.equal((await api.call('GET', `/documents/credit-notes/${cn.id}`, { token: T.maple })).status, 404);
  assert.equal((await api.call('GET', `/documents/credit-notes/${cn.id}`, { token: T.kitchen })).status, 403);

  // monthly report shows it and the net SST
  const rep = (await get('/finance/reports', 'finance')).companies.find((c) => c.code === 'KL');
  assert.equal(rep.credit_notes.count, 1);
  assert.equal(rep.net.sst, r2(rep.invoiced.sst - rep.credit_notes.sst));
  const xlsx = await api.call('GET', '/finance/reports/download', { token: T.finance });
  assert.equal(xlsx.status, 200);
});

test('Finance declines → complaint goes back to Admin → replacement order at no charge, never invoiced', async () => {
  const { id, d } = await complaint();
  const req = await post(`/admin/discrepancies/${d.id}/credit-note`, 'admin', {});
  assert.equal(req.body.lines[0].quantity, 3, 'defaults to the quantity the customer reported');
  assert.equal((await post(`/finance/credit-notes/${req.body.id}/reject`, 'finance', {})).status, 400, 'reason required');
  assert.equal((await post(`/finance/credit-notes/${req.body.id}/reject`, 'finance', { reason: 'Photo shows they were fine' })).status, 200);
  const back = (await get('/admin/discrepancies?status=Open', 'admin')).find((x) => x.id === d.id);
  assert.ok(back, 'reopened'); assert.match(back.resolution, /declined by Finance/);
  const cust = await get(`/customer/orders/${id}`, 'harbor');
  assert.equal(cust.discrepancies[0].resolution, null, "Finance's internal reason is not shown to the customer");

  const ci = await get(`/admin/checkout-info?customer_id=${back.customer_id}`, 'admin');
  assert.equal((await post(`/admin/discrepancies/${d.id}/replacement`, 'admin', { qty: 3, method: 'delivery', fulfil_date: '2000-01-01', time_slot: ci.delivery_slots[0] })).status, 400, 'date must be in the window');
  const rep = await post(`/admin/discrepancies/${d.id}/replacement`, 'admin', { qty: 3, method: 'delivery', fulfil_date: ci.window.dates[0], time_slot: ci.delivery_slots[0] });
  assert.equal(rep.status, 201, JSON.stringify(rep.body));
  const so = await get(`/admin/sales-orders/${rep.body.id}`, 'admin');
  assert.equal(so.total, 0); assert.equal(so.replacement_for, id); assert.equal(so.status, 'Confirmed');
  assert.equal(so.lines.length, 1); assert.equal(so.lines[0].quantity, 3); assert.equal(so.lines[0].unit_price, 0);
  assert.ok((await get('/kitchen/orders?status=', 'kitchen')).some((o) => o.id === so.id), 'kitchen gets it');
  assert.ok(!(await get('/finance/orders-to-invoice', 'finance')).some((o) => o.id === so.id), 'finance does not invoice it');
  const f = new FormData(); f.append('mode', 'generate');
  assert.equal((await api.call('POST', `/finance/orders/${so.id}/invoice`, { token: T.finance, form: f })).status, 400);
  const resolved = (await get('/admin/discrepancies?status=Resolved', 'admin')).find((x) => x.id === d.id);
  assert.equal(resolved.action, 'replacement'); assert.equal(resolved.replacement_so_number, so.so_number);
  assert.match(so.so_number, /^SO-KL-/, 'real numbering for real orders');
});

test('Credit note request waits for the invoice; Finance can raise its own; full credit settles the invoice', async () => {
  const { id, line, d } = await complaint('harbor', { invoice: false, method: 'pickup' }); // pickup: no delivery fee, so the goods are the whole invoice
  const req = (await post(`/admin/discrepancies/${d.id}/credit-note`, 'admin', { qty: 1 })).body;
  const early = await post(`/finance/credit-notes/${req.id}/issue`, 'finance');
  assert.equal(early.status, 400); assert.match(early.body.error, /invoice/i);
  const f = new FormData(); f.append('mode', 'generate');
  await api.call('POST', `/finance/orders/${id}/invoice`, { token: T.finance, form: f });
  assert.equal((await post(`/finance/credit-notes/${req.id}/issue`, 'finance')).status, 200);

  // Finance's own credit note for the rest of the order → invoice fully credited → settled
  const inv = db.prepare('SELECT * FROM invoices WHERE so_id = ?').get(id);
  const so = await get(`/admin/sales-orders/${id}`, 'admin');
  const pac = so.lines.find((l) => l.sku === 'V-PAC-001');
  assert.equal((await post('/finance/credit-notes', 'finance', { invoice_id: inv.id, items: [{ line_id: line.id, qty: 10 }], reason: 'x' })).status, 400, 'only 9 croissants left to credit');
  assert.equal((await post('/finance/credit-notes', 'finance', { invoice_id: inv.id, items: [{ line_id: line.id, qty: 9 }] })).status, 400, 'reason required');
  const own = await post('/finance/credit-notes', 'finance', { invoice_id: inv.id, items: [{ line_id: line.id, qty: 9 }, { line_id: pac.id, qty: 5 }], reason: 'Order spoiled — goodwill' });
  assert.equal(own.status, 201, JSON.stringify(own.body));
  assert.match(own.body.cn_number, /^CN-KL-\d{4}-\d{4}$/); assert.equal(own.body.discrepancy_id, null);
  const left = db.prepare('SELECT payment_status FROM invoices WHERE id = ?').get(inv.id);
  const credited = db.prepare("SELECT SUM(total) AS t FROM credit_notes WHERE invoice_id = ? AND status = 'Issued'").get(inv.id).t;
  assert.equal(inv.delivery_fee, 0);
  assert.equal(r2(credited), inv.total, 'whole invoice credited');
  assert.equal(left.payment_status, 'Paid', 'fully credited → settled');
  assert.equal((await post('/finance/credit-notes', 'finance', { invoice_id: inv.id, items: [{ line_id: pac.id, qty: 1 }], reason: 'again' })).status, 400, 'nothing left to credit');
  assert.equal((await post('/admin/discrepancies/1/credit-note', 'kitchen', {})).status, 403);
  assert.equal((await post('/finance/credit-notes', 'admin', { invoice_id: inv.id })).status, 403, 'only Finance issues credit notes');
});
