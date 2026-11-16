// Admin API. Every query is limited to the request's outlet (req.outletId):
// outlet staff → their outlet; head office → the outlet picked in the menu bar, or all.
import { Router } from 'express';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { hashPassword } from '../passwords.js';
import { stockRows, getStock, moveStock, checkLowStock } from '../stock.js';
import { orderWindow, todayMYT, addDays, closureRules, closureReason } from '../schedule.js';
import { audit } from '../audit.js';
import { activeOverride } from '../overrides.js';
import { createOrder, getOrder, adjustOrder, cancelOrder, dispatchOrder, setDeliveryLink, blockingInvoices, approveOrder, rejectOrder, failDelivery, OPEN_STATUSES } from '../sales.js';
import { notifyAdmins } from '../notify.js';
import { requestCreditNote, createReplacement, listCreditNotes } from '../complaints.js';
import { upload, registerUpload, removeTempUploads } from '../files.js';
import { getOutlet, listOutlets, outletSql, assertOutlet, requireOutlet, pricingFor } from '../outlets.js';
import { getSettings, setSetting } from '../settings.js';
import { productImageUrl } from './customer.js';
import { uploadDocument, documentHistory, BALANCE_SQL } from '../billing.js';
import { mapEach } from '../each.js';

const r = Router();
const IN = (list) => `(${list.map((s) => `'${s}'`).join(',')})`;
// not yet handed over: still with the kitchen or in production (legacy Pending / Invoiced included)
const NOT_DISPATCHED = IN(['Confirmed', 'Invoiced', 'Processing']); // approved, not yet handed over ('Pending' = awaiting approval)
const orderInScope = async (req, id) => {
  const so = await getOrder(id);
  if (!so) throw new HttpError(404, 'Order not found');
  assertOutlet(req, so.outlet_id);
  return so;
};
const customerInScope = async (req, id) => {
  const c = await db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Customer not found');
  assertOutlet(req, c.outlet_id);
  return c;
};

