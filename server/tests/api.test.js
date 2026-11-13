// API tests against a real server with freshly seeded mock data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer, walk, pdfBlob } from './helpers.js';

isolatedEnv();
let api, T = {}, sku = {}, db;

before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  for (const [k, e, p] of [['admin', 'admin@demo.test', 'admin123'], ['finance', 'finance@demo.test', 'finance123'], ['kitchen', 'kitchen@demo.test', 'kitchen123'],
    ['harbor', 'harbor@demo.test', 'customer123'], ['cafe', 'cafe@demo.test', 'customer123'], ['maple', 'maple@demo.test', 'customer123'],
    ['oven', 'littleoven@demo.test', 'customer123'], ['bean', 'beanbloom@demo.test', 'customer123']]) T[k] = await api.login(e, p);
  for (const p of (await api.call('GET', '/admin/products', { token: T.admin })).body) sku[p.sku] = p.id;
});
after(() => api.close());

const info = async (who) => (await api.call('GET', '/customer/checkout-info', { token: T[who] })).body;
const COD = ['cafe', 'oven', 'bean'];
async function placeOrder(who, lines, { method = 'delivery', dateIndex = 0, slip = COD.includes(who) } = {}) {
  const i = await info(who);
  const body = {
    lines: lines.map(([s, q]) => ({ product_id: sku[s], quantity: q })), method,
    fulfil_date: i.window.dates[dateIndex], time_slot: (method === 'pickup' ? i.pickup_slots : i.delivery_slots)[0], area_confirmed: true,
  };
  if (!slip) return api.call('POST', '/customer/orders', { token: T[who], body });
  const f = new FormData(); f.append('data', JSON.stringify(body)); f.append('slip', pdfBlob('order slip'), 'slip.pdf');
  return api.call('POST', '/customer/orders', { token: T[who], form: f });
}
const order = (id, who = 'admin') => api.call('GET', who === 'admin' ? `/admin/sales-orders/${id}` : `/customer/orders/${id}`, { token: T[who] }).then((r) => r.body);
const orderSlip = (soId) => db.prepare('SELECT * FROM payment_slips WHERE so_id = ? ORDER BY id DESC').get(soId);
function invoiceIt(id) { const f = new FormData(); f.append('mode', 'generate'); return api.call('POST', `/finance/orders/${id}/invoice`, { token: T.finance, form: f }); }
function uploadSlip(who, invoiceIds, blob = pdfBlob('slip'), name = 'slip.pdf') {
  const f = new FormData(); f.append('slip', blob, name); f.append('invoice_ids', JSON.stringify(invoiceIds)); f.append('reference', 'TEST');
  return api.call('POST', '/customer/slips', { token: T[who], form: f });
}
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
test('Central Kitchen never receives prices, invoices or payment data', async () => {
  // make sure there is at least one released order with lines
  const ids = (await api.call('GET', '/kitchen/orders?status=', { token: T.kitchen })).body.map((o) => o.id);
  assert.ok(ids.length > 3, 'kitchen sees orders');
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const urls = ['/kitchen/dashboard', '/kitchen/orders?status=', `/kitchen/orders/${ids[0]}`, `/kitchen/production?from=2026-01-01&to=${today}`,
    `/kitchen/report?from=2026-01-01&to=${today}`, '/kitchen/products', '/kitchen/ingredients', '/kitchen/movements', '/notifications', '/auth/me'];
  const FORBIDDEN_KEYS = /price|total|amount|sst|fee|cost|invoice|payment|slip|bank|paid|due|term/i;
  const FORBIDDEN_TEXT = /RM\s?\d|INV-|invoice|payment|slip|bank|\bpaid\b/i;
  for (const url of urls) {
    const r = await api.call('GET', url, { token: T.kitchen });
    assert.equal(r.status, 200, url);
    const { keys, strings } = walk(r.body);
    const badKeys = keys.filter((k) => FORBIDDEN_KEYS.test(k));
    const badText = strings.filter((s) => FORBIDDEN_TEXT.test(s));
    assert.deepEqual(badKeys, [], `${url} exposes keys ${badKeys}`);
    assert.deepEqual(badText, [], `${url} exposes text ${badText.slice(0, 3)}`);
  }
});

