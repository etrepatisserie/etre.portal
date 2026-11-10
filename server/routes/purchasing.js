import { Router } from 'express';
import db from '../db.js';
import { round2 } from '../errors.js';
import { moveStock } from '../stock.js';
import { importCatalog } from '../catalog.js';

// Suppliers, products master and purchase orders (admin only — mounted under /api/admin)
const r = Router();

// ---------- Suppliers ----------
r.get('/suppliers', (req, res) => res.json(db.prepare('SELECT * FROM suppliers ORDER BY code').all()));

r.post('/suppliers', (req, res) => {
  const { code, name, contact, email, phone, address } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'Code and name are required' });
  try {
    const x = db.prepare('INSERT INTO suppliers (code,name,contact,email,phone,address) VALUES (?,?,?,?,?,?)')
      .run(code, name, contact, email, phone, address);
    res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(x.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Supplier code already exists' : e.message });
  }
});

// ---------- Products ----------
r.get('/products', (req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY is_sellable DESC, id').all()));

// Re-read server/data/catalog.json and add/update products by SKU (stock untouched)
r.post('/products/import-catalog', (req, res) => res.json(importCatalog()));

r.post('/products', (req, res) => {
  const { sku, name, category, uom, unit_cost, sell_price, reorder_level, opening_stock,
    size, moq, recommended_rsp, shelf_life, is_sellable } = req.body;
  if (!sku || !name) return res.status(400).json({ error: 'SKU and name are required' });
  try {
    const id = db.transaction(() => {
      const x = db.prepare(`INSERT INTO products (sku,name,category,uom,unit_cost,sell_price,reorder_level,size,moq,recommended_rsp,shelf_life,is_sellable)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(sku, name, category || 'General', uom || 'PC', Number(unit_cost) || 0, Number(sell_price) || 0, parseInt(reorder_level, 10) || 0,
          size || null, Math.max(parseInt(moq, 10) || 1, 1), recommended_rsp || null, shelf_life || null, String(is_sellable) === '0' ? 0 : 1);
      const qty = parseInt(opening_stock, 10) || 0;
      if (qty > 0) moveStock(x.lastInsertRowid, 'receipt', qty, { reason: 'Opening stock', userId: req.user.id });
      return x.lastInsertRowid;
    })();
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'SKU already exists' : e.message });
  }
});

// ---------- Purchase Orders ----------
r.get('/purchase-orders', (req, res) => {
  const { status, q } = req.query;
  let sql = `SELECT po.*, s.name AS supplier_name FROM purchase_orders po
             JOIN suppliers s ON s.id = po.supplier_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND po.status = ?'; params.push(status); }
  if (q) { sql += ' AND (po.po_number LIKE ? OR s.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  res.json(db.prepare(sql + ' ORDER BY po.id DESC').all(...params));
});

r.get('/purchase-orders/:id', (req, res) => {
  const po = db.prepare(`
    SELECT po.*, s.name AS supplier_name, s.code AS supplier_code, s.address AS supplier_address,
           s.email AS supplier_email, s.contact AS supplier_contact
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`).get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  po.lines = db.prepare(`
    SELECT l.*, p.sku, p.uom FROM purchase_order_lines l
    LEFT JOIN products p ON p.id = l.product_id WHERE l.po_id = ? ORDER BY l.line_no`).all(po.id);
  res.json(po);
});

function nextPoNumber() {
  const prefix = `PO-${new Date().getFullYear()}-`;
  const last = db.prepare('SELECT po_number FROM purchase_orders WHERE po_number LIKE ? ORDER BY po_number DESC LIMIT 1').get(`${prefix}%`);
  return prefix + String(last ? parseInt(last.po_number.slice(prefix.length), 10) + 1 : 1).padStart(4, '0');
}

function validatePo({ supplier_id, order_date, lines }) {
  if (!supplier_id) return 'Supplier is required';
  if (!order_date) return 'Order date is required';
  if (!Array.isArray(lines) || lines.length === 0) return 'At least one line item is required';
  for (const [i, l] of lines.entries()) {
    if (!l.description) return `Line ${i + 1}: description is required`;
    if (!(Number(l.quantity) > 0)) return `Line ${i + 1}: quantity must be greater than 0`;
    if (!(Number(l.unit_price) >= 0)) return `Line ${i + 1}: unit price is invalid`;
  }
  return null;
}

function savePo(id, body) {
  const { supplier_id, order_date, expected_date, notes, lines } = body;
  const tax_rate = Number(body.tax_rate) || 0;
  const clean = lines.map((l, i) => ({
    line_no: i + 1, product_id: l.product_id || null, description: l.description,
    quantity: Number(l.quantity), unit_price: Number(l.unit_price),
    line_total: round2(Number(l.quantity) * Number(l.unit_price)),
  }));
  const subtotal = round2(clean.reduce((a, l) => a + l.line_total, 0));
  const tax_amount = round2(subtotal * tax_rate / 100);
  const total = round2(subtotal + tax_amount);

  return db.transaction(() => {
    if (id) {
      db.prepare(`UPDATE purchase_orders SET supplier_id=?, order_date=?, expected_date=?, notes=?,
                  tax_rate=?, subtotal=?, tax_amount=?, total=?, updated_at=datetime('now') WHERE id=?`)
        .run(supplier_id, order_date, expected_date || null, notes || null, tax_rate, subtotal, tax_amount, total, id);
      db.prepare('DELETE FROM purchase_order_lines WHERE po_id = ?').run(id);
    } else {
      id = db.prepare(`INSERT INTO purchase_orders
          (po_number, supplier_id, order_date, expected_date, notes, tax_rate, subtotal, tax_amount, total, status)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(nextPoNumber(), supplier_id, order_date, expected_date || null, notes || null,
          tax_rate, subtotal, tax_amount, total, body.status === 'Submitted' ? 'Submitted' : 'Draft').lastInsertRowid;
    }
    const ins = db.prepare(`INSERT INTO purchase_order_lines
        (po_id, line_no, product_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?,?)`);
    for (const l of clean) ins.run(id, l.line_no, l.product_id, l.description, l.quantity, l.unit_price, l.line_total);
    return id;
  })();
}

r.post('/purchase-orders', (req, res) => {
  const err = validatePo(req.body);
  if (err) return res.status(400).json({ error: err });
  res.status(201).json({ id: savePo(null, req.body) });
});

r.put('/purchase-orders/:id', (req, res) => {
  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (po.status !== 'Draft') return res.status(400).json({ error: 'Only Draft purchase orders can be edited' });
  const err = validatePo(req.body);
  if (err) return res.status(400).json({ error: err });
  savePo(Number(req.params.id), req.body);
  res.json({ id: Number(req.params.id) });
});

const PO_FLOW = {
  Draft: ['Submitted', 'Cancelled'],
  Submitted: ['Approved', 'Draft', 'Cancelled'],
  Approved: ['Received', 'Cancelled'],
  Received: [],
  Cancelled: [],
};

r.post('/purchase-orders/:id/status', (req, res) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body;
  if (!PO_FLOW[po.status].includes(status)) {
    return res.status(400).json({ error: `Cannot change status from ${po.status} to ${status}` });
  }
  db.transaction(() => {
    if (status === 'Received') {
      // goods arrive: add stock for every line linked to a product
      const lines = db.prepare('SELECT * FROM purchase_order_lines WHERE po_id = ? AND product_id IS NOT NULL').all(po.id);
      for (const l of lines) {
        moveStock(l.product_id, 'receipt', Math.round(l.quantity), { reason: 'Purchase order received', ref: po.po_number, userId: req.user.id });
      }
    }
    db.prepare("UPDATE purchase_orders SET status=?, updated_at=datetime('now') WHERE id=?").run(status, po.id);
  })();
  res.json({ ok: true });
});

r.delete('/purchase-orders/:id', (req, res) => {
  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Not found' });
  if (po.status !== 'Draft') return res.status(400).json({ error: 'Only Draft purchase orders can be deleted' });
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
