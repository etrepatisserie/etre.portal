// KL and Ipoh are separate companies: staff of one outlet never see the other's data;
// head office sees both and can narrow to one; numbering, closures, stock and terms are per outlet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv, startServer, pdfBlob } from './helpers.js';

isolatedEnv();
let api, T = {}, db, KL, IPH, sku = {};

before(async () => {
  api = await startServer();
  db = (await import('../db.js')).default;
  for (const [k, e, p] of [['admin', 'admin@demo.test', 'admin123'], ['adminKL', 'staff@demo.test', 'staff123'], ['adminIPH', 'admin.ipoh@demo.test', 'admin123'],
    ['finance', 'finance@demo.test', 'finance123'],
    ['kitchenKL', 'kitchen@demo.test', 'kitchen123'], ['kitchenIPH', 'kitchen.ipoh@demo.test', 'kitchen123'],
    ['harbor', 'harbor@demo.test', 'customer123'], ['kinta', 'kinta@demo.test', 'customer123'], ['perak', 'perakhotel@demo.test', 'customer123']]) T[k] = await api.login(e, p);
  KL = db.prepare("SELECT id FROM outlets WHERE code = 'KL'").get().id;
  IPH = db.prepare("SELECT id FROM outlets WHERE code = 'IPH'").get().id;
  for (const p of db.prepare('SELECT id, sku FROM products').all()) sku[p.sku] = p.id;
});
after(() => api.close());

const get = (who, url, headers) => api.call('GET', url, { token: T[who], ...(headers || {}) });
const orderOf = (outlet) => db.prepare('SELECT id FROM sales_orders WHERE outlet_id = ? ORDER BY id DESC LIMIT 1').get(outlet).id;
const invoiceOf = (outlet) => db.prepare('SELECT id FROM invoices WHERE outlet_id = ? ORDER BY id DESC LIMIT 1').get(outlet).id;

test('Two companies with their own registration details', () => {
  const o = Object.fromEntries(db.prepare('SELECT code, company_name, company_reg_no FROM outlets').all().map((x) => [x.code, x]));
  assert.equal(o.KL.company_name, 'ETRE PATISSERIE KL SDN BHD');
  assert.equal(o.IPH.company_name, 'ETRE PATISSERIE SDN BHD');
  assert.equal(o.IPH.company_reg_no, '1375339-U');
});