test('Central Kitchen is refused on admin, finance, customer, invoice and slip endpoints', async () => {
  const inv = db.prepare('SELECT id FROM invoices LIMIT 1').get();
  const slipFile = db.prepare('SELECT file_id FROM payment_slips LIMIT 1').get();
  for (const url of ['/admin/sales-orders', '/admin/dashboard', '/admin/products', '/finance/invoices', '/finance/slips', '/finance/aging',
    '/customer/products', `/documents/invoices/${inv.id}/invoice`, `/documents/invoices/${inv.id}/do`, `/files/${slipFile.file_id}`]) {
    const r = await api.call('GET', url, { token: T.kitchen });
    assert.equal(r.status, 403, `${url} should be 403, got ${r.status}`);
  }
});

// ---------------------------------------------------------------------------
test('COD customer with a slip uploaded but not verified is blocked from ordering', async () => {
  const r = await placeOrder('cafe', [['V-BCR-001', 5]]);
  assert.equal(r.status, 409);
  assert.equal(r.body.blocked, true);
  assert.ok(r.body.invoices.some((i) => i.payment_status === 'Slip Uploaded'), 'Slip Uploaded invoice listed');
  assert.match(r.body.error, /INV-KL-\d{4}-\d{4}/);
  assert.equal((await info('cafe')).blocked, true);
});

test('14-day customer: blocked only by an overdue invoice', async () => {
  assert.equal((await placeOrder('maple', [['V-BCR-001', 5]])).status, 409, 'Maple has an overdue invoice');
  assert.equal((await placeOrder('harbor', [['V-BCR-001', 5]])).status, 201, 'Harbor has unpaid but not overdue invoices');
});

test('COD customers must attach the payment slip when ordering; 14-day customers do not', async () => {
  const noSlip = await placeOrder('oven', [['SN-TUN-001', 6]], { slip: false });
  assert.equal(noSlip.status, 400);
  assert.match(noSlip.body.error, /payment slip/i);
  assert.equal((await placeOrder('harbor', [['SN-TUN-001', 6]])).status, 201, '14-day customer needs no slip');
});

test('Order block lifecycle: slip sent with order → invoice issued (Slip Uploaded, still blocked) → verified (can order)', async () => {
  const first = await placeOrder('oven', [['SN-TUN-001', 6]]);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const slip = orderSlip(first.body.id);
  assert.equal(slip.status, 'Pending');
  assert.equal((await api.call('POST', `/finance/slips/${slip.id}/verify`, { token: T.finance })).status, 400, 'verify needs an invoice first');

  const inv = (await invoiceIt(first.body.id)).body;
  assert.match(inv.inv_number, /^INV-KL-\d{4}-\d{4}$/);
  assert.equal(inv.payment_status, 'Slip Uploaded', 'COD slip attached to the invoice automatically');

  let r = await placeOrder('oven', [['SN-TUN-001', 6]]);
  assert.equal(r.status, 409, 'Slip Uploaded still blocks');
  assert.equal(r.body.invoices[0].payment_status, 'Slip Uploaded');

  assert.equal((await api.call('POST', `/finance/slips/${slip.id}/verify`, { token: T.finance })).status, 200);
  r = await placeOrder('oven', [['SN-TUN-001', 6]]);
  assert.equal(r.status, 201, 'Verified payment unblocks');
});