// ---------- Dashboard ----------
r.get('/dashboard', async (req, res) => {
  const O = outletSql(req, 'so');
  const sum = async (where) => await db.prepare(`SELECT COALESCE(SUM(subtotal),0) AS total, COUNT(*) AS count FROM sales_orders so
                                     WHERE so.status <> 'Cancelled' AND ${where}${O}`).get();
  const thisMonth = await sum("so.order_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");
  const lastMonth = await sum("so.order_date >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01') AND so.order_date < DATE_FORMAT(CURDATE(), '%Y-%m-01')");
  const today = await sum("date(so.order_date) = CURDATE()");
  const pipeline = await db.prepare(`SELECT status, COUNT(*) AS count FROM sales_orders so WHERE 1=1${O} GROUP BY status`).all();
  const lowStock = (await stockRows(req.outletId)).filter((p) => !p.is_sellable && p.stock_status !== 'OK');
  const recent = await db.prepare(`SELECT so.id, so.so_number, so.order_date, so.status, so.rejected_at, so.total, so.method, so.fulfil_date, c.name AS customer_name, o.code AS outlet_code
                             FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN outlets o ON o.id = so.outlet_id
                             WHERE 1=1${O} ORDER BY so.order_date DESC LIMIT 8`).all();
  const n = async (sql) => (await db.prepare(sql).get()).n;
  const counts = {
    customers: await n(`SELECT COUNT(*) AS n FROM customers so WHERE 1=1${O}`),
    inKitchen: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ('Confirmed','Invoiced')${O}`),
    awaitingApproval: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status = 'Pending'${O}`),
    // urgent: production is today or tomorrow and it still isn't approved
    approvalUrgent: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status = 'Pending' AND so.production_date <= '${addDays(todayMYT(), 1)}'${O}`),
    // order control centre
    rejectedRecent: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.rejected_at >= (NOW() - INTERVAL 7 DAY)${O}`),
    addonsOpen: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.addon_of IS NOT NULL AND so.status IN ('Pending','Confirmed','Invoiced','Processing','Ready for Pickup','Out for Delivery')${O}`),
    incomplete: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ('Pending','Confirmed','Invoiced','Processing') AND ((so.method = 'delivery' AND TRIM(COALESCE(so.delivery_address,'')) = '') OR so.time_slot IS NULL OR so.time_slot = '')${O}`),
    closureAffected: (await closureAffected(req)).length,
    pendingCollection: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status = 'Ready for Pickup'${O}`),
    outForDelivery: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status = 'Out for Delivery'${O}`),
    failedDelivery: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.failed_at IS NOT NULL AND so.status = 'Processing'${O}`),
    completedWeek: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status = 'Received' AND so.received_at >= (NOW() - INTERVAL 7 DAY)${O}`),
    notInvoiced: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status NOT IN ('Cancelled','Pending') AND so.replacement_for IS NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.so_id = so.id AND i.void = 0)${O}`),
    toDispatch: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status = 'Processing'${O}`),
    // by pickup / delivery date (MYT): due today (incl. late ones) vs later dates
    dispatchToday: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ${NOT_DISPATCHED} AND so.fulfil_date <= '${todayMYT()}'${O}`),
    dispatchLate: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ${NOT_DISPATCHED} AND so.fulfil_date < '${todayMYT()}'${O}`),
    dispatchLater: await n(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ${NOT_DISPATCHED} AND so.fulfil_date > '${todayMYT()}'${O}`),
    openDiscrepancies: await n(`SELECT COUNT(DISTINCT d.so_id) AS n FROM discrepancies d JOIN sales_orders so ON so.id = d.so_id WHERE d.status = 'Open'${O}`),
    activeHolds: await n(`SELECT COUNT(*) AS n FROM stock_holds so WHERE so.status = 'Active'${O}`),
    openPOs: await n(`SELECT COUNT(*) AS n FROM purchase_orders so WHERE so.status IN ('Submitted','Approved')${O}`),
  };
  res.json({ thisMonth, lastMonth, today, pipeline, lowStock, recent, counts });
});

// ---------- Sales orders ----------
r.get('/sales-orders', async (req, res) => {
  const { status, q, fulfil_date } = req.query;
  let sql = `SELECT so.*, c.name AS customer_name, o.code AS outlet_code, i.inv_number, i.payment_status,
               (SELECT so_number FROM sales_orders a WHERE a.id = so.addon_of) AS addon_of_number,
               (SELECT COUNT(*) FROM sales_order_lines l WHERE l.so_id = so.id AND l.quantity > 0) AS line_count,
               (SELECT COUNT(*) FROM discrepancies d WHERE d.so_id = so.id AND d.status = 'Open') AS open_discrepancies
             FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN outlets o ON o.id = so.outlet_id
             LEFT JOIN invoices i ON i.so_id = so.id AND i.void = 0 WHERE 1=1${outletSql(req, 'so')}`;
  const p = [];
  if (status === 'Open') sql += ` AND so.status IN ${IN(['Pending', ...OPEN_STATUSES])}`;
  else if (status === 'Dispatched') sql += " AND so.status IN ('Ready for Pickup','Out for Delivery')";
  else if (status === 'DispatchToday') { sql += ` AND so.status IN ${NOT_DISPATCHED} AND so.fulfil_date <= ?`; p.push(todayMYT()); }
  else if (status === 'DispatchLater') { sql += ` AND so.status IN ${NOT_DISPATCHED} AND so.fulfil_date > ?`; p.push(todayMYT()); }
  else if (status === 'Pending') sql += " AND so.status = 'Pending'";
  else if (status === 'Rejected') sql += ' AND so.rejected_at IS NOT NULL';
  else if (status === 'Addons') sql += " AND so.addon_of IS NOT NULL AND so.status NOT IN ('Received','Cancelled')";
  else if (status === 'FailedDelivery') sql += " AND so.failed_at IS NOT NULL AND so.status = 'Processing'";
  else if (status === 'Incomplete') sql += " AND so.status IN ('Pending','Confirmed','Invoiced','Processing') AND ((so.method = 'delivery' AND TRIM(COALESCE(so.delivery_address,'')) = '') OR so.time_slot IS NULL OR so.time_slot = '')";
  else if (status) { sql += ' AND so.status = ?'; p.push(status); }
  if (fulfil_date) { sql += ' AND so.fulfil_date = ?'; p.push(fulfil_date); }
  if (q) { sql += ' AND (so.so_number LIKE ? OR c.name LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  const byDate = ['DispatchToday', 'DispatchLater'].includes(status);
  // awaiting approval: most urgent production date first
  const order = status === 'Pending' ? ' ORDER BY so.production_date, so.order_date' : byDate ? ' ORDER BY so.fulfil_date, so.time_slot, so.id' : ' ORDER BY so.order_date DESC';
  res.json(await db.prepare(sql + order).all(...p));
});

r.get('/sales-orders/:id', async (req, res) => {
  const so = await orderInScope(req, req.params.id);
  // while it awaits approval Admin sees whether the customer is currently blocked by unpaid / overdue invoices
  // while it awaits approval: is the customer blocked, and is there a Finance override that allows it?
  res.json(so.status === 'Pending' ? { ...so, blocking_invoices: await blockingInvoices(so.customer_id), active_override: await activeOverride(so.customer_id) || so.override } : so);
});
r.post('/sales-orders/:id/approve', async (req, res) => {
  await orderInScope(req, req.params.id);
  res.json(await approveOrder(Number(req.params.id), { userId: req.user.id }));
});
r.post('/sales-orders/:id/failed-delivery', async (req, res) => {
  await orderInScope(req, req.params.id);
  res.json(await failDelivery(Number(req.params.id), { userId: req.user.id, reason: req.body?.reason }));
});
r.post('/sales-orders/:id/reject', async (req, res) => {
  await orderInScope(req, req.params.id);
  res.json(await rejectOrder(Number(req.params.id), { userId: req.user.id, reason: req.body?.reason }));
});

// Admin-entered order (phone / walk-in): same rules as the customer checkout, for the customer's outlet
r.get('/checkout-info', async (req, res) => {
  const cid = Number(req.query.customer_id);
  const c = cid ? await customerInScope(req, cid) : null;
  const outlet = await getOutlet(c?.outlet_id || req.outletId || (await listOutlets())[0].id);
  const s = await pricingFor(outlet.id);
  res.json({
    outlet: { id: outlet.id, code: outlet.code, name: outlet.name },
    window: await orderWindow(new Date(), { outletId: outlet.id }), pickup_slots: outlet.pickup_slots, delivery_slots: outlet.delivery_slots,
    delivery_area: outlet.delivery_area, sst_rate: s.sst_rate, delivery_fee: s.delivery_fee, free_delivery_threshold: s.free_delivery_threshold,
    blocking_invoices: c ? await blockingInvoices(c.id) : [],
  });
});

r.post('/sales-orders', async (req, res) => {
  const b = req.body;
  await customerInScope(req, Number(b.customer_id));
  const id = await createOrder({
    customerId: Number(b.customer_id), lines: b.lines, method: b.method, fulfilDate: b.fulfil_date, timeSlot: b.time_slot,
    areaConfirmed: b.area_confirmed === true, deliveryAddress: b.delivery_address, notes: b.notes, userId: req.user.id, byStaff: true,
  });
  res.status(201).json({ id });
});

r.post('/sales-orders/:id/adjust', async (req, res) => {
  await orderInScope(req, req.params.id);
  res.json({ totals: await adjustOrder(Number(req.params.id), req.body.changes, { userId: req.user.id }) });
});
r.post('/sales-orders/:id/cancel', async (req, res) => { await orderInScope(req, req.params.id); await cancelOrder(Number(req.params.id), { user: req.user, reason: req.body.reason }); res.json({ ok: true }); });
r.post('/sales-orders/:id/dispatch', async (req, res) => { await orderInScope(req, req.params.id); res.json({ status: await dispatchOrder(Number(req.params.id), { userId: req.user.id }) }); });
r.post('/sales-orders/:id/delivery-link', async (req, res) => {
  await orderInScope(req, req.params.id);
  await setDeliveryLink(Number(req.params.id), { provider: req.body.provider, url: req.body.url, userId: req.user.id });
  res.json({ ok: true });
});

// ---------- Discrepancies ----------
// Every complaint is resolved with a credit note (Finance issues it) or a no-charge replacement order
r.get('/discrepancies', async (req, res) => {
  const status = req.query.status || 'Open';
  const rows = await db.prepare(`SELECT d.*, so.so_number, so.outlet_id, so.customer_id, so.method, so.replacement_for, so.sst_rate, o.code AS outlet_code, c.name AS customer_name, u.name AS resolved_by_name,
                       l.quantity AS line_qty, l.unit_price, rso.so_number AS replacement_so_number, rso.status AS replacement_status
                       FROM discrepancies d JOIN sales_orders so ON so.id = d.so_id JOIN customers c ON c.id = so.customer_id
                       JOIN outlets o ON o.id = so.outlet_id LEFT JOIN users u ON u.id = d.resolved_by
                       LEFT JOIN sales_order_lines l ON l.id = d.line_id LEFT JOIN sales_orders rso ON rso.id = d.replacement_so_id
                       WHERE (? = 'All' OR d.status = ?)${outletSql(req, 'so')} ORDER BY d.id DESC`).all(status, status);
  const cns = new Map((await listCreditNotes(`cn.discrepancy_id IN (${rows.map((r2) => Number(r2.id)).join(',') || 0})`)).map((c) => [c.discrepancy_id, c]));
  res.json(rows.map((d) => {
    const cn = d.action === 'credit_note' ? cns.get(d.id) : null;
    return { ...d, credit_note: cn ? { id: cn.id, status: cn.status, cn_number: cn.cn_number, total: cn.total, quantity: cn.lines[0]?.quantity } : null };
  }));
});
const complaintInScope = async (req, id) => {
  const d = await db.prepare('SELECT d.*, so.outlet_id FROM discrepancies d JOIN sales_orders so ON so.id = d.so_id WHERE d.id = ?').get(id);
  if (!d) throw new HttpError(404, 'Complaint not found');
  assertOutlet(req, d.outlet_id);
  return d;
};
r.post('/discrepancies/:id/credit-note', async (req, res) => {
  await complaintInScope(req, req.params.id);
  res.status(201).json(await requestCreditNote(Number(req.params.id), { qty: req.body.qty, reason: req.body.reason, userId: req.user.id }));
});
r.post('/discrepancies/:id/replacement', async (req, res) => {
  await complaintInScope(req, req.params.id);
  const so = await createReplacement(Number(req.params.id), { qty: req.body.qty, method: req.body.method, fulfilDate: req.body.fulfil_date, timeSlot: req.body.time_slot, userId: req.user.id });
  res.status(201).json({ id: so.id, so_number: so.so_number });
});

// ---------- Customers ----------
r.get('/customers', async (req, res) => {
  res.json(await mapEach(await db.prepare(`
    SELECT c.*, o.code AS outlet_code, o.name AS outlet_name,
      (SELECT email FROM users u WHERE u.customer_id = c.id LIMIT 1) AS login_email,
      (SELECT COUNT(*) FROM sales_orders so WHERE so.customer_id = c.id AND so.status <> 'Cancelled') AS order_count,
      (SELECT COALESCE(SUM(total),0) FROM sales_orders so WHERE so.customer_id = c.id AND so.status <> 'Cancelled') AS total_spent,
      (SELECT COALESCE(SUM(${BALANCE_SQL('i')}),0) FROM invoices i WHERE i.customer_id = c.id AND i.void = 0 AND i.payment_status <> 'Paid') AS outstanding,
      (SELECT COALESCE(SUM(${BALANCE_SQL('i')}),0) FROM invoices i WHERE i.customer_id = c.id AND i.void = 0 AND i.payment_status <> 'Paid' AND i.due_date < CURDATE()) AS overdue,
      (SELECT COUNT(*) FROM discrepancies d JOIN sales_orders so ON so.id = d.so_id WHERE so.customer_id = c.id AND d.status = 'Open') AS open_complaints,
      (SELECT MAX(order_date) FROM sales_orders so WHERE so.customer_id = c.id) AS last_order
    FROM customers c JOIN outlets o ON o.id = c.outlet_id WHERE 1=1${outletSql(req, 'c')}
    ORDER BY c.is_demo, o.id, c.code`).all(), async (c) => ({ ...c, blocked: (await blockingInvoices(c.id)).length > 0, override: await activeOverride(c.id) })));
});

async function createLogin(customer, loginEmail, password, name) {
  const email = String(loginEmail || '').toLowerCase().trim();
  if (!email || !password) throw new HttpError(400, 'Login email and password are required');
  if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(400, 'That login email is already in use');
  await db.prepare("INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?,?,?, 'customer', ?)").run(email, hashPassword(password), name || customer.contact || customer.name, customer.id);
}

// Creates the customer AND its portal login. New B2B customers start on COD in the chosen outlet.
r.post('/customers', async (req, res) => {
  const { name, contact, email, phone, address, billing_address, reg_no, login_email, password, credit_limit } = req.body;
  if (!name) throw new HttpError(400, 'Company / customer name is required');
  const outletId = await requireOutlet(req, req.body.outlet_id);
  const id = await db.transaction(async () => {
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM customers WHERE code LIKE 'CUS-%'").get()).n + 1;
    const code = String(req.body.code || '').trim() || `CUS-${String(n).padStart(3, '0')}`;
    if (await db.prepare('SELECT 1 FROM customers WHERE code = ?').get(code)) throw new HttpError(400, `Customer code ${code} already exists`);
    const cid = (await db.prepare(`INSERT INTO customers (code,name,outlet_id,reg_no,contact,email,phone,address,billing_address,payment_term,credit_limit,account_start_date)
                            VALUES (?,?,?,?,?,?,?,?,?,'COD',?,?)`)
      .run(code, name, outletId, reg_no || null, contact || null, email || login_email || null, phone || null, address || null, billing_address || null,
        credit_limit ? Number(credit_limit) : null, todayMYT())).lastInsertRowid;
    if (login_email || password) await createLogin({ id: cid, name, contact }, login_email, password);
    await notifyAdmins(outletId, 'customer', `New customer: ${name}`, `${code} (${(await getOutlet(outletId)).code}) added by ${req.user.name}`, '/admin/customers');
    return cid;
  })();
  res.status(201).json(await db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
});

// Give an existing customer (e.g. imported from the accounting system) a portal login
r.post('/customers/:id/login', async (req, res) => {
  const c = await customerInScope(req, req.params.id);
  if (await db.prepare('SELECT 1 FROM users WHERE customer_id = ?').get(c.id)) throw new HttpError(400, 'This customer already has a portal login');
  await createLogin(c, req.body.login_email, req.body.password, req.body.name);
  if (!c.email) await db.prepare('UPDATE customers SET email = ? WHERE id = ?').run(String(req.body.login_email).toLowerCase().trim(), c.id);
  res.status(201).json({ ok: true });
});

// ---------- Product images & availability (shared catalog) ----------
r.get('/product-images', async (req, res) => {
  res.json((await db.prepare('SELECT id, sku, name, category, size, is_available, image_file_id FROM products WHERE is_sellable = 1 ORDER BY id').all())
    .map((p) => ({ ...p, image_url: productImageUrl(p.image_file_id) })));
});
r.post('/products/:id/image', upload.single('image'), async (req, res) => {
  try {
    const p = await db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
    if (!p) throw new HttpError(404, 'Product not found');
    const fileId = await registerUpload(req.file, { kind: 'product_image', userId: req.user.id, imagesOnly: true });
    await db.prepare('UPDATE products SET image_file_id = ? WHERE id = ?').run(fileId, p.id);
    res.json({ image_url: productImageUrl(fileId) });
  } catch (e) { removeTempUploads(req); throw e; }
});
r.delete('/products/:id/image', async (req, res) => {
  await db.prepare('UPDATE products SET image_file_id = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
r.post('/products/:id/availability', async (req, res) => {
  await db.prepare('UPDATE products SET is_available = ? WHERE id = ? AND is_sellable = 1').run(req.body.is_available ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ---------- Announcements (per outlet, or both) ----------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
async function cleanAnnouncement(req) {
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
  if (a.outlet_id && !await getOutlet(a.outlet_id)) throw new HttpError(400, 'Unknown outlet');
  if (a.type === 'closure') {
    if (!DATE.test(a.closure_from || '')) throw new HttpError(400, 'Closure start date is required');
    a.closure_to = a.closure_to || a.closure_from;
    if (a.closure_to < a.closure_from) throw new HttpError(400, 'Closure end must be on or after its start');
  } else { a.closure_from = null; a.closure_to = null; }
  return a;
}
const annScope = (req) => (req.outletId ? ` AND (a.outlet_id IS NULL OR a.outlet_id = ${Number(req.outletId)})` : '');
const annInScope = async (req, id) => {
  const a = await db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!a) throw new HttpError(404, 'Not found');
  if (req.user.outlet_id && a.outlet_id !== req.user.outlet_id) throw new HttpError(403, 'This announcement belongs to head office or another outlet');
  return a;
};
r.get('/announcements', async (req, res) => {
  const today = todayMYT();
  res.json(await db.prepare(`SELECT a.*, u.name AS created_by_name, o.code AS outlet_code,
      CASE WHEN a.ends_on < ? THEN 'Expired' WHEN a.starts_on > ? THEN 'Scheduled' ELSE 'Live' END AS state
    FROM announcements a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN outlets o ON o.id = a.outlet_id
    WHERE 1=1${annScope(req)} ORDER BY a.starts_on DESC, a.id DESC`).all(today, today));
});
r.post('/announcements', async (req, res) => {
  const a = await cleanAnnouncement(req);
  const id = (await db.prepare('INSERT INTO announcements (title, body, outlet_id, type, starts_on, ends_on, closure_from, closure_to, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(a.title, a.body, a.outlet_id, a.type, a.starts_on, a.ends_on, a.closure_from, a.closure_to, req.user.id)).lastInsertRowid;
  res.status(201).json({ id });
});
r.put('/announcements/:id', async (req, res) => {
  await annInScope(req, req.params.id);
  const a = await cleanAnnouncement(req);
  await db.prepare("UPDATE announcements SET title=?, body=?, outlet_id=?, type=?, starts_on=?, ends_on=?, closure_from=?, closure_to=?, updated_at=NOW() WHERE id=?")
    .run(a.title, a.body, a.outlet_id, a.type, a.starts_on, a.ends_on, a.closure_from, a.closure_to, req.params.id);
  res.json({ ok: true });
});
// Expire = stop showing the banner (yesterday). Closure dates still apply unless the announcement is deleted.
r.post('/announcements/:id/expire', async (req, res) => {
  await annInScope(req, req.params.id);
  await db.prepare("UPDATE announcements SET ends_on = ?, starts_on = LEAST(starts_on, ?), updated_at=NOW() WHERE id=?")
    .run(addDays(todayMYT(), -1), addDays(todayMYT(), -1), req.params.id);
  res.json({ ok: true });
});
r.delete('/announcements/:id', async (req, res) => { await annInScope(req, req.params.id); await db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ---------- Closures (Admin → Closures) ----------
// Stored as 'closure' announcements, so customers still see them as a notice. Adding a closure never moves
// existing orders: open orders that now fall on a closed date are flagged here for Admin to review.
const BLOCKS = ['production', 'delivery', 'collection'];
async function cleanClosure(req) {
  const b = req.body || {};
  const c = {
    title: String(b.title || '').trim(), reason: String(b.reason || '').trim() || null, body: String(b.body || '').trim() || null,
    outlet_id: req.user.outlet_id || (b.outlet_id ? Number(b.outlet_id) : null),
    closure_from: b.closure_from, closure_to: b.closure_to || b.closure_from,
    blocks: [...new Set((Array.isArray(b.blocks) ? b.blocks : String(b.blocks || '').split(',')).map((x) => String(x).trim()).filter(Boolean))],
    repeat_yearly: b.repeat_yearly ? 1 : 0,
  };
  if (!c.title) throw new HttpError(400, 'Give the closure a name, e.g. "Hari Raya"');
  if (!DATE.test(c.closure_from || '') || !DATE.test(c.closure_to || '')) throw new HttpError(400, 'Choose the closure start and end dates');
  if (c.closure_to < c.closure_from) throw new HttpError(400, 'The end date must be on or after the start date');
  if (!c.blocks.length || c.blocks.some((x) => !BLOCKS.includes(x))) throw new HttpError(400, 'Choose what it blocks: production, delivery and/or collection');
  if (c.outlet_id && !await getOutlet(c.outlet_id)) throw new HttpError(400, 'Unknown outlet');
  return c;
}
// open orders (not yet handed over) whose pickup / delivery date is now closed, with the reason
async function closureAffected(req) {
  const rulesByOutlet = new Map();
  const rows = await db.prepare(`SELECT so.id, so.so_number, so.status, so.rejected_at, so.method, so.fulfil_date, so.production_date, so.outlet_id, c.name AS customer_name, o.code AS outlet_code
                           FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN outlets o ON o.id = so.outlet_id
                           WHERE so.status IN ('Pending','Confirmed','Invoiced','Processing') AND so.fulfil_date >= ?${outletSql(req, 'so')} ORDER BY so.fulfil_date`).all(todayMYT());
  const out = [];
  for (const o of rows) {
    if (!rulesByOutlet.has(o.outlet_id)) rulesByOutlet.set(o.outlet_id, await closureRules(o.outlet_id));
    const why = closureReason(o.fulfil_date, o.method, rulesByOutlet.get(o.outlet_id));
    if (why) out.push({ ...o, reason: why });
  }
  return out;
}
r.get('/closures', async (req, res) => {
  const rows = await db.prepare(`SELECT a.id, a.title, a.reason, a.body, a.outlet_id, a.closure_from, a.closure_to, a.blocks, a.repeat_yearly, a.created_at,
                             u.name AS created_by_name, o.code AS outlet_code
                           FROM announcements a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN outlets o ON o.id = a.outlet_id
                           WHERE a.type = 'closure'${annScope(req)} ORDER BY a.closure_from DESC`).all();
  res.json({ closures: rows.map((r) => ({ ...r, blocks: String(r.blocks || 'delivery,collection').split(',').filter(Boolean) })), affected: await closureAffected(req), today: todayMYT() });
});
r.post('/closures', async (req, res) => {
  const c = await cleanClosure(req);
  const id = (await db.prepare(`INSERT INTO announcements (title, body, outlet_id, type, starts_on, ends_on, closure_from, closure_to, blocks, reason, repeat_yearly, created_by)
                         VALUES (?,?,?, 'closure', ?,?,?,?,?,?,?,?)`)
    .run(c.title, c.body, c.outlet_id, todayMYT(), c.closure_to, c.closure_from, c.closure_to, c.blocks.join(','), c.reason, c.repeat_yearly, req.user.id)).lastInsertRowid;
  await audit({ entity: 'closure', entityId: id, action: 'created', userId: req.user.id, outletId: c.outlet_id, after: { ...c } });
  const affected = await closureAffected(req);
  if (affected.length) await notifyAdmins(c.outlet_id, 'order_status', `Closure "${c.title}" affects ${affected.length} order(s)`, affected.map((o) => o.so_number).join(', '), '/admin/closures');
  res.status(201).json({ id, affected });
});
r.put('/closures/:id', async (req, res) => {
  const before = await annInScope(req, req.params.id);
  if (before.type !== 'closure') throw new HttpError(404, 'Not found');
  const c = await cleanClosure(req);
  await db.prepare(`UPDATE announcements SET title=?, body=?, outlet_id=?, ends_on=GREATEST(ends_on, ?), closure_from=?, closure_to=?, blocks=?, reason=?, repeat_yearly=?, updated_at=NOW() WHERE id=?`)
    .run(c.title, c.body, c.outlet_id, c.closure_to, c.closure_from, c.closure_to, c.blocks.join(','), c.reason, c.repeat_yearly, req.params.id);
  await audit({ entity: 'closure', entityId: Number(req.params.id), action: 'changed', userId: req.user.id, outletId: c.outlet_id,
    before: { title: before.title, closure_from: before.closure_from, closure_to: before.closure_to, blocks: before.blocks, reason: before.reason, repeat_yearly: before.repeat_yearly }, after: { ...c } });
  res.json({ ok: true, affected: await closureAffected(req) });
});
r.delete('/closures/:id', async (req, res) => {
  const before = await annInScope(req, req.params.id);
  if (before.type !== 'closure') throw new HttpError(404, 'Not found');
  await db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  await audit({ entity: 'closure', entityId: Number(req.params.id), action: 'deleted', userId: req.user.id, outletId: before.outlet_id, before: { title: before.title, closure_from: before.closure_from, closure_to: before.closure_to, blocks: before.blocks } });
  res.json({ ok: true });
});

// ---------- Email outbox ----------
r.get('/emails', async (req, res) => {
  res.json(await db.prepare(`SELECT e.id, e.to_email, e.subject, e.template, e.related_type, e.related_id, e.status, e.error, e.created_at, o.code AS outlet_code
                       FROM email_outbox e LEFT JOIN outlets o ON o.id = e.outlet_id WHERE 1=1${outletSql(req, 'e')} ORDER BY e.id DESC LIMIT 300`).all());
});
r.get('/emails/:id', async (req, res) => {
  const e = await db.prepare('SELECT * FROM email_outbox WHERE id = ?').get(req.params.id);
  if (!e) throw new HttpError(404, 'Email not found');
  if (e.outlet_id) assertOutlet(req, e.outlet_id);
  res.json(e);
});

// ---------- Stock (per outlet) ----------
r.get('/stock', async (req, res) => res.json(await stockRows(req.outletId)));

r.post('/stock/adjust', async (req, res) => {
  const { product_id, qty, reason } = req.body;
  const outletId = await requireOutlet(req, req.body.outlet_id);
  const n = parseInt(qty, 10);
  if (!product_id) throw new HttpError(400, 'Choose a product');
  if (!n) throw new HttpError(400, 'Quantity must be a non-zero whole number');
  if (!reason) throw new HttpError(400, 'A reason is required for stock adjustments');
  const s = await getStock(product_id, outletId);
  if (!s) throw new HttpError(404, 'Product not found');
  if (n < 0 && s.stock_on_hand + n < s.on_hold) throw new HttpError(400, `Cannot reduce below the ${s.on_hold} ${s.uom} currently on hold`);
  const balance = await db.transaction(async () => await moveStock(Number(product_id), outletId, 'adjustment', n, { reason, userId: req.user.id }))();
  res.json({ ok: true, balance });
});

r.get('/stock/movements', async (req, res) => {
  const { product_id, type } = req.query;
  let sql = `SELECT m.*, p.sku, p.name AS product_name, p.uom, u.name AS user_name, o.code AS outlet_code FROM stock_movements m
             JOIN products p ON p.id = m.product_id JOIN outlets o ON o.id = m.outlet_id LEFT JOIN users u ON u.id = m.user_id WHERE 1=1${outletSql(req, 'm')}`;
  const p = [];
  if (product_id) { sql += ' AND m.product_id = ?'; p.push(product_id); }
  if (type) { sql += ' AND m.type = ?'; p.push(type); }
  res.json(await db.prepare(sql + ' ORDER BY m.created_at DESC, m.id DESC LIMIT 300').all(...p));
});

r.get('/stock/holds', async (req, res) => {
  const status = req.query.status || 'Active';
  res.json(await db.prepare(`
    SELECT h.*, p.sku, p.name AS product_name, p.uom, c.name AS customer_name, so.so_number, u.name AS created_by_name, o.code AS outlet_code
    FROM stock_holds h JOIN products p ON p.id = h.product_id JOIN outlets o ON o.id = h.outlet_id
    LEFT JOIN customers c ON c.id = h.customer_id LEFT JOIN sales_orders so ON so.id = h.so_id
    LEFT JOIN users u ON u.id = h.created_by
    WHERE (? = 'All' OR h.status = ?)${outletSql(req, 'h')} ORDER BY h.created_at DESC LIMIT 300`).all(status, status));
});

r.post('/stock/holds', async (req, res) => {
  const { product_id, qty, reason, customer_id } = req.body;
  const outletId = await requireOutlet(req, req.body.outlet_id);
  const n = parseInt(qty, 10);
  if (!product_id || !(n > 0)) throw new HttpError(400, 'Choose a product and a quantity greater than 0');
  if (!reason) throw new HttpError(400, 'A reason is required');
  const s = await getStock(product_id, outletId);
  if (!s) throw new HttpError(404, 'Product not found');
  if (n > s.available) throw new HttpError(400, `Only ${s.available} ${s.uom} available to hold`);
  if (customer_id) await customerInScope(req, customer_id);
  await db.prepare('INSERT INTO stock_holds (product_id, outlet_id, qty, reason, customer_id, created_by) VALUES (?,?,?,?,?,?)').run(product_id, outletId, n, reason, customer_id || null, req.user.id);
  await checkLowStock(Number(product_id), outletId);
  res.status(201).json({ ok: true });
});

r.post('/stock/holds/:id/release', async (req, res) => {
  const h = await db.prepare('SELECT * FROM stock_holds WHERE id = ?').get(req.params.id);
  if (!h || h.status !== 'Active') throw new HttpError(400, 'Hold is not active');
  assertOutlet(req, h.outlet_id);
  await db.prepare("UPDATE stock_holds SET status = 'Released', released_at = NOW() WHERE id = ?").run(h.id);
  res.json({ ok: true });
});

// ---------- Statistics (revenue = product subtotal before SST & delivery) ----------
r.get('/statistics', async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
  const since = (await db.prepare("SELECT DATE_FORMAT(CURDATE() - INTERVAL ? MONTH, '%Y-%m-01') AS d").get(months - 1)).d;
  const live = `so.status <> 'Cancelled' AND so.order_date >= '${since}'${outletSql(req, 'so')}`;

  const monthlyRows = await db.prepare(`SELECT DATE_FORMAT(order_date, '%Y-%m') AS month, SUM(subtotal) AS revenue, COUNT(*) AS orders
                                  FROM sales_orders so WHERE ${live} GROUP BY month`).all();
  const monthly = [];
  const d = new Date(`${since}T00:00:00Z`);
  for (let i = 0; i < months; i++) {
    const key = d.toISOString().slice(0, 7);
    const row = monthlyRows.find((m) => m.month === key);
    monthly.push({ month: key, revenue: row?.revenue || 0, orders: row?.orders || 0 });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const totals = await db.prepare(`SELECT COALESCE(SUM(subtotal),0) AS revenue, COUNT(*) AS orders FROM sales_orders so WHERE ${live}`).get();
  totals.units = (await db.prepare(`SELECT COALESCE(SUM(l.quantity),0) AS n FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id WHERE ${live}`).get()).n;
  totals.aov = totals.orders ? totals.revenue / totals.orders : 0;

  const topProducts = await db.prepare(`
    SELECT p.name, p.sku, SUM(l.line_total) AS revenue, SUM(l.quantity) AS units
    FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id JOIN products p ON p.id = l.product_id
    WHERE ${live} AND l.quantity > 0 GROUP BY p.id, p.name, p.sku ORDER BY revenue DESC LIMIT 8`).all();
  const topCustomers = await db.prepare(`
    SELECT c.name, SUM(so.subtotal) AS revenue, COUNT(*) AS orders
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id
    WHERE ${live} GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT 8`).all();
  const byStatus = await db.prepare(`SELECT status, COUNT(*) AS count FROM sales_orders so WHERE so.order_date >= '${since}'${outletSql(req, 'so')} GROUP BY status`).all();

  res.json({ months, since, totals, monthly, topProducts, topCustomers, byStatus });
});

// ---------- Settings: company & outlet details, ordering rules ----------
// Head-office admins can edit; outlet admins see their own outlet read-only.
const OUTLET_TEXT = { company_name: 120, company_address: 300, company_reg_no: 60, sst_reg_no: 60, bank_name: 80, bank_account_name: 120, bank_account_no: 40, pickup_address: 300, delivery_area: 160, email: 120 };
const RULES = {
  max_days_ahead: { min: 1, max: 120, int: true }, credit_term_min_months: { min: 0, max: 24, int: true },
};
const headOffice = (req) => { if (req.user.outlet_id) throw new HttpError(403, 'Only head office can change settings'); };

r.get('/settings', async (req, res) => {
  const outlets = (await listOutlets()).filter((o) => !req.user.outlet_id || o.id === req.user.outlet_id);
  const s = await getSettings();
  res.json({ can_edit: !req.user.outlet_id, outlets, rules: { sst_rate: s.sst_rate,
    cutoff_time: s.cutoff_time, max_days_ahead: s.max_days_ahead, credit_term_min_months: s.credit_term_min_months } });
});

r.put('/settings/outlets/:id', async (req, res) => {
  headOffice(req);
  const o = await getOutlet(Number(req.params.id));
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
  if (set.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(set.email)) throw new HttpError(400, 'Company email: enter a valid email address');
  if (set.bank_account_no !== undefined && set.bank_account_no && !/^[0-9 -]{6,30}$/.test(set.bank_account_no)) throw new HttpError(400, 'Bank account number: digits only (spaces and dashes allowed)');
  for (const k of ['pickup_slots', 'delivery_slots']) {
    if (b[k] === undefined) continue;
    const list = (Array.isArray(b[k]) ? b[k] : String(b[k]).split('\n')).map((x) => String(x).trim()).filter(Boolean);
    if (!list.length) throw new HttpError(400, `Add at least one ${k === 'pickup_slots' ? 'pickup' : 'delivery'} time slot`);
    if (list.length > 12 || list.some((x) => x.length > 60)) throw new HttpError(400, 'Time slots: up to 12, each up to 60 characters');
    set[k] = JSON.stringify(list);
  }
  for (const [k, max, label] of [['delivery_fee', 1000, 'Delivery fee'], ['free_delivery_threshold', 100000, 'Free delivery from']]) {
    if (b[k] === undefined || b[k] === '') continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, `${label} must be between RM 0 and RM ${max}`);
    set[k] = Math.round(n * 100) / 100;
  }
  if (b.invoice_method !== undefined) {
    if (!['generated', 'uploaded', 'bukku'].includes(b.invoice_method)) throw new HttpError(400, 'Invoice method: generated PDF, uploaded file or Bukku');
    set.invoice_method = b.invoice_method;
  }
  if (b.do_method !== undefined) {
    if (!['generated', 'uploaded'].includes(b.do_method)) throw new HttpError(400, 'DO method: generated PDF or uploaded file');
    set.do_method = b.do_method;
  }
  const keys = Object.keys(set);
  if (keys.length) await audit({ entity: 'outlet', entityId: o.id, action: 'settings_changed', userId: req.user.id, outletId: o.id, before: Object.fromEntries(keys.map((k) => [k, o[k]])), after: set });
  if (keys.length) await db.prepare(`UPDATE outlets SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...set, id: o.id });
  res.json(await getOutlet(o.id));
});

