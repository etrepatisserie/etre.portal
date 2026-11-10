import db from './db.js';
import { HttpError, round2, fmtMoney } from './errors.js';
import { getStock, moveStock, checkLowStock } from './stock.js';
import { notifyAdmins, notifyCustomer } from './notify.js';

export const SO_FLOW = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Packed', 'Cancelled'],
  Packed: ['Shipped', 'Cancelled'],
  Shipped: ['Delivered'],
  Delivered: [],
  Cancelled: [],
};

export const EVENT_TEXT = {
  Pending: 'Order placed',
  Confirmed: 'Order confirmed by our team',
  Packed: 'Order packed and ready for dispatch',
  Shipped: 'Order shipped',
  Delivered: 'Order delivered',
  Cancelled: 'Order cancelled',
};

export function nextSoNumber() {
  const prefix = `SO-${new Date().getFullYear()}-`;
  const last = db.prepare('SELECT so_number FROM sales_orders WHERE so_number LIKE ? ORDER BY so_number DESC LIMIT 1').get(`${prefix}%`);
  return prefix + String(last ? parseInt(last.so_number.slice(prefix.length), 10) + 1 : 1).padStart(4, '0');
}

// Places an order and puts the ordered stock on hold. Prices come from the product master, not the client.
export function createSalesOrder({ customerId, lines, deliveryAddress, notes, userId }) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) throw new HttpError(400, 'Customer is required');
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpError(400, 'Add at least one product');

  // merge duplicate products
  const qtyByProduct = new Map();
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, 'Quantities must be whole numbers greater than 0');
    qtyByProduct.set(Number(l.product_id), (qtyByProduct.get(Number(l.product_id)) || 0) + qty);
  }

  return db.transaction(() => {
    const items = [...qtyByProduct].map(([productId, qty]) => {
      const s = getStock(productId);
      if (!s) throw new HttpError(400, 'Unknown product');
      if (!s.is_sellable) throw new HttpError(400, `"${s.name}" is not available for sale`);
      if (qty < s.moq) throw new HttpError(400, `Minimum order for "${s.name}" is ${s.moq} ${s.uom}`);
      if (qty > s.available) throw new HttpError(400, `Only ${Math.max(s.available, 0)} ${s.uom} of "${s.name}" available`);
      return { productId, qty, name: s.name, price: s.sell_price, total: round2(qty * s.sell_price) };
    });
    const total = round2(items.reduce((a, i) => a + i.total, 0));
    const soNumber = nextSoNumber();
    const { lastInsertRowid: soId } = db.prepare(`
      INSERT INTO sales_orders (so_number, customer_id, order_date, status, delivery_address, notes, total, created_by)
      VALUES (?, ?, datetime('now'), 'Pending', ?, ?, ?, ?)`)
      .run(soNumber, customerId, deliveryAddress || customer.address, notes || null, total, userId || null);

    const insLine = db.prepare('INSERT INTO sales_order_lines (so_id, product_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?)');
    const insHold = db.prepare("INSERT INTO stock_holds (product_id, qty, reason, customer_id, so_id, created_by) VALUES (?,?,?,?,?,?)");
    for (const i of items) {
      insLine.run(soId, i.productId, i.name, i.qty, i.price, i.total);
      insHold.run(i.productId, i.qty, `Reserved for ${soNumber}`, customerId, soId, userId || null);
    }
    db.prepare('INSERT INTO delivery_events (so_id, status, note) VALUES (?,?,?)').run(soId, 'Pending', EVENT_TEXT.Pending);

    notifyAdmins('new_order', `New order ${soNumber}`, `${customer.name} · ${fmtMoney(total)}`, `/admin/sales/${soId}`);
    notifyCustomer(customerId, 'order_status', `Order ${soNumber} received`, `We've received your order for ${fmtMoney(total)}.`, `/portal/orders/${soId}`);
    for (const i of items) checkLowStock(i.productId);
    return soId;
  })();
}

export function changeSalesStatus(soId, status, { userId, carrier, trackingNo, note } = {}) {
  const so = db.prepare('SELECT * FROM sales_orders WHERE id = ?').get(soId);
  if (!so) throw new HttpError(404, 'Order not found');
  if (!SO_FLOW[so.status].includes(status)) throw new HttpError(400, `Cannot change status from ${so.status} to ${status}`);

  db.transaction(() => {
    let eventNote = note || EVENT_TEXT[status];
    if (status === 'Shipped') {
      // stock physically leaves the warehouse: deduct on-hand and close the holds
      for (const l of db.prepare('SELECT * FROM sales_order_lines WHERE so_id = ?').all(soId)) {
        moveStock(l.product_id, 'sale', -l.quantity, { reason: 'Shipped to customer', ref: so.so_number, userId });
      }
      db.prepare("UPDATE stock_holds SET status = 'Fulfilled', released_at = datetime('now') WHERE so_id = ? AND status = 'Active'").run(soId);
      db.prepare('UPDATE sales_orders SET carrier = ?, tracking_no = ? WHERE id = ?').run(carrier || null, trackingNo || null, soId);
      if (!note) eventNote = `Shipped${carrier ? ` via ${carrier}` : ''}${trackingNo ? ` · Tracking ${trackingNo}` : ''}`;
    }
    if (status === 'Cancelled') {
      db.prepare("UPDATE stock_holds SET status = 'Released', released_at = datetime('now') WHERE so_id = ? AND status = 'Active'").run(soId);
    }
    db.prepare("UPDATE sales_orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, soId);
    db.prepare('INSERT INTO delivery_events (so_id, status, note) VALUES (?,?,?)').run(soId, status, eventNote);
    notifyCustomer(so.customer_id, 'order_status', `Order ${so.so_number}: ${status}`, eventNote, `/portal/orders/${soId}`);
  })();
}

export function getSalesOrder(soId) {
  const so = db.prepare(`
    SELECT so.*, c.name AS customer_name, c.code AS customer_code, c.email AS customer_email,
           c.phone AS customer_phone, c.contact AS customer_contact
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id WHERE so.id = ?`).get(soId);
  if (!so) return null;
  so.lines = db.prepare(`SELECT l.*, p.sku, p.uom FROM sales_order_lines l JOIN products p ON p.id = l.product_id WHERE l.so_id = ?`).all(soId);
  so.events = db.prepare('SELECT * FROM delivery_events WHERE so_id = ? ORDER BY created_at, id').all(soId);
  return so;
}
