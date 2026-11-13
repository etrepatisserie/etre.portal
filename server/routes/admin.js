// Admin API. Every query is limited to the request's outlet (req.outletId):
// outlet staff → their outlet; head office → the outlet picked in the menu bar, or all.
import { Router } from 'express';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { hashPassword } from '../passwords.js';
import { stockRows, getStock, moveStock, checkLowStock } from '../stock.js';
import { orderWindow, todayMYT, addDays } from '../schedule.js';
import { createOrder, getOrder, adjustOrder, cancelOrder, dispatchOrder, setDeliveryLink, blockingInvoices, OPEN_STATUSES } from '../sales.js';
import { notifyAdmins } from '../notify.js';
import { requestCreditNote, createReplacement, listCreditNotes } from '../complaints.js';
import { upload, registerUpload, removeTempUploads } from '../files.js';
import { getOutlet, listOutlets, outletSql, assertOutlet, requireOutlet } from '../outlets.js';
import { getSettings, setSetting } from '../settings.js';
import { productImageUrl } from './customer.js';

const r = Router();
const IN = (list) => `(${list.map((s) => `'${s}'`).join(',')})`;
// not yet handed over: still with the kitchen or in production (legacy Pending / Invoiced included)
const NOT_DISPATCHED = IN(['Pending', 'Confirmed', 'Invoiced', 'Processing']);
const orderInScope = (req, id) => {
  const so = getOrder(id);
  if (!so) throw new HttpError(404, 'Order not found');
  assertOutlet(req, so.outlet_id);
  return so;
};
const customerInScope = (req, id) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Customer not found');
  assertOutlet(req, c.outlet_id);
  return c;
};

// ---------- Dashboard ----------
r.get('/dashboard', (req, res) => {
  const O = outletSql(req, 'so');
  const sum = (where) => db.prepare(`SELECT COALESCE(SUM(subtotal),0) AS total, COUNT(*) AS count FROM sales_orders so
                                     WHERE so.status <> 'Cancelled' AND ${where}${O}`).get();
  const thisMonth = sum("so.order_date >= date('now','start of month')");
  const lastMonth = sum("so.order_date >= date('now','start of month','-1 month') AND so.order_date < date('now','start of month')");
  const today = sum("date(so.order_date) = date('now')");
  const pipeline = db.prepare(`SELECT status, COUNT(*) AS count FROM sales_orders so WHERE 1=1${O} GROUP BY status`).all();
  const lowStock = stockRows(req.outletId).filter((p) => !p.is_sellable && p.stock_status !== 'OK');
  const recent = db.prepare(`SELECT so.id, so.so_number, so.order_date, so.status, so.total, so.method, so.fulfil_date, c.name AS customer_name, o.code AS outlet_code
                             FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN outlets o ON o.id = so.outlet_id
                             WHERE 1=1${O} ORDER BY so.order_date DESC LIMIT 8`).all();
  const n = (sql) => db.prepare(sql).get().n;
  const counts = {
    customers: n(`SELECT COUNT(*) AS n FROM customers so WHERE 1=1${O}`),
    inKitchen: n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ('Pending','Confirmed','Invoiced')${O}`),
    notInvoiced: n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status NOT IN ('Cancelled','Pending') AND so.replacement_for IS NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.so_id = so.id AND i.void = 0)${O}`),
    toDispatch: n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status = 'Processing'${O}`),
    // by pickup / delivery date (MYT): due today (incl. late ones) vs later dates
    dispatchToday: n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ${NOT_DISPATCHED} AND so.fulfil_date <= '${todayMYT()}'${O}`),
    dispatchLate: n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ${NOT_DISPATCHED} AND so.fulfil_date < '${todayMYT()}'${O}`),
    dispatchLater: n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ${NOT_DISPATCHED} AND so.fulfil_date > '${todayMYT()}'${O}`),
    openDiscrepancies: n(`SELECT COUNT(DISTINCT d.so_id) AS n FROM discrepancies d JOIN sales_orders so ON so.id = d.so_id WHERE d.status = 'Open'${O}`),
    activeHolds: n(`SELECT COUNT(*) AS n FROM stock_holds so WHERE so.status = 'Active'${O}`),
    openPOs: n(`SELECT COUNT(*) AS n FROM purchase_orders so WHERE so.status IN ('Submitted','Approved')${O}`),
  };
  res.json({ thisMonth, lastMonth, today, pipeline, lowStock, recent, counts });
});