r.put('/settings/rules', async (req, res) => {
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
  for (const [k, v] of Object.entries(next)) await setSetting(k, v);
  const s = await getSettings();
  res.json({ sst_rate: s.sst_rate, delivery_fee: s.delivery_fee, free_delivery_threshold: s.free_delivery_threshold, cutoff_time: s.cutoff_time, max_days_ahead: s.max_days_ahead, credit_term_min_months: s.credit_term_min_months });
});

// ---------- DO upload by Admin (Finance can too, from the invoice) ----------
r.get('/invoices/:id/documents', async (req, res) => {
  const inv = await db.prepare('SELECT outlet_id FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  assertOutlet(req, inv.outlet_id);
  res.json(await documentHistory(Number(req.params.id)));
});
r.post('/invoices/:id/do', upload.single('file'), async (req, res) => {
  try {
    const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    assertOutlet(req, inv.outlet_id);
    if (!req.file) throw new HttpError(400, 'Attach the DO (PDF or photo)');
    const fileId = await registerUpload(req.file, { kind: 'do', customerId: inv.customer_id, userId: req.user.id });
    res.json(await uploadDocument(inv.id, { kind: 'do', fileId, reason: req.body.reason, doDate: req.body.do_date || null, user: req.user }));
  } catch (e) { removeTempUploads(req); throw e; }
});

export default r;
