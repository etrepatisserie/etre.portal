import { Router } from 'express';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { STOCK_SQL } from '../stock.js';
import { createSalesOrder, changeSalesStatus, getSalesOrder } from '../sales.js';

// Customer portal API — every query is scoped to req.user.customer_id
const r = Router();

r.get('/profile', (req, res) => {
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.user.customer_id));
});

// Catalogue: customers only see sell price and available quantity (never cost or on-hand)
r.get('/products', (req, res) => {
  const rows = db.prepare(`${STOCK_SQL} WHERE p.is_sellable = 1 ORDER BY p.id`).all();
  res.json(rows.map((p) => ({
    id: p.id, sku: p.sku, name: p.name, category: p.category, category_note: p.notes, uom: p.uom,
    size: p.size, moq: p.moq, rsp: p.recommended_rsp, shelf_life: p.shelf_life,
    price: p.sell_price, available: Math.max(p.available, 0),
  })));
});

r.get('/orders', (req, res) => {
  res.json(db.prepare(`
    SELECT so.*, (SELECT COUNT(*) FROM sales_order_lines l WHERE l.so_id = so.id) AS line_count,
           (SELECT SUM(quantity) FROM sales_order_lines l WHERE l.so_id = so.id) AS unit_count
    FROM sales_orders so WHERE so.customer_id = ? ORDER BY so.order_date DESC`).all(req.user.customer_id));
});

const ownOrder = (req) => {
  const so = getSalesOrder(req.params.id);
  if (!so || so.customer_id !== req.user.customer_id) throw new HttpError(404, 'Order not found');
  return so;
};

r.get('/orders/:id', (req, res) => res.json(ownOrder(req)));

r.post('/orders', (req, res) => {
  const { lines, delivery_address, notes } = req.body;
  const id = createSalesOrder({ customerId: req.user.customer_id, lines, deliveryAddress: delivery_address, notes, userId: req.user.id });
  res.status(201).json({ id });
});

// Customers may cancel only while the order is still Pending
r.post('/orders/:id/cancel', (req, res) => {
  const so = ownOrder(req);
  if (so.status !== 'Pending') throw new HttpError(400, 'This order is already being processed. Please contact us to cancel.');
  changeSalesStatus(so.id, 'Cancelled', { userId: req.user.id, note: 'Cancelled by customer' });
  res.json({ ok: true });
});

export default r;