// ---------- Sales orders ----------
r.get('/sales-orders', (req, res) => {
  const { status, q, fulfil_date } = req.query;
  let sql = `SELECT so.*, c.name AS customer_name, o.code AS outlet_code, i.inv_number, i.payment_status,
               (SELECT COUNT(*) FROM sales_order_lines l WHERE l.so_id = so.id AND l.quantity > 0) AS line_count,
               (SELECT COUNT(*) FROM discrepancies d WHERE d.so_id = so.id AND d.status = 'Open') AS open_discrepancies
             FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN outlets o ON o.id = so.outlet_id
             LEFT JOIN invoices i ON i.so_id = so.id AND i.void = 0 WHERE 1=1${outletSql(req, 'so')}`;
  const p = [];
  if (status === 'Open') sql += ` AND so.status IN ${IN(OPEN_STATUSES)}`;
  else if (status === 'Dispatched') sql += " AND so.status IN ('Ready for Pickup','Out for Delivery')";
  else if (status === 'DispatchToday') { sql += ` AND so.status IN ${NOT_DISPATCHED} AND so.fulfil_date <= ?`; p.push(todayMYT()); }
  else if (status === 'DispatchLater') { sql += ` AND so.status IN ${NOT_DISPATCHED} AND so.fulfil_date > ?`; p.push(todayMYT()); }
  else if (status) { sql += ' AND so.status = ?'; p.push(status); }
  if (fulfil_date) { sql += ' AND so.fulfil_date = ?'; p.push(fulfil_date); }
  if (q) { sql += ' AND (so.so_number LIKE ? OR c.name LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  const byDate = ['DispatchToday', 'DispatchLater'].includes(status);
  res.json(db.prepare(sql + (byDate ? ' ORDER BY so.fulfil_date, so.time_slot, so.id' : ' ORDER BY so.order_date DESC')).all(...p));
});

r.get('/sales-orders/:id', (req, res) => res.json(orderInScope(req, req.params.id)));

// Admin-entered order (phone / walk-in): same rules as the customer checkout, for the customer's outlet
r.get('/checkout-info', (req, res) => {
  const s = getSettings();
  const cid = Number(req.query.customer_id);
  const c = cid ? customerInScope(req, cid) : null;
  const outlet = getOutlet(c?.outlet_id || req.outletId || listOutlets()[0].id);
  res.json({
    outlet: { id: outlet.id, code: outlet.code, name: outlet.name },
    window: orderWindow(new Date(), { outletId: outlet.id }), pickup_slots: outlet.pickup_slots, delivery_slots: outlet.delivery_slots,
    delivery_area: outlet.delivery_area, sst_rate: s.sst_rate, delivery_fee: s.delivery_fee, free_delivery_threshold: s.free_delivery_threshold,
    blocking_invoices: c ? blockingInvoices(c.id) : [],
  });
});

r.post('/sales-orders', (req, res) => {
  const b = req.body;
  customerInScope(req, Number(b.customer_id));
  const id = createOrder({
    customerId: Number(b.customer_id), lines: b.lines, method: b.method, fulfilDate: b.fulfil_date, timeSlot: b.time_slot,
    areaConfirmed: b.area_confirmed === true, deliveryAddress: b.delivery_address, notes: b.notes, userId: req.user.id, byStaff: true,
  });
  res.status(201).json({ id });
});

r.post('/sales-orders/:id/adjust', (req, res) => {
  orderInScope(req, req.params.id);
  res.json({ totals: adjustOrder(Number(req.params.id), req.body.changes, { userId: req.user.id }) });
});
r.post('/sales-orders/:id/cancel', (req, res) => { orderInScope(req, req.params.id); cancelOrder(Number(req.params.id), { user: req.user, reason: req.body.reason }); res.json({ ok: true }); });
r.post('/sales-orders/:id/dispatch', (req, res) => { orderInScope(req, req.params.id); res.json({ status: dispatchOrder(Number(req.params.id), { userId: req.user.id }) }); });
r.post('/sales-orders/:id/delivery-link', (req, res) => {
  orderInScope(req, req.params.id);
  setDeliveryLink(Number(req.params.id), { provider: req.body.provider, url: req.body.url, userId: req.user.id });
  res.json({ ok: true });
});

// ---------- Discrepancies ----------
// Every complaint is resolved with a credit note (Finance issues it) or a no-charge replacement order
r.get('/discrepancies', (req, res) => {
  const status = req.query.status || 'Open';
  const rows = db.prepare(`SELECT d.*, so.so_number, so.outlet_id, so.customer_id, so.method, so.replacement_for, so.sst_rate, o.code AS outlet_code, c.name AS customer_name, u.name AS resolved_by_name,
                       l.quantity AS line_qty, l.unit_price, rso.so_number AS replacement_so_number, rso.status AS replacement_status
                       FROM discrepancies d JOIN sales_orders so ON so.id = d.so_id JOIN customers c ON c.id = so.customer_id
                       JOIN outlets o ON o.id = so.outlet_id LEFT JOIN users u ON u.id = d.resolved_by
                       LEFT JOIN sales_order_lines l ON l.id = d.line_id LEFT JOIN sales_orders rso ON rso.id = d.replacement_so_id
                       WHERE (? = 'All' OR d.status = ?)${outletSql(req, 'so')} ORDER BY d.id DESC`).all(status, status);
  const cns = new Map(listCreditNotes(`cn.discrepancy_id IN (${rows.map((r2) => Number(r2.id)).join(',') || 0})`).map((c) => [c.discrepancy_id, c]));
  res.json(rows.map((d) => {
    const cn = d.action === 'credit_note' ? cns.get(d.id) : null;
    return { ...d, credit_note: cn ? { id: cn.id, status: cn.status, cn_number: cn.cn_number, total: cn.total, quantity: cn.lines[0]?.quantity } : null };
  }));
});
const complaintInScope = (req, id) => {
  const d = db.prepare('SELECT d.*, so.outlet_id FROM discrepancies d JOIN sales_orders so ON so.id = d.so_id WHERE d.id = ?').get(id);
  if (!d) throw new HttpError(404, 'Complaint not found');
  assertOutlet(req, d.outlet_id);
  return d;
};
r.post('/discrepancies/:id/credit-note', (req, res) => {
  complaintInScope(req, req.params.id);
  res.status(201).json(requestCreditNote(Number(req.params.id), { qty: req.body.qty, reason: req.body.reason, userId: req.user.id }));
});
r.post('/discrepancies/:id/replacement', (req, res) => {
  complaintInScope(req, req.params.id);
  const so = createReplacement(Number(req.params.id), { qty: req.body.qty, method: req.body.method, fulfilDate: req.body.fulfil_date, timeSlot: req.body.time_slot, userId: req.user.id });
  res.status(201).json({ id: so.id, so_number: so.so_number });
});

// ---------- Customers ----------
r.get('/customers', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, o.code AS outlet_code, o.name AS outlet_name,
      (SELECT email FROM users u WHERE u.customer_id = c.id LIMIT 1) AS login_email,
      (SELECT COUNT(*) FROM sales_orders so WHERE so.customer_id = c.id AND so.status <> 'Cancelled') AS order_count,
      (SELECT COALESCE(SUM(total),0) FROM sales_orders so WHERE so.customer_id = c.id AND so.status <> 'Cancelled') AS total_spent,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.customer_id = c.id AND i.void = 0 AND i.payment_status <> 'Paid') AS outstanding,
      (SELECT MAX(order_date) FROM sales_orders so WHERE so.customer_id = c.id) AS last_order
    FROM customers c JOIN outlets o ON o.id = c.outlet_id WHERE 1=1${outletSql(req, 'c')}
    ORDER BY c.is_demo, o.id, c.code`).all());
});

function createLogin(customer, loginEmail, password, name) {
  const email = String(loginEmail || '').toLowerCase().trim();
  if (!email || !password) throw new HttpError(400, 'Login email and password are required');
  if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(400, 'That login email is already in use');
  db.prepare("INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?,?,?, 'customer', ?)").run(email, hashPassword(password), name || customer.contact || customer.name, customer.id);
}

// Creates the customer AND its portal login. New B2B customers start on COD in the chosen outlet.
r.post('/customers', (req, res) => {
  const { name, contact, email, phone, address, billing_address, reg_no, login_email, password, credit_limit } = req.body;
  if (!name) throw new HttpError(400, 'Company / customer name is required');
  const outletId = requireOutlet(req, req.body.outlet_id);
  const id = db.transaction(() => {
    const n = db.prepare("SELECT COUNT(*) AS n FROM customers WHERE code LIKE 'CUS-%'").get().n + 1;
    const code = String(req.body.code || '').trim() || `CUS-${String(n).padStart(3, '0')}`;
    if (db.prepare('SELECT 1 FROM customers WHERE code = ?').get(code)) throw new HttpError(400, `Customer code ${code} already exists`);
    const cid = db.prepare(`INSERT INTO customers (code,name,outlet_id,reg_no,contact,email,phone,address,billing_address,payment_term,credit_limit,account_start_date)
                            VALUES (?,?,?,?,?,?,?,?,?,'COD',?,?)`)
      .run(code, name, outletId, reg_no || null, contact || null, email || login_email || null, phone || null, address || null, billing_address || null,
        credit_limit ? Number(credit_limit) : null, todayMYT()).lastInsertRowid;
    if (login_email || password) createLogin({ id: cid, name, contact }, login_email, password);
    notifyAdmins(outletId, 'customer', `New customer: ${name}`, `${code} (${getOutlet(outletId).code}) added by ${req.user.name}`, '/admin/customers');
    return cid;
  })();
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
});

// Give an existing customer (e.g. imported from the accounting system) a portal login
r.post('/customers/:id/login', (req, res) => {
  const c = customerInScope(req, req.params.id);
  if (db.prepare('SELECT 1 FROM users WHERE customer_id = ?').get(c.id)) throw new HttpError(400, 'This customer already has a portal login');
  createLogin(c, req.body.login_email, req.body.password, req.body.name);
  if (!c.email) db.prepare('UPDATE customers SET email = ? WHERE id = ?').run(String(req.body.login_email).toLowerCase().trim(), c.id);
  res.status(201).json({ ok: true });
});

// ---------- Product images & availability (shared catalog) ----------
r.get('/product-images', (req, res) => {
  res.json(db.prepare('SELECT id, sku, name, category, size, is_available, image_file_id FROM products WHERE is_sellable = 1 ORDER BY id').all()
    .map((p) => ({ ...p, image_url: productImageUrl(p.image_file_id) })));
});
r.post('/products/:id/image', upload.single('image'), (req, res) => {
  try {
    const p = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Product not found');
    const fileId = registerUpload(req.file, { kind: 'product_image', userId: req.user.id, imagesOnly: true });
    db.prepare('UPDATE products SET image_file_id = ? WHERE id = ?').run(fileId, p.id);
    res.json({ image_url: productImageUrl(fileId) });
  } catch (e) { removeTempUploads(req); throw e; }
});
r.delete('/products/:id/image', (req, res) => {
  db.prepare('UPDATE products SET image_file_id = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
r.post('/products/:id/availability', (req, res) => {
  db.prepare('UPDATE products SET is_available = ? WHERE id = ? AND is_sellable = 1').run(req.body.is_available ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ---------- Announcements (per outlet, or both) ----------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function cleanAnnouncement(req) {
  const b = req.body;
  const a = {
    title: String(b.title || '').trim(), body: String(b.body || '').trim(), type: b.type || 'notice',
    starts_on: b.starts_on, ends_on: b.ends_on, closure_from: b.closure_from || null, closure_to: b.closure_to || null,
    // outlet staff can only post for their own outlet; head office picks one or both
    outlet_id: req.user.outlet_id || (b.outlet_id ? Number(b.outlet_id) : null),
  };
  if (!a.title) throw new HttpError(400, 'Title is required');
  if (!['notice', 'closure', 'price_change'].includes(a.type)) throw new HttpError(400, 'Unknown type');
  if (!DATE.test(a.starts_on || '') || !DATE.test(a.ends_on || '')) throw new HttpError(400, 'Show from / until dates are required');
  if (a.ends_on < a.starts_on) throw new HttpError(400, '"Show until" must be on or after "Show from"');
  if (a.outlet_id && !getOutlet(a.outlet_id)) throw new HttpError(400, 'Unknown outlet');
  if (a.type === 'closure') {
    if (!DATE.test(a.closure_from || '')) throw new HttpError(400, 'Closure start date is required');
    a.closure_to = a.closure_to || a.closure_from;
    if (a.closure_to < a.closure_from) throw new HttpError(400, 'Closure end must be on or after its start');
  } else { a.closure_from = null; a.closure_to = null; }
  return a;
}
const annScope = (req) => (req.outletId ? ` AND (a.outlet_id IS NULL OR a.outlet_id = ${Number(req.outletId)})` : '');
const annInScope = (req, id) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!a) throw new HttpError(404, 'Not found');
  if (req.user.outlet_id && a.outlet_id !== req.user.outlet_id) throw new HttpError(403, 'This announcement belongs to head office or another outlet');
  return a;
};
r.get('/announcements', (req, res) => {
  const today = todayMYT();
  res.json(db.prepare(`SELECT a.*, u.name AS created_by_name, o.code AS outlet_code,
      CASE WHEN a.ends_on < ? THEN 'Expired' WHEN a.starts_on > ? THEN 'Scheduled' ELSE 'Live' END AS state
    FROM announcements a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN outlets o ON o.id = a.outlet_id
    WHERE 1=1${annScope(req)} ORDER BY a.starts_on DESC, a.id DESC`).all(today, today));
});
r.post('/announcements', (req, res) => {
  const a = cleanAnnouncement(req);
  const id = db.prepare('INSERT INTO announcements (title, body, outlet_id, type, starts_on, ends_on, closure_from, closure_to, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(a.title, a.body, a.outlet_id, a.type, a.starts_on, a.ends_on, a.closure_from, a.closure_to, req.user.id).lastInsertRowid;
  res.status(201).json({ id });
});
r.put('/announcements/:id', (req, res) => {
  annInScope(req, req.params.id);
  const a = cleanAnnouncement(req);
  db.prepare("UPDATE announcements SET title=?, body=?, outlet_id=?, type=?, starts_on=?, ends_on=?, closure_from=?, closure_to=?, updated_at=datetime('now') WHERE id=?")
    .run(a.title, a.body, a.outlet_id, a.type, a.starts_on, a.ends_on, a.closure_from, a.closure_to, req.params.id);
  res.json({ ok: true });
});
// Expire = stop showing the banner (yesterday). Closure dates still apply unless the announcement is deleted.
r.post('/announcements/:id/expire', (req, res) => {
  annInScope(req, req.params.id);
  db.prepare("UPDATE announcements SET ends_on = ?, starts_on = MIN(starts_on, ?), updated_at=datetime('now') WHERE id=?")
    .run(addDays(todayMYT(), -1), addDays(todayMYT(), -1), req.params.id);
  res.json({ ok: true });
});
r.delete('/announcements/:id', (req, res) => { annInScope(req, req.params.id); db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ---------- Email outbox ----------
r.get('/emails', (req, res) => {
  res.json(db.prepare(`SELECT e.id, e.to_email, e.subject, e.template, e.related_type, e.related_id, e.status, e.error, e.created_at, o.code AS outlet_code
                       FROM email_outbox e LEFT JOIN outlets o ON o.id = e.outlet_id WHERE 1=1${outletSql(req, 'e')} ORDER BY e.id DESC LIMIT 300`).all());
});
r.get('/emails/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM email_outbox WHERE id = ?').get(req.params.id);
  if (!e) throw new HttpError(404, 'Email not found');
  if (e.outlet_id) assertOutlet(req, e.outlet_id);
  res.json(e);
});

// ---------- Stock (per outlet) ----------
r.get('/stock', (req, res) => res.json(stockRows(req.outletId)));

r.post('/stock/adjust', (req, res) => {
  const { product_id, qty, reason } = req.body;
  const outletId = requireOutlet(req, req.body.outlet_id);
  const n = parseInt(qty, 10);
  if (!product_id) throw new HttpError(400, 'Choose a product');
  if (!n) throw new HttpError(400, 'Quantity must be a non-zero whole number');
  if (!reason) throw new HttpError(400, 'A reason is required for stock adjustments');
  const s = getStock(product_id, outletId);
  if (!s) throw new HttpError(404, 'Product not found');
  if (n < 0 && s.stock_on_hand + n < s.on_hold) throw new HttpError(400, `Cannot reduce below the ${s.on_hold} ${s.uom} currently on hold`);
  const balance = db.transaction(() => moveStock(Number(product_id), outletId, 'adjustment', n, { reason, userId: req.user.id }))();
  res.json({ ok: true, balance });
});

r.get('/stock/movements', (req, res) => {
  const { product_id, type } = req.query;
  let sql = `SELECT m.*, p.sku, p.name AS product_name, p.uom, u.name AS user_name, o.code AS outlet_code FROM stock_movements m
             JOIN products p ON p.id = m.product_id JOIN outlets o ON o.id = m.outlet_id LEFT JOIN users u ON u.id = m.user_id WHERE 1=1${outletSql(req, 'm')}`;
  const p = [];
  if (product_id) { sql += ' AND m.product_id = ?'; p.push(product_id); }
  if (type) { sql += ' AND m.type = ?'; p.push(type); }
  res.json(db.prepare(sql + ' ORDER BY m.created_at DESC, m.id DESC LIMIT 300').all(...p));
});

r.get('/stock/holds', (req, res) => {
  const status = req.query.status || 'Active';
  res.json(db.prepare(`
    SELECT h.*, p.sku, p.name AS product_name, p.uom, c.name AS customer_name, so.so_number, u.name AS created_by_name, o.code AS outlet_code
    FROM stock_holds h JOIN products p ON p.id = h.product_id JOIN outlets o ON o.id = h.outlet_id
    LEFT JOIN customers c ON c.id = h.customer_id LEFT JOIN sales_orders so ON so.id = h.so_id
    LEFT JOIN users u ON u.id = h.created_by
    WHERE (? = 'All' OR h.status = ?)${outletSql(req, 'h')} ORDER BY h.created_at DESC LIMIT 300`).all(status, status));
});

r.post('/stock/holds', (req, res) => {
  const { product_id, qty, reason, customer_id } = req.body;
  const outletId = requireOutlet(req, req.body.outlet_id);
  const n = parseInt(qty, 10);
  if (!product_id || !(n > 0)) throw new HttpError(400, 'Choose a product and a quantity greater than 0');
  if (!reason) throw new HttpError(400, 'A reason is required');
  const s = getStock(product_id, outletId);
  if (!s) throw new HttpError(404, 'Product not found');
  if (n > s.available) throw new HttpError(400, `Only ${s.available} ${s.uom} available to hold`);
  if (customer_id) customerInScope(req, customer_id);
  db.prepare('INSERT INTO stock_holds (product_id, outlet_id, qty, reason, customer_id, created_by) VALUES (?,?,?,?,?,?)').run(product_id, outletId, n, reason, customer_id || null, req.user.id);
  checkLowStock(Number(product_id), outletId);
  res.status(201).json({ ok: true });
});

r.post('/stock/holds/:id/release', (req, res) => {
  const h = db.prepare('SELECT * FROM stock_holds WHERE id = ?').get(req.params.id);
  if (!h || h.status !== 'Active') throw new HttpError(400, 'Hold is not active');
  assertOutlet(req, h.outlet_id);
  db.prepare("UPDATE stock_holds SET status = 'Released', released_at = datetime('now') WHERE id = ?").run(h.id);
  res.json({ ok: true });
});

// ---------- Statistics (revenue = product subtotal before SST & delivery) ----------
r.get('/statistics', (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
  const since = db.prepare(`SELECT date('now','start of month', ?) AS d`).get(`-${months - 1} months`).d;
  const live = `so.status <> 'Cancelled' AND so.order_date >= '${since}'${outletSql(req, 'so')}`;

  const monthlyRows = db.prepare(`SELECT strftime('%Y-%m', order_date) AS month, SUM(subtotal) AS revenue, COUNT(*) AS orders
                                  FROM sales_orders so WHERE ${live} GROUP BY month`).all();
  const monthly = [];
  const d = new Date(`${since}T00:00:00Z`);
  for (let i = 0; i < months; i++) {
    const key = d.toISOString().slice(0, 7);
    const row = monthlyRows.find((m) => m.month === key);
    monthly.push({ month: key, revenue: row?.revenue || 0, orders: row?.orders || 0 });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const totals = db.prepare(`SELECT COALESCE(SUM(subtotal),0) AS revenue, COUNT(*) AS orders FROM sales_orders so WHERE ${live}`).get();
  totals.units = db.prepare(`SELECT COALESCE(SUM(l.quantity),0) AS n FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id WHERE ${live}`).get().n;
  totals.aov = totals.orders ? totals.revenue / totals.orders : 0;

  const topProducts = db.prepare(`
    SELECT p.name, p.sku, SUM(l.line_total) AS revenue, SUM(l.quantity) AS units
    FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id JOIN products p ON p.id = l.product_id
    WHERE ${live} AND l.quantity > 0 GROUP BY p.id ORDER BY revenue DESC LIMIT 8`).all();
  const topCustomers = db.prepare(`
    SELECT c.name, SUM(so.subtotal) AS revenue, COUNT(*) AS orders
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id
    WHERE ${live} GROUP BY c.id ORDER BY revenue DESC LIMIT 8`).all();
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS count FROM sales_orders so WHERE so.order_date >= '${since}'${outletSql(req, 'so')} GROUP BY status`).all();

  res.json({ months, since, totals, monthly, topProducts, topCustomers, byStatus });
});

