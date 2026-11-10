import { Router } from 'express';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { hashPassword } from '../passwords.js';
import { STOCK_SQL, getStock, moveStock, checkLowStock } from '../stock.js';
import { createSalesOrder, changeSalesStatus, getSalesOrder } from '../sales.js';
import { notifyAdmins } from '../notify.js';

const r = Router();
const OPEN = "('Pending','Confirmed','Packed')";

// ---------- Dashboard ----------
r.get('/dashboard', (req, res) => {
  const sum = (where) => db.prepare(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM sales_orders
                                     WHERE status <> 'Cancelled' AND ${where}`).get();
  const thisMonth = sum("order_date >= date('now','start of month')");
  const lastMonth = sum("order_date >= date('now','start of month','-1 month') AND order_date < date('now','start of month')");
  const today = sum("date(order_date) = date('now')");
  const pipeline = db.prepare(`SELECT status, COUNT(*) AS count FROM sales_orders GROUP BY status`).all();
  const lowStock = db.prepare(`${STOCK_SQL} WHERE p.stock_on_hand - COALESCE(h.qty,0) <= p.reorder_level ORDER BY available`).all();
  const recent = db.prepare(`SELECT so.id, so.so_number, so.order_date, so.status, so.total, c.name AS customer_name
                             FROM sales_orders so JOIN customers c ON c.id = so.customer_id ORDER BY so.order_date DESC LIMIT 8`).all();
  const counts = {
    customers: db.prepare('SELECT COUNT(*) AS n FROM customers').get().n,
    toFulfil: db.prepare(`SELECT COUNT(*) AS n FROM sales_orders WHERE status IN ${OPEN}`).get().n,
    activeHolds: db.prepare("SELECT COUNT(*) AS n FROM stock_holds WHERE status = 'Active'").get().n,
    openPOs: db.prepare("SELECT COUNT(*) AS n FROM purchase_orders WHERE status IN ('Submitted','Approved')").get().n,
  };
  res.json({ thisMonth, lastMonth, today, pipeline, lowStock, recent, counts });
});

// ---------- Sales orders ----------
r.get('/sales-orders', (req, res) => {
  const { status, q, customer_id } = req.query;
  let sql = `SELECT so.*, c.name AS customer_name,
               (SELECT COUNT(*) FROM sales_order_lines l WHERE l.so_id = so.id) AS line_count
             FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE 1=1`;
  const p = [];
  if (status === 'Open') sql += ` AND so.status IN ${OPEN}`;
  else if (status) { sql += ' AND so.status = ?'; p.push(status); }
  if (customer_id) { sql += ' AND so.customer_id = ?'; p.push(customer_id); }
  if (q) { sql += ' AND (so.so_number LIKE ? OR c.name LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  res.json(db.prepare(sql + ' ORDER BY so.order_date DESC').all(...p));
});

r.get('/sales-orders/:id', (req, res) => {
  const so = getSalesOrder(req.params.id);
  if (!so) throw new HttpError(404, 'Order not found');
  res.json(so);
});

r.post('/sales-orders', (req, res) => {
  const { customer_id, lines, delivery_address, notes } = req.body;
  const id = createSalesOrder({ customerId: Number(customer_id), lines, deliveryAddress: delivery_address, notes, userId: req.user.id });
  res.status(201).json({ id });
});

r.post('/sales-orders/:id/status', (req, res) => {
  const { status, carrier, tracking_no, note } = req.body;
  changeSalesStatus(Number(req.params.id), status, { userId: req.user.id, carrier, trackingNo: tracking_no, note });
  res.json({ ok: true });
});

// ---------- Customers ----------
r.get('/customers', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*,
      (SELECT email FROM users u WHERE u.customer_id = c.id LIMIT 1) AS login_email,
      (SELECT COUNT(*) FROM sales_orders so WHERE so.customer_id = c.id AND so.status <> 'Cancelled') AS order_count,
      (SELECT COALESCE(SUM(total),0) FROM sales_orders so WHERE so.customer_id = c.id AND so.status <> 'Cancelled') AS total_spent,
      (SELECT MAX(order_date) FROM sales_orders so WHERE so.customer_id = c.id) AS last_order
    FROM customers c ORDER BY c.code`).all());
});

// Creates the customer account AND its portal login
r.post('/customers', (req, res) => {
  const { name, contact, email, phone, address, login_email, password } = req.body;
  if (!name) throw new HttpError(400, 'Company / customer name is required');
  if (!login_email || !password) throw new HttpError(400, 'Login email and password are required');
  if (String(password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  const loginEmail = String(login_email).toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(loginEmail)) throw new HttpError(400, 'That login email is already in use');

  const id = db.transaction(() => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n + 1;
    const code = `CUS-${String(n).padStart(3, '0')}`;
    const cid = db.prepare('INSERT INTO customers (code,name,contact,email,phone,address) VALUES (?,?,?,?,?,?)')
      .run(code, name, contact || null, email || loginEmail, phone || null, address || null).lastInsertRowid;
    db.prepare("INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?,?,?, 'customer', ?)")
      .run(loginEmail, hashPassword(password), contact || name, cid);
    notifyAdmins('customer', `New customer: ${name}`, `${code} added by ${req.user.name}`, '/admin/customers');
    return cid;
  })();
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
});

// ---------- Stock ----------
r.get('/stock', (req, res) => res.json(db.prepare(`${STOCK_SQL} ORDER BY p.category, p.sku`).all()));