test('Unpaid COD invoice (no slip, e.g. phone order by Admin) blocks the customer', async () => {
  const oven = db.prepare("SELECT id FROM customers WHERE code = 'CUS-004'").get().id;
  const i = await info('oven');
  const o = await api.call('POST', '/admin/sales-orders', { token: T.admin, body: { customer_id: oven, lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method: 'pickup', fulfil_date: i.window.dates[0], time_slot: i.pickup_slots[0] } });
  assert.equal(o.status, 201, 'staff orders do not need a slip');
  const inv = (await invoiceIt(o.body.id)).body;
  assert.equal(inv.payment_status, 'Unpaid');
  const r = await placeOrder('oven', [['V-BCR-001', 5]]);
  assert.equal(r.status, 409);
  assert.ok(r.body.invoices.some((x) => x.inv_number === inv.inv_number));
  const slip = await uploadSlip('oven', [inv.id]);
  await api.call('POST', `/finance/slips/${slip.body.id}/verify`, { token: T.finance });
});

test('Rejected slip keeps the customer blocked and needs a reason', async () => {
  const o = await placeOrder('bean', [['V-BCR-001', 5]], { method: 'pickup' });
  const inv = (await invoiceIt(o.body.id)).body;
  const slip = orderSlip(o.body.id);
  assert.equal((await api.call('POST', `/finance/slips/${slip.id}/reject`, { token: T.finance, body: {} })).status, 400, 'reason required');
  assert.equal((await api.call('POST', `/finance/slips/${slip.id}/reject`, { token: T.finance, body: { reason: 'Amount does not match' } })).status, 200);
  const invs = (await api.call('GET', '/customer/invoices', { token: T.bean })).body;
  assert.equal(invs.find((i) => i.id === inv.id).payment_status, 'Rejected');
  assert.equal((await placeOrder('bean', [['V-BCR-001', 5]])).status, 409);
  assert.equal((await uploadSlip('bean', [inv.id])).status, 201, 'can re-upload after rejection');
});

// ---------------------------------------------------------------------------
test('Orders go straight to the kitchen; Finance is alerted to invoice; no admin confirmation', async () => {
  const r = await placeOrder('harbor', [['V-KOA-001', 5]]);
  const id = r.body.id;
  const o = await order(id);
  assert.equal(o.status, 'Confirmed');
  assert.equal((await api.call('POST', `/admin/sales-orders/${id}/confirm`, { token: T.admin })).status, 404, 'no confirm step any more');
  const k = (await api.call('GET', '/kitchen/orders?status=New', { token: T.kitchen })).body;
  assert.ok(k.some((x) => x.id === id && x.can_start), 'kitchen sees it immediately');
  assert.ok((await api.call('GET', '/finance/orders-to-invoice', { token: T.finance })).body.some((x) => x.id === id), 'in Finance invoice queue');
  const so = o.so_number;
  assert.ok(db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'finance' AND n.title = ?").get(`Issue invoice: ${so}`), 'finance alerted');
  // kitchen can start without waiting for the invoice
  await api.call('POST', `/kitchen/orders/${id}/printed`, { token: T.kitchen });
  assert.equal((await api.call('POST', `/kitchen/orders/${id}/processing`, { token: T.kitchen })).status, 200);
  assert.equal((await order(id)).status, 'Processing');
  assert.equal((await order(id)).invoice, null, 'still not invoiced — invoicing runs alongside');
});

test('Cancel: customer can cancel until the kitchen starts, then the API refuses', async () => {
  const a = await placeOrder('harbor', [['V-PAC-001', 5]]);
  assert.equal((await api.call('POST', `/customer/orders/${a.body.id}/cancel`, { token: T.harbor })).status, 200);
  assert.equal((await order(a.body.id)).status, 'Cancelled');

  const b = await placeOrder('harbor', [['V-PAC-001', 5]]);
  await api.call('POST', `/kitchen/orders/${b.body.id}/printed`, { token: T.kitchen });
  await api.call('POST', `/kitchen/orders/${b.body.id}/processing`, { token: T.kitchen });
  const r = await api.call('POST', `/customer/orders/${b.body.id}/cancel`, { token: T.harbor });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /kitchen has already started/i);
  assert.equal((await order(b.body.id)).status, 'Processing');
});

