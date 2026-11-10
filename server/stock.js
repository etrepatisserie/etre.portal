import db from './db.js';
import { HttpError } from './errors.js';
import { notifyAdmins } from './notify.js';

// available = on hand - on hold
export const STOCK_SQL = `
  SELECT p.*,
         COALESCE(h.qty, 0) AS on_hold,
         p.stock_on_hand - COALESCE(h.qty, 0) AS available,
         CASE WHEN p.stock_on_hand - COALESCE(h.qty, 0) <= 0 THEN 'Out'
              WHEN p.stock_on_hand - COALESCE(h.qty, 0) <= p.reorder_level THEN 'Low'
              ELSE 'OK' END AS stock_status
  FROM products p
  LEFT JOIN (SELECT product_id, SUM(qty) AS qty FROM stock_holds WHERE status = 'Active' GROUP BY product_id) h
         ON h.product_id = p.id`;

export const getStock = (productId) => db.prepare(`${STOCK_SQL} WHERE p.id = ?`).get(productId);

// Change physical stock and write a movement record. qty is signed.
export function moveStock(productId, type, qty, { reason, ref, userId, at } = {}) {
  const p = db.prepare('SELECT stock_on_hand, name FROM products WHERE id = ?').get(productId);
  if (!p) throw new HttpError(404, 'Product not found');
  const balance = p.stock_on_hand + qty;
  if (balance < 0) throw new HttpError(400, `Not enough stock for ${p.name} (on hand ${p.stock_on_hand})`);
  db.prepare('UPDATE products SET stock_on_hand = ? WHERE id = ?').run(balance, productId);
  db.prepare(`INSERT INTO stock_movements (product_id, type, qty, balance_after, reason, ref, user_id, created_at)
              VALUES (?,?,?,?,?,?,?, COALESCE(?, datetime('now')))`)
    .run(productId, type, qty, balance, reason || null, ref || null, userId || null, at || null);
  checkLowStock(productId);
  return balance;
}

// Notify admins once when a product drops to/below its reorder level (until they read it)
export function checkLowStock(productId) {
  const s = getStock(productId);
  if (!s || s.stock_status === 'OK') return;
  const link = `/admin/stock?focus=${productId}`;
  const open = db.prepare("SELECT 1 FROM notifications WHERE type = 'low_stock' AND link = ? AND is_read = 0").get(link);
  if (open) return;
  notifyAdmins('low_stock',
    s.stock_status === 'Out' ? `Out of stock: ${s.name}` : `Low stock: ${s.name}`,
    `${s.available} ${s.uom} available (reorder level ${s.reorder_level})`, link);
}