// ---------- Settings: company & outlet details, ordering rules ----------
// Head-office admins can edit; outlet admins see their own outlet read-only.
const OUTLET_TEXT = { company_name: 120, company_address: 300, company_reg_no: 60, sst_reg_no: 60, bank_name: 80, bank_account_name: 120, bank_account_no: 40, pickup_address: 300, delivery_area: 160 };
const RULES = {
  delivery_fee: { min: 0, max: 1000 }, free_delivery_threshold: { min: 0, max: 100000 },
  max_days_ahead: { min: 1, max: 120, int: true }, credit_term_min_months: { min: 0, max: 24, int: true },
};
const headOffice = (req) => { if (req.user.outlet_id) throw new HttpError(403, 'Only head office can change settings'); };

r.get('/settings', (req, res) => {
  const outlets = listOutlets().filter((o) => !req.user.outlet_id || o.id === req.user.outlet_id);
  const s = getSettings();
  res.json({ can_edit: !req.user.outlet_id, outlets, rules: { sst_rate: s.sst_rate, delivery_fee: s.delivery_fee, free_delivery_threshold: s.free_delivery_threshold,
    cutoff_time: s.cutoff_time, max_days_ahead: s.max_days_ahead, credit_term_min_months: s.credit_term_min_months } });
});