test('Order, invoice, DO and PO numbers are per outlet', () => {
  for (const [code, id] of [['KL', KL], ['IPH', IPH]]) {
    const so = db.prepare('SELECT so_number FROM sales_orders WHERE outlet_id = ?').all(id);
    const inv = db.prepare('SELECT inv_number, do_number FROM invoices WHERE outlet_id = ?').all(id);
    assert.ok(so.length && so.every((r) => r.so_number.startsWith(`SO-${code}-`)), `${code} SO numbers`);
    assert.ok(inv.length && inv.every((r) => r.inv_number.startsWith(`INV-${code}-`) && r.do_number.startsWith(`DO-${code}-`)), `${code} INV/DO numbers`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.outlet_id <> c.outlet_id').get().n, 0);
});

test('Ipoh staff never see KL orders, invoices, customers or stock (and vice versa)', async () => {
  const klOrder = orderOf(KL), klInv = invoiceOf(KL), iphOrder = orderOf(IPH);
  // admin
  const ipohOrders = (await get('adminIPH', '/admin/sales-orders')).body;
  assert.ok(ipohOrders.length > 0 && ipohOrders.every((o) => o.outlet_id === IPH));
  assert.equal((await get('adminIPH', `/admin/sales-orders/${klOrder}`)).status, 404);
  assert.equal((await api.call('POST', `/admin/sales-orders/${klOrder}/cancel`, { token: T.adminIPH, body: {} })).status, 404);
  assert.ok((await get('adminIPH', '/admin/customers')).body.every((c) => c.outlet_id === IPH));
  assert.ok((await get('adminIPH', '/admin/stock')).body.every((s) => s.outlet_id === IPH));
  assert.equal((await get('adminKL', `/admin/sales-orders/${iphOrder}`)).status, 404, 'KL admin cannot open Ipoh orders');
  // finance: one head-office login, narrowed to the Ipoh company with the company tab (X-Outlet)
  const ipoh = { headers: { 'X-Outlet': String(IPH) } };
  const invs = (await get('finance', '/finance/invoices', ipoh)).body;
  assert.ok(invs.length > 0 && invs.every((i) => i.inv_number.startsWith('INV-IPH-')));
  assert.equal((await get('finance', `/finance/orders/${klOrder}`, ipoh)).status, 404);
  assert.equal((await get('adminIPH', `/documents/invoices/${klInv}/invoice`)).status, 404, 'Ipoh admin cannot open KL invoices');
  assert.ok((await get('finance', '/finance/aging', ipoh)).body.invoices.every((i) => i.inv_number.startsWith('INV-IPH-')));
  // a header can't widen an outlet user's view
  const sneaky = await api.call('GET', '/admin/sales-orders', { token: T.adminIPH, headers: { 'X-Outlet': String(KL) } });
  assert.ok(sneaky.body.length > 0 && sneaky.body.every((o) => o.outlet_id === IPH));
  // kitchen
  const kOrders = (await get('kitchenIPH', '/kitchen/orders?status=')).body;
  assert.ok(kOrders.length > 0 && kOrders.every((o) => !o.so_number.startsWith('SO-KL')));
  assert.equal((await get('kitchenIPH', `/kitchen/orders/${klOrder}`)).status, 404);
  assert.equal((await api.call('POST', `/kitchen/orders/${klOrder}/printed`, { token: T.kitchenIPH })).status, 404);
  assert.equal((await get('kitchenKL', `/kitchen/orders/${iphOrder}`)).status, 404);
});

test('X-Outlet header cannot widen an outlet user, but head office can switch', async () => {
  const forced = (await get('adminIPH', '/admin/sales-orders', { headers: { 'X-Outlet': String(KL) } })).body;
  assert.ok(forced.length > 0 && forced.every((o) => o.outlet_id === IPH), 'Ipoh admin stays on Ipoh even when asking for KL');
  const all = (await get('finance', '/finance/invoices')).body;
  assert.ok(all.some((i) => i.outlet_id === KL) && all.some((i) => i.outlet_id === IPH), 'head office sees both');
  const onlyKl = await fetch(`http://127.0.0.1:${api.server.address().port}/api/finance/invoices`, { headers: { Authorization: `Bearer ${T.finance}`, 'X-Outlet': String(KL) } }).then((r) => r.json());
  assert.ok(onlyKl.length > 0 && onlyKl.every((i) => i.outlet_id === KL), 'head office narrowed to KL');
});

test('Notifications go to the order outlet\'s staff and head office only', async () => {
  const i = (await get('kinta', '/customer/checkout-info')).body;
  const f = new FormData();
  f.append('data', JSON.stringify({ lines: [{ product_id: sku['V-BCR-001'], quantity: 5 }], method: 'pickup', fulfil_date: i.window.dates[0], time_slot: i.pickup_slots[0] }));
  f.append('slip', pdfBlob('kinta slip'), 'slip.pdf');
  const r = await api.call('POST', '/customer/orders', { token: T.kinta, form: f });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const so = db.prepare('SELECT so_number, outlet_id FROM sales_orders WHERE id = ?').get(r.body.id);
  assert.equal(so.outlet_id, IPH);
  assert.match(so.so_number, /^SO-IPH-/);
  const who = db.prepare('SELECT u.email FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.title LIKE ?').all(`%${so.so_number}%`).map((x) => x.email);
  for (const e of ['kitchen.ipoh@demo.test', 'admin.ipoh@demo.test', 'admin@demo.test', 'finance@demo.test']) assert.ok(who.includes(e), `${e} notified`);
  for (const e of ['kitchen@demo.test', 'staff@demo.test']) assert.ok(!who.includes(e), `${e} (KL) not notified`);
});

test('Each customer checks out with their own outlet: slots, area, bank, closures', async () => {
  const kl = (await get('harbor', '/customer/checkout-info')).body;
  const ip = (await get('kinta', '/customer/checkout-info')).body;
  assert.equal(kl.outlet.code, 'KL'); assert.equal(ip.outlet.code, 'IPH');
  assert.equal(kl.bank.account_name, 'ETRE PATISSERIE KL SDN BHD');
  assert.equal(ip.bank.account_name, 'ETRE PATISSERIE SDN BHD');
  assert.notEqual(kl.delivery_area, ip.delivery_area);
  // the KL staff-training closure blocks KL dates only
  const klClosure = db.prepare("SELECT closure_from FROM announcements WHERE outlet_id = ? AND type = 'closure' ORDER BY id DESC").get(KL).closure_from;
  assert.ok(!kl.window.dates.includes(klClosure), 'KL closure blocked for KL');
  assert.ok(ip.window.dates.includes(klClosure), 'KL closure does not block Ipoh');
  const annKl = (await get('harbor', '/customer/announcements')).body.map((a) => a.title);
  const annIp = (await get('kinta', '/customer/announcements')).body.map((a) => a.title);
  assert.ok(annKl.some((t) => t.startsWith('KL')) && !annKl.some((t) => t.startsWith('Ipoh')));
  assert.ok(annIp.some((t) => t.startsWith('Ipoh')) && !annIp.some((t) => t.startsWith('KL')));
});

test('Stock is separate per outlet', async () => {
  const flour = sku['ING-FLR'];
  const before = db.prepare('SELECT outlet_id, stock_on_hand FROM product_stock WHERE product_id = ?').all(flour);
  const r = await api.call('POST', '/admin/stock/adjust', { token: T.adminIPH, body: { product_id: flour, qty: 2, reason: 'count' } });
  assert.equal(r.status, 200);
  const after = db.prepare('SELECT outlet_id, stock_on_hand FROM product_stock WHERE product_id = ?').all(flour);
  const d = (o) => after.find((x) => x.outlet_id === o).stock_on_hand - before.find((x) => x.outlet_id === o).stock_on_hand;
  assert.equal(d(IPH), 2); assert.equal(d(KL), 0);
  assert.equal((await api.call('POST', '/admin/stock/adjust', { token: T.admin, body: { product_id: flour, qty: 1, reason: 'x' } })).status, 400, 'head office must pick an outlet');
});

test('30-day term: invoice due 30 days after issue; only overdue invoices block', async () => {
  const i = (await get('perak', '/customer/checkout-info')).body;
  const r = await api.call('POST', '/customer/orders', { token: T.perak, body: { lines: [{ product_id: sku['C-TIR-001'], quantity: 1 }], method: 'delivery', fulfil_date: i.window.dates[0], time_slot: i.delivery_slots[0], area_confirmed: true } });
  assert.equal(r.status, 201, '30-day customer needs no slip');
  const f = new FormData(); f.append('mode', 'generate');
  const inv = (await api.call('POST', `/finance/orders/${r.body.id}/invoice`, { token: T.finance, form: f, headers: { 'X-Outlet': String(IPH) } })).body;
  assert.match(inv.inv_number, /^INV-IPH-/);
  const days = (new Date(inv.due_date) - new Date(inv.issue_date)) / 864e5;
  assert.equal(days, 30);
  assert.equal((await api.call('POST', '/customer/orders', { token: T.perak, body: { lines: [{ product_id: sku['C-TIR-001'], quantity: 1 }], method: 'delivery', fulfil_date: i.window.dates[0], time_slot: i.delivery_slots[0], area_confirmed: true } })).status, 201, 'unpaid but not overdue → can still order');
});

test('Real customers: imported without history; Admin can create their portal login', async () => {
  const real = db.prepare('SELECT * FROM customers WHERE is_demo = 0').all();
  if (!real.length) return; // customers.json not present on this machine
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE c.is_demo = 0').get().n, 0, 'no invented orders');
  // the only automatic logins are the test accounts marked "demo_login" in customers.json
  const auto = db.prepare("SELECT u.email FROM users u JOIN customers c ON c.id = u.customer_id WHERE c.is_demo = 0").all();
  assert.ok(auto.every((u) => u.email.endsWith('@demo.test')), 'only @demo.test test logins');
  for (const { email } of auto) {
    const tk = await api.login(email, 'customer123');
    assert.ok(tk, `test login ${email} works`);
    assert.deepEqual((await api.call('GET', '/customer/orders', { token: tk })).body, [], 'test login sees no invented orders');
  }
  const ipohReal = real.find((c) => c.outlet_id === IPH && !db.prepare('SELECT 1 FROM users WHERE customer_id = ?').get(c.id));
  assert.equal((await api.call('POST', `/admin/customers/${ipohReal.id}/login`, { token: T.adminKL, body: { login_email: 'x@demo.test', password: 'secret1' } })).status, 404, 'KL admin cannot touch Ipoh customers');
  const ok = await api.call('POST', `/admin/customers/${ipohReal.id}/login`, { token: T.adminIPH, body: { login_email: 'real.test@demo.test', password: 'secret1' } });
  assert.equal(ok.status, 201);
  const t = await api.login('real.test@demo.test', 'secret1');
  const me = (await api.call('GET', '/auth/me', { token: t })).body;
  assert.equal(me.outlet_code, 'IPH');
  assert.equal((await api.call('POST', `/admin/customers/${ipohReal.id}/login`, { token: T.adminIPH, body: { login_email: 'again@demo.test', password: 'secret1' } })).status, 400, 'only one login');
});

test('One finance login: dashboard, reports and aging are split per company', async () => {
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'finance'").get().n, 1, 'single finance account');
  const both = (await get('finance', '/finance/dashboard')).body;
  assert.deepEqual(both.companies.map((c) => c.code).sort(), ['IPH', 'KL']);
  const kl = both.companies.find((c) => c.code === 'KL'), iph = both.companies.find((c) => c.code === 'IPH');
  assert.equal(Math.round((kl.outstanding.t + iph.outstanding.t) * 100), Math.round(both.outstanding.t * 100), 'the two companies add up to the total');
  const onlyIph = (await get('finance', '/finance/dashboard', { headers: { 'X-Outlet': String(IPH) } })).body;
  assert.deepEqual(onlyIph.companies.map((c) => c.code), ['IPH']);
  assert.equal(onlyIph.outstanding.t, iph.outstanding.t);

  const month = new Date().toISOString().slice(0, 7);
  const rep = (await get('finance', `/finance/reports?month=${month}`)).body;
  assert.equal(rep.companies.length, 2);
  for (const c of rep.companies) {
    assert.ok(c.invoices.every((i) => i.inv_number.startsWith(`INV-${c.code}-`)), `${c.code} report only has its own invoices`);
    assert.equal(c.trend.length, 6);
    const sst = Math.round(c.invoices.reduce((a, i) => a + i.sst_amount, 0) * 100);
    assert.equal(Math.round(c.invoiced.sst * 100), sst, 'SST total per company');
  }
  const x = await get('finance', `/finance/reports/download?month=${month}`, { headers: { 'X-Outlet': String(KL) } });
  assert.equal(x.status, 200);
  assert.equal(x.body.subarray(0, 2).toString(), 'PK');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.body);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['KL summary', 'KL invoices', 'KL credit notes'], 'KL download has only KL sheets');
  const aging = await get('finance', '/finance/aging/download?format=xlsx');
  const wa = new ExcelJS.Workbook(); await wa.xlsx.load(aging.body);
  assert.deepEqual(wa.worksheets.map((w) => w.name), ['KL by customer', 'KL invoices', 'IPH by customer', 'IPH invoices']);
});

// ---------------------------------------------------------------------------
test('Finance statistics: per company, never summed', async () => {
  const both = (await get('finance', '/finance/statistics?months=6')).body;
  assert.equal(both.months, 6);
  assert.deepEqual(both.companies.map((c) => c.code).sort(), ['IPH', 'KL']);
  for (const c of both.companies) {
    assert.equal(c.monthly.length, 6);
    assert.equal(Math.round(c.monthly.reduce((a, m) => a + m.invoiced, 0) * 100) / 100, c.totals.invoiced, 'monthly bars add up to the total');
    assert.equal(c.aging.length, 5);
    assert.ok(c.aging.every((a) => a.value >= 0));
  }
  const kl = (await get('finance', '/finance/statistics?months=12', { headers: { 'X-Outlet': String(KL) } })).body;
  assert.equal(kl.companies.length, 1); assert.equal(kl.companies[0].code, 'KL'); assert.equal(kl.companies[0].monthly.length, 12);
  assert.equal(kl.companies[0].totals.outstanding, both.companies.find((c) => c.code === 'KL').totals.outstanding, 'KL tab = KL block in Both');
  assert.equal((await get('admin', '/finance/statistics')).status, 403);
});