// ---------------------------------------------------------------------------
test('Delivery fee: RM25 below RM500, free at exactly RM500 and above; SST 6% on subtotal + fee', async () => {
  const cases = [
    [[['V-BCR-001', 5]], 22.5, 25],                           // 5 × 4.50
    [[['C-CCC-001', 4], ['C-TIR-001', 1]], 499, 25],          // 400 + 99
    [[['C-CCC-001', 5]], 500, 0],                             // exactly 500
    [[['P-BCH-001', 5]], 550, 0],
  ];
  for (const [lines, sub, fee] of cases) {
    const r = await placeOrder('harbor', lines);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const o = await order(r.body.id, 'harbor');
    assert.equal(o.subtotal, sub);
    assert.equal(o.delivery_fee, fee, `subtotal ${sub}`);
    assert.equal(o.sst_amount, r2((sub + fee) * 0.06));
    assert.equal(o.total, r2(sub + fee + o.sst_amount));
    assert.equal(Number(o.total.toFixed(2)), o.total, 'two decimals');
  }
  const p = await placeOrder('harbor', [['V-BCR-001', 5]], { method: 'pickup' });
  const po = await order(p.body.id, 'harbor');
  assert.deepEqual([po.delivery_fee, po.sst_amount, po.total], [0, 1.35, 23.85]);
});

test('Checkout rules: MOQ, unavailable products, dates outside the window, delivery area', async () => {
  assert.equal((await placeOrder('harbor', [['V-BCR-001', 4]])).status, 400, 'below MOQ');
  assert.equal((await placeOrder('harbor', [['P-MNG-001', 4]])).status, 400, 'unavailable product');
  assert.equal((await placeOrder('harbor', [['ING-BTR', 1]])).status, 400, 'ingredient not for sale');
  const i = await info('harbor');
  const early = await api.call('POST', '/customer/orders', { token: T.harbor, body: { lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method: 'delivery', fulfil_date: i.now_myt, time_slot: i.delivery_slots[0], area_confirmed: true } });
  assert.equal(early.status, 400, 'today is never allowed');
  const noArea = await api.call('POST', '/customer/orders', { token: T.harbor, body: { lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method: 'delivery', fulfil_date: i.window.dates[0], time_slot: i.delivery_slots[0], delivery_address: '5 Somewhere Else, Shah Alam', area_confirmed: false } });
  assert.equal(noArea.status, 400, 'a different address must be confirmed as KL / Klang Valley');
  const prod = (await api.call('GET', '/customer/products', { token: T.harbor })).body[0];
  assert.equal(typeof prod.available, 'boolean', 'customers only see available yes/no');
  assert.ok(!['stock_on_hand', 'on_hold', 'unit_cost'].some((k) => k in prod), 'no stock quantities or cost for customers');
});

// ---------------------------------------------------------------------------
test('Credit term request: only after 2 months, one pending at a time', async () => {
  assert.equal((await api.call('POST', '/customer/term-request', { token: T.bean, body: {} })).status, 403, 'new account (20 days)');
  assert.equal((await api.call('GET', '/customer/profile', { token: T.bean })).body.terms.can_request, false);
  assert.equal((await api.call('POST', '/customer/term-request', { token: T.cafe, body: {} })).status, 400, 'already pending');
  assert.equal((await api.call('POST', '/customer/term-request', { token: T.harbor, body: {} })).status, 400, 'already 14 days');
  assert.equal((await api.call('GET', '/customer/profile', { token: T.oven })).body.terms.can_request, true);
  const r = await api.call('POST', '/customer/term-request', { token: T.oven, body: { note: 'please' } });
  assert.equal(r.status, 201);
  assert.equal((await api.call('POST', `/finance/term-requests/${r.body.id}/approve`, { token: T.finance, body: {} })).status, 200);
  assert.equal((await api.call('GET', '/customer/profile', { token: T.oven })).body.payment_term, 'NET14');
  assert.ok(db.prepare("SELECT 1 FROM email_outbox WHERE template = 'term_result' AND to_email = 'littleoven@demo.test'").get(), 'term result emailed');
});