r.post('/stock/adjust', (req, res) => {
  const { product_id, qty, reason } = req.body;
  const n = parseInt(qty, 10);
  if (!product_id) throw new HttpError(400, 'Choose a product');
  if (!n) throw new HttpError(400, 'Quantity must be a non-zero whole number');
  if (!reason) throw new HttpError(400, 'A reason is required for stock adjustments');
  const s = getStock(product_id);
  if (n < 0 && s.stock_on_hand + n < s.on_hold) {
    throw new HttpError(400, `Cannot reduce below the ${s.on_hold} ${s.uom} currently on hold`);
  }
  const balance = db.transaction(() => moveStock(Number(product_id), 'adjustment', n, { reason, userId: req.user.id }))();
  res.json({ ok: true, balance });
});

r.get('/stock/movements', (req, res) => {
  const { product_id, type } = req.query;
  let sql = `SELECT m.*, p.sku, p.name AS product_name, p.uom, u.name AS user_name FROM stock_movements m
             JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id WHERE 1=1`;
  const p = [];
  if (product_id) { sql += ' AND m.product_id = ?'; p.push(product_id); }
  if (type) { sql += ' AND m.type = ?'; p.push(type); }
  res.json(db.prepare(sql + ' ORDER BY m.created_at DESC, m.id DESC LIMIT 300').all(...p));
});

r.get('/stock/holds', (req, res) => {
  const status = req.query.status || 'Active';
  res.json(db.prepare(`
    SELECT h.*, p.sku, p.name AS product_name, p.uom, c.name AS customer_name, so.so_number, u.name AS created_by_name
    FROM stock_holds h JOIN products p ON p.id = h.product_id
    LEFT JOIN customers c ON c.id = h.customer_id LEFT JOIN sales_orders so ON so.id = h.so_id
    LEFT JOIN users u ON u.id = h.created_by
    WHERE (? = 'All' OR h.status = ?) ORDER BY h.created_at DESC LIMIT 300`).all(status, status));
});

// Manual hold (e.g. reserve stock for a customer event, quality check, damaged pending inspection)
r.post('/stock/holds', (req, res) => {
  const { product_id, qty, reason, customer_id } = req.body;
  const n = parseInt(qty, 10);
  if (!product_id || !(n > 0)) throw new HttpError(400, 'Choose a product and a quantity greater than 0');
  if (!reason) throw new HttpError(400, 'A reason is required');
  const s = getStock(product_id);
  if (n > s.available) throw new HttpError(400, `Only ${s.available} ${s.uom} available to hold`);
  db.prepare('INSERT INTO stock_holds (product_id, qty, reason, customer_id, created_by) VALUES (?,?,?,?,?)')
    .run(product_id, n, reason, customer_id || null, req.user.id);
  checkLowStock(Number(product_id));
  res.status(201).json({ ok: true });
});

r.post('/stock/holds/:id/release', (req, res) => {
  const h = db.prepare('SELECT * FROM stock_holds WHERE id = ?').get(req.params.id);
  if (!h || h.status !== 'Active') throw new HttpError(400, 'Hold is not active');
  if (h.so_id) throw new HttpError(400, 'This hold belongs to a sales order — cancel or ship the order instead');
  db.prepare("UPDATE stock_holds SET status = 'Released', released_at = datetime('now') WHERE id = ?").run(h.id);
  res.json({ ok: true });
});

// ---------- Statistics ----------
r.get('/statistics', (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
  const since = db.prepare(`SELECT date('now','start of month', ?) AS d`).get(`-${months - 1} months`).d;
  const live = `so.status <> 'Cancelled' AND so.order_date >= '${since}'`;

  const monthlyRows = db.prepare(`SELECT strftime('%Y-%m', order_date) AS month, SUM(total) AS revenue, COUNT(*) AS orders
                                  FROM sales_orders so WHERE ${live} GROUP BY month`).all();
  // fill months with no sales so the axis is continuous
  const monthly = [];
  const d = new Date(`${since}T00:00:00Z`);
  for (let i = 0; i < months; i++) {
    const key = d.toISOString().slice(0, 7);
    const row = monthlyRows.find((m) => m.month === key);
    monthly.push({ month: key, revenue: row?.revenue || 0, orders: row?.orders || 0 });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }

  const totals = db.prepare(`SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS orders FROM sales_orders so WHERE ${live}`).get();
  totals.units = db.prepare(`SELECT COALESCE(SUM(l.quantity),0) AS n FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id WHERE ${live}`).get().n;
  totals.aov = totals.orders ? totals.revenue / totals.orders : 0;

  const topProducts = db.prepare(`
    SELECT p.name, p.sku, SUM(l.line_total) AS revenue, SUM(l.quantity) AS units
    FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id JOIN products p ON p.id = l.product_id
    WHERE ${live} GROUP BY p.id ORDER BY revenue DESC LIMIT 8`).all();
  const topCustomers = db.prepare(`
    SELECT c.name, SUM(so.total) AS revenue, COUNT(*) AS orders
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id
    WHERE ${live} GROUP BY c.id ORDER BY revenue DESC LIMIT 8`).all();
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS count FROM sales_orders so WHERE so.order_date >= '${since}' GROUP BY status`).all();

  res.json({ months, since, totals, monthly, topProducts, topCustomers, byStatus });
});

export default r;
