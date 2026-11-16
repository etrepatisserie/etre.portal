// Stock is kept per outlet (product_stock). available = on hand − on hold.
import db from './db.js';
import { HttpError } from './errors.js';
import { notifyAdmins } from './notify.js';

// All stock rows; outletId null = every outlet (each row says which outlet)
export async function stockRows(outletId = null, where = '1=1', params = []) {
  return await db.prepare(`
    SELECT p.id, p.sku, p.name, p.category, p.category_code, p.size, p.uom, p.unit_cost, p.sell_price, p.moq,
           p.is_sellable, p.is_available, p.image_file_id,
           ps.outlet_id, o.code AS outlet_code, o.name AS outlet_name,
           ps.stock_on_hand, ps.reorder_level,
           COALESCE(h.qty, 0) AS on_hold,
           ps.stock_on_hand - COALESCE(h.qty, 0) AS available,
           CASE WHEN ps.stock_on_hand - COALESCE(h.qty, 0) <= 0 THEN 'Out'
                WHEN ps.stock_on_hand - COALESCE(h.qty, 0) <= ps.reorder_level THEN 'Low'
                ELSE 'OK' END AS stock_status
    FROM product_stock ps
    JOIN products p ON p.id = ps.product_id
    JOIN outlets o ON o.id = ps.outlet_id
    LEFT JOIN (SELECT product_id, outlet_id, SUM(qty) AS qty FROM stock_holds WHERE status = 'Active' GROUP BY product_id, outlet_id) h
           ON h.product_id = ps.product_id AND h.outlet_id = ps.outlet_id
    WHERE (? IS NULL OR ps.outlet_id = ?) AND ${where}
    ORDER BY p.is_sellable DESC, p.category, p.sku, o.id`).all(outletId, outletId, ...params);
}

export const getStock = async (productId, outletId) => (await stockRows(outletId, 'p.id = ?', [productId]))[0];

// Change physical stock in one outlet and write a movement record. qty is signed.
export async function moveStock(productId, outletId, type, qty, { reason, ref, userId, at } = {}) {
  if (!outletId) throw new HttpError(400, 'Choose an outlet for this stock change');
  await db.prepare('INSERT IGNORE INTO product_stock (product_id, outlet_id) VALUES (?, ?)').run(productId, outletId);
  const s = await db.prepare('SELECT ps.stock_on_hand, p.name FROM product_stock ps JOIN products p ON p.id = ps.product_id WHERE ps.product_id = ? AND ps.outlet_id = ?').get(productId, outletId);
  if (!s) throw new HttpError(404, 'Product not found');
  const balance = s.stock_on_hand + qty;
  if (balance < 0) throw new HttpError(400, `Not enough stock for ${s.name} (on hand ${s.stock_on_hand}, need ${-qty}). Record production in the Central Kitchen portal first.`);
  await db.prepare('UPDATE product_stock SET stock_on_hand = ? WHERE product_id = ? AND outlet_id = ?').run(balance, productId, outletId);
  await db.prepare(`INSERT INTO stock_movements (product_id, outlet_id, type, qty, balance_after, reason, ref, user_id, created_at)
              VALUES (?,?,?,?,?,?,?,?, COALESCE(?, NOW()))`)
    .run(productId, outletId, type, qty, balance, reason || null, ref || null, userId || null, at || null);
  await checkLowStock(productId, outletId);
  return balance;
}

// Notify that outlet's admins once when an ingredient drops to/below its reorder level (until read)
export async function checkLowStock(productId, outletId) {
  const s = await getStock(productId, outletId);
  // finished goods are made to order, so only ingredients & packaging raise low-stock alerts
  if (!s || s.is_sellable || s.stock_status === 'OK') return;
  const link = `/admin/stock?focus=${productId}&outlet=${outletId}`;
  const open = await db.prepare("SELECT 1 FROM notifications WHERE type = 'low_stock' AND link = ? AND is_read = 0").get(link);
  if (open) return;
  await notifyAdmins(outletId, 'low_stock',
    `${s.outlet_code}: ${s.stock_status === 'Out' ? 'Out of stock' : 'Low stock'} — ${s.name}`,
    `${s.available} ${s.uom} available (reorder level ${s.reorder_level})`, link);
}