// ---------------------------------------------------------------------------
test("Customers can't access each other's orders, invoices or files", async () => {
  const cafeId = db.prepare("SELECT id FROM customers WHERE code = 'CUS-001'").get().id;
  const cafeOrder = db.prepare('SELECT id FROM sales_orders WHERE customer_id = ? LIMIT 1').get(cafeId);
  const cafeInv = db.prepare('SELECT id FROM invoices WHERE customer_id = ? LIMIT 1').get(cafeId);
  const cafeSlip = db.prepare('SELECT file_id FROM payment_slips WHERE customer_id = ? LIMIT 1').get(cafeId);

  assert.equal((await api.call('GET', `/customer/orders/${cafeOrder.id}`, { token: T.harbor })).status, 404);
  assert.equal((await api.call('POST', `/customer/orders/${cafeOrder.id}/cancel`, { token: T.harbor })).status, 404);
  assert.equal((await api.call('GET', `/documents/invoices/${cafeInv.id}/invoice`, { token: T.harbor })).status, 404);
  assert.equal((await api.call('GET', `/documents/invoices/${cafeInv.id}/do`, { token: T.harbor })).status, 404);
  assert.equal((await api.call('GET', `/files/${cafeSlip.file_id}`, { token: T.harbor })).status, 403);
  assert.equal((await uploadSlip('harbor', [cafeInv.id])).status, 400, "can't pay someone else's invoice");
  assert.ok(!(await api.call('GET', '/customer/invoices', { token: T.harbor })).body.some((i) => i.customer_id === cafeId));

  // the owner can
  assert.equal((await api.call('GET', `/files/${cafeSlip.file_id}`, { token: T.cafe })).status, 200);
  const pdf = await api.call('GET', `/documents/invoices/${cafeInv.id}/invoice`, { token: T.cafe });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  // and customers can't reach staff areas
  for (const url of ['/admin/sales-orders', '/finance/invoices', '/kitchen/orders']) assert.equal((await api.call('GET', url, { token: T.harbor })).status, 403);
});

test('Uploads: only images/PDF, content must match, max 10 MB', async () => {
  const inv = db.prepare("SELECT i.id FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE c.code = 'CUS-003' AND i.payment_status IN ('Unpaid','Rejected') LIMIT 1").get();
  assert.ok(inv, 'harbor has an unpaid invoice');
  const txt = await uploadSlip('harbor', [inv.id], new Blob(['hello'], { type: 'text/plain' }), 'slip.txt');
  assert.equal(txt.status, 400);
  const fake = await uploadSlip('harbor', [inv.id], new Blob(['MZ not really a pdf'], { type: 'application/pdf' }), 'slip.pdf');
  assert.equal(fake.status, 400, 'content sniffing');
  const big = await uploadSlip('harbor', [inv.id], new Blob([Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024 + 10)])], { type: 'application/pdf' }), 'big.pdf');
  assert.equal(big.status, 400);
  assert.match(big.body.error, /10 MB/);
});