r.put('/settings/outlets/:id', (req, res) => {
  headOffice(req);
  const o = getOutlet(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Outlet not found');
  const b = req.body || {};
  const set = {};
  for (const [k, max] of Object.entries(OUTLET_TEXT)) {
    if (b[k] === undefined) continue;
    const v = String(b[k] ?? '').trim();
    if (k === 'company_name' && !v) throw new HttpError(400, 'Company name is required');
    if (v.length > max) throw new HttpError(400, `${k.replace(/_/g, ' ')} is too long (max ${max} characters)`);
    set[k] = v;
  }
  if (set.bank_account_no !== undefined && set.bank_account_no && !/^[0-9 -]{6,30}$/.test(set.bank_account_no)) throw new HttpError(400, 'Bank account number: digits only (spaces and dashes allowed)');
  for (const k of ['pickup_slots', 'delivery_slots']) {
    if (b[k] === undefined) continue;
    const list = (Array.isArray(b[k]) ? b[k] : String(b[k]).split('\n')).map((x) => String(x).trim()).filter(Boolean);
    if (!list.length) throw new HttpError(400, `Add at least one ${k === 'pickup_slots' ? 'pickup' : 'delivery'} time slot`);
    if (list.length > 12 || list.some((x) => x.length > 60)) throw new HttpError(400, 'Time slots: up to 12, each up to 60 characters');
    set[k] = JSON.stringify(list);
  }
  const keys = Object.keys(set);
  if (keys.length) db.prepare(`UPDATE outlets SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...set, id: o.id });
  res.json(getOutlet(o.id));
});

r.put('/settings/rules', (req, res) => {
  headOffice(req);
  const b = req.body || {};
  const next = {};
  for (const [k, lim] of Object.entries(RULES)) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < lim.min || n > lim.max || (lim.int && !Number.isInteger(n))) throw new HttpError(400, `${k.replace(/_/g, ' ')} must be ${lim.int ? 'a whole number ' : ''}between ${lim.min} and ${lim.max}`);
    next[k] = lim.int ? n : Math.round(n * 100) / 100;
  }
  if (b.cutoff_time !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.cutoff_time))) throw new HttpError(400, 'Order cut-off must be a time like 13:00');
    next.cutoff_time = String(b.cutoff_time);
  }
  for (const [k, v] of Object.entries(next)) setSetting(k, v);
  const s = getSettings();
  res.json({ sst_rate: s.sst_rate, delivery_fee: s.delivery_fee, free_delivery_threshold: s.free_delivery_threshold, cutoff_time: s.cutoff_time, max_days_ahead: s.max_days_ahead, credit_term_min_months: s.credit_term_min_months });
});

export default r;