// ---------------------------------------------------------------------------
test('Full flow: order → adjust → invoice (updated) → slip → paid → print → processing → dispatch → link → received', async () => {
  const placed = await placeOrder('harbor', [['C-CCC-001', 5], ['V-BCR-001', 10]], { dateIndex: 1 });
  assert.equal(placed.status, 201);
  const id = placed.body.id;
  let o = await order(id);
  assert.equal(o.status, 'Confirmed', 'straight to the kitchen');
  assert.equal(o.delivery_fee, 0, '545 subtotal → free delivery');
  assert.ok(db.prepare("SELECT 1 FROM email_outbox WHERE template = 'order_confirmed' AND related_id = ?").get(id), 'order email sent at placement');

  // admin reduces the cake from 5 to 4 → subtotal 445 → delivery fee becomes RM25
  const cake = o.lines.find((l) => l.sku === 'C-CCC-001');
  assert.equal((await api.call('POST', `/admin/sales-orders/${id}/adjust`, { token: T.admin, body: { changes: [{ line_id: cake.id, quantity: 4 }] } })).status, 400, 'reason required');
  const adj = await api.call('POST', `/admin/sales-orders/${id}/adjust`, { token: T.admin, body: { changes: [{ line_id: cake.id, quantity: 4, reason: 'Only 4 cakes available' }] } });
  assert.equal(adj.status, 200);
  o = await order(id);
  assert.equal(o.subtotal, 445);
  assert.equal(o.delivery_fee, 25);
  assert.equal(o.sst_amount, r2(470 * 0.06));
  assert.equal(o.adjustments.length, 1);
  assert.equal(o.lines.find((l) => l.id === cake.id).original_quantity, 5);
  const email = db.prepare("SELECT * FROM email_outbox WHERE template = 'quantity_adjusted' AND related_id = ? ORDER BY id DESC").get(id);
  assert.ok(email && email.html.includes('Only 4 cakes available'), 'adjustment email logged');

  const inv = (await invoiceIt(id)).body;
  assert.equal(inv.total, o.total);
  assert.equal((await invoiceIt(id)).status, 400, 'cannot invoice twice');
  // a further reduction before production updates the unpaid invoice too
  const croissant = o.lines.find((l) => l.sku === 'V-BCR-001');
  assert.equal((await api.call('POST', `/admin/sales-orders/${id}/adjust`, { token: T.admin, body: { changes: [{ line_id: croissant.id, quantity: 5, reason: 'Oven issue' }] } })).status, 200);
  o = await order(id);
  assert.equal(o.subtotal, 422.5);
  assert.equal(o.invoice.total, o.total, 'invoice follows the adjusted total');
  const pdf = await api.call('GET', `/documents/invoices/${inv.id}/invoice`, { token: T.harbor });
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  const slip = (await uploadSlip('harbor', [inv.id])).body;
  assert.equal((await api.call('POST', `/finance/slips/${slip.id}/verify`, { token: T.finance })).status, 200);
  assert.equal((await order(id)).invoice.payment_status, 'Paid');

  assert.equal((await api.call('POST', `/kitchen/orders/${id}/processing`, { token: T.kitchen })).status, 400, 'must print first');
  assert.equal((await api.call('POST', `/kitchen/orders/${id}/printed`, { token: T.kitchen })).status, 200);
  assert.equal((await api.call('POST', `/kitchen/orders/${id}/processing`, { token: T.kitchen })).status, 200);
  assert.equal((await order(id)).status, 'Processing');

  // dispatch needs finished goods in stock → kitchen records production first
  const prodDate = (await order(id)).production_date;
  for (const [s, q] of [['C-CCC-001', 4], ['V-BCR-001', 5]]) {
    assert.equal((await api.call('POST', '/kitchen/production', { token: T.kitchen, body: { product_id: sku[s], qty: q, production_date: prodDate } })).status, 201);
  }
  const d = await api.call('POST', `/admin/sales-orders/${id}/dispatch`, { token: T.admin });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.status, 'Out for Delivery');
  assert.equal((await api.call('POST', `/admin/sales-orders/${id}/delivery-link`, { token: T.admin, body: { provider: 'Lalamove', url: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await api.call('POST', `/admin/sales-orders/${id}/delivery-link`, { token: T.admin, body: { provider: 'Lalamove', url: 'https://track.example.com/lalamove/TEST1' } })).status, 200);
  assert.equal((await order(id, 'harbor')).delivery_link, 'https://track.example.com/lalamove/TEST1');
  assert.ok(db.prepare("SELECT 1 FROM email_outbox WHERE template = 'delivery_link' AND related_id = ?").get(id));

  // receive: must tick "matches DO" or report something
  const recv = (data) => { const f = new FormData(); f.append('data', JSON.stringify(data)); return api.call('POST', `/customer/orders/${id}/receive`, { token: T.harbor, form: f }); };
  assert.equal((await recv({ matches_do: false })).status, 400);
  const lineId = (await order(id)).lines.find((l) => l.sku === 'V-BCR-001').id;
  assert.equal((await recv({ matches_do: false, discrepancies: [{ line_id: lineId, qty: 1, note: 'one croissant missing' }] })).status, 200);
  o = await order(id);
  assert.equal(o.status, 'Received');
  assert.equal(o.discrepancies.length, 1);
  assert.ok(db.prepare("SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = 'admin' AND n.type = 'discrepancy' AND n.link = ?").get(`/admin/sales/${id}`));

  // every step left a customer-facing event
  const statuses = o.events.map((e) => e.status);
  for (const s of ['Confirmed', 'Invoiced', 'Processing', 'Out for Delivery', 'Received']) assert.ok(statuses.includes(s), `event ${s}`);
});

test('Notifications reach the right roles on status changes', async () => {
  const r = await placeOrder('harbor', [['V-KOA-001', 5]]);
  const so = db.prepare('SELECT so_number FROM sales_orders WHERE id = ?').get(r.body.id).so_number;
  const got = (role) => db.prepare('SELECT n.title, n.message FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.role = ? AND (n.title LIKE ? OR n.message LIKE ?)').all(role, `%${so}%`, `%${so}%`);
  assert.ok(got('admin').length, 'admin: new order');
  assert.ok(got('finance').some((n) => n.title.startsWith('Issue invoice')), 'finance: issue invoice');
  assert.ok(got('kitchen').length, 'kitchen: new order');
  assert.ok(got('kitchen').every((n) => !/RM\s?\d/.test(n.title + n.message)), 'kitchen notification has no prices');
  assert.ok(got('customer').some((n) => n.title.includes('received')), 'customer: order received');
});

test('Aging report downloads as CSV and Excel', async () => {
  const csv = await api.call('GET', '/finance/aging/download?format=csv', { token: T.finance });
  assert.equal(csv.status, 200);
  assert.match(csv.body.toString('utf8'), /Invoice,Order,Issued,Due,Days overdue/);
  const xlsx = await api.call('GET', '/finance/aging/download?format=xlsx', { token: T.finance });
  assert.equal(xlsx.status, 200);
  assert.equal(xlsx.body.subarray(0, 2).toString(), 'PK', 'xlsx is a zip');
  const one = await api.call('GET', '/finance/aging/download?format=csv&customer=harbor', { token: T.finance });
  const rows = one.body.toString('utf8').split('\r\n').slice(3).filter(Boolean);
  assert.ok(rows.length > 0 && rows.every((l) => l.includes('Harbor Hotel Group')), 'customer filter on the download');
  const pdf = await api.call('GET', '/kitchen/report?from=2026-01-01&to=2030-01-01&format=pdf', { token: T.kitchen });
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
});

// ---------------------------------------------------------------------------
test('Delivery goes to the registered business address unless the order gives a different one', async () => {
  const i = await info('harbor');
  const prof = (await api.call('GET', '/customer/profile', { token: T.harbor })).body;
  assert.ok(prof.registered_address, 'profile shows the registered address');
  const base = { lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method: 'delivery', fulfil_date: i.window.dates[0], time_slot: i.delivery_slots[0] };
  const def = await api.call('POST', '/customer/orders', { token: T.harbor, body: { ...base, area_confirmed: false } });
  assert.equal(def.status, 201, 'no address and no area tick needed for the registered address');
  const so = (await api.call('GET', `/customer/orders/${def.body.id}`, { token: T.harbor })).body;
  assert.equal(so.delivery_address, prof.registered_address);
  const other = { ...base, delivery_address: '1 Different Street, Petaling Jaya' };
  assert.equal((await api.call('POST', '/customer/orders', { token: T.harbor, body: { ...other, area_confirmed: false } })).status, 400, 'a different address needs the area tick');
  const ok = await api.call('POST', '/customer/orders', { token: T.harbor, body: { ...other, area_confirmed: true } });
  assert.equal(ok.status, 201);
  assert.equal((await api.call('GET', `/customer/orders/${ok.body.id}`, { token: T.harbor })).body.delivery_address, other.delivery_address);
});
