// Sales order workflow (order-to-cash):
//   Pending ("Awaiting approval": placed by a customer; Admin approves, adjusts or rejects)
//   → Confirmed (approved: goes to the outlet's kitchen; Finance is alerted to invoice)
//   → Processing (kitchen printed the sheet and started) → Ready for Pickup / Out for Delivery (Admin) → Received (customer)
// Phone orders by Admin and replacement orders are approved on entry. A rejected order is Cancelled + rejected_*.
// The invoice + payment is a separate track (invoices.payment_status), it does not hold up production.
// COD customers attach their payment slip when placing the order. Blocked customers can order only under a
// Finance override (overrides.js). Add-on orders link to an earlier open order (addon_of).
// Cancelled: customer until Admin approves; Admin until dispatch (voids any invoice).
import crypto from 'node:crypto';
import db from './db.js';
import { HttpError, fmtMoney } from './errors.js';
import { round2, computeTotals, linesSubtotal } from './pricing.js';
import { getSettings } from './settings.js';
import { orderWindow, productionDateFor, todayMYT, nearestDates } from './schedule.js';
import { audit, auditFor } from './audit.js';
import { activeOverride, useOverride } from './overrides.js';
import { moveStock } from './stock.js';
import { notifyRole, notifyCustomer } from './notify.js';
import { queueEmail } from './email.js';
import { getOutlet } from './outlets.js';
import { isCredit } from './terms.js';

export const STATUSES = ['Confirmed', 'Processing', 'Ready for Pickup', 'Out for Delivery', 'Received', 'Cancelled'];
export const OPEN_STATUSES = ['Confirmed', 'Processing', 'Ready for Pickup', 'Out for Delivery'];
const NOT_STARTED = ['Pending', 'Confirmed', 'Invoiced']; // kitchen hasn't started yet (legacy statuses included)
export const KITCHEN_STATUSES = ['Confirmed', 'Invoiced', 'Processing', 'Ready for Pickup', 'Out for Delivery', 'Received'];
export const DELIVERY_PROVIDERS = ['GoGet', 'Lalamove', 'Other'];

export const EVENT_TEXT = {
  Pending: 'Order placed — waiting for our team to approve it',
  Approved: 'Approved — sent to our kitchen',
  Confirmed: 'Order placed — sent to our kitchen',
  Processing: 'Our kitchen is preparing your order',
  'Ready for Pickup': 'Ready for pickup',
  'Out for Delivery': 'Out for delivery',
  Received: 'Received by customer',
  Cancelled: 'Order cancelled',
};

export const addEvent = (soId, status, note, userId = null) =>
  db.prepare('INSERT INTO delivery_events (so_id, status, note, user_id) VALUES (?,?,?,?)').run(soId, status, note, userId);

export function nextNumber(table, column, prefix) {
  const last = db.prepare(`SELECT ${column} AS n FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`).get(`${prefix}%`);
  return prefix + String(last ? parseInt(last.n.slice(prefix.length), 10) + 1 : 1).padStart(4, '0');
}

const customerEmail = (customerId) => {
  const c = db.prepare('SELECT email FROM customers WHERE id = ?').get(customerId);
  return c?.email || db.prepare('SELECT email FROM users WHERE customer_id = ? LIMIT 1').get(customerId)?.email;
};

// ---------- reading ----------
export function getOrder(soId) {
  const so = db.prepare(`
    SELECT so.*, c.name AS customer_name, c.code AS customer_code, c.email AS customer_email,
           c.phone AS customer_phone, c.contact AS customer_contact, c.payment_term,
           o.code AS outlet_code, o.name AS outlet_name
    FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN outlets o ON o.id = so.outlet_id WHERE so.id = ?`).get(soId);
  if (!so) return null;
  so.lines = db.prepare(`SELECT l.*, p.sku, p.uom, p.size, p.moq FROM sales_order_lines l JOIN products p ON p.id = l.product_id WHERE l.so_id = ? ORDER BY l.id`).all(soId);
  so.events = db.prepare('SELECT e.*, u.name AS user_name, u.role AS user_role FROM delivery_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.so_id = ? ORDER BY e.created_at, e.id').all(soId);
  so.audit = auditFor('sales_order', soId);
  so.addon_of_number = so.addon_of ? db.prepare('SELECT so_number FROM sales_orders WHERE id = ?').get(so.addon_of)?.so_number : null;
  so.addons = db.prepare('SELECT id, so_number, status, fulfil_date FROM sales_orders WHERE addon_of = ? ORDER BY id').all(soId);
  // quantities changed by Admin after the order was approved (the kitchen highlights these)
  so.changed_after_approval = !!(so.confirmed_at && db.prepare('SELECT 1 FROM order_adjustments WHERE so_id = ? AND created_at > ?').get(soId, so.confirmed_at));
  so.override = db.prepare('SELECT id, reason, expires_on, single_order FROM block_overrides WHERE used_so_id = ?').get(soId) || null;
  so.adjustments = db.prepare(`SELECT a.*, u.name AS user_name FROM order_adjustments a LEFT JOIN users u ON u.id = a.user_id WHERE a.so_id = ? ORDER BY a.id`).all(soId)
    .map((a) => ({ ...a, totals_before: JSON.parse(a.totals_before || 'null'), totals_after: JSON.parse(a.totals_after || 'null') }));
  so.discrepancies = db.prepare(`SELECT d.*, r.so_number AS replacement_so_number FROM discrepancies d LEFT JOIN sales_orders r ON r.id = d.replacement_so_id
                                  WHERE d.so_id = ? ORDER BY d.id`).all(soId);
  so.credit_notes = db.prepare('SELECT id, cn_number, status, total, issue_date, discrepancy_id FROM credit_notes WHERE so_id = ? ORDER BY id').all(soId);
  so.replacement_for_number = so.replacement_for ? db.prepare('SELECT so_number FROM sales_orders WHERE id = ?').get(so.replacement_for)?.so_number : null;
  so.invoice = db.prepare(`SELECT id, inv_number, do_number, issue_date, due_date, total, payment_status, source, void, paid_at, external_number, issue_method, do_source, do_date, outlet_id
                           FROM invoices WHERE so_id = ? AND void = 0`).get(soId) || null;
  // COD slip sent with the order (before an invoice existed)
  so.order_slip = db.prepare('SELECT id, file_id, status, amount, reject_reason, created_at FROM payment_slips WHERE so_id = ? ORDER BY id DESC LIMIT 1').get(soId) || null;
  return so;
}

// Central Kitchen must never receive prices, invoices or payment data: whitelist every field.
export function kitchenView(so) {
  return {
    id: so.id, so_number: so.so_number,
    customer_name: so.customer_name, customer_code: so.customer_code, customer_phone: so.customer_phone,
    order_date: so.order_date, production_date: so.production_date,
    fulfil_date: so.fulfil_date, time_slot: so.time_slot, method: so.method,
    delivery_address: so.method === 'delivery' ? so.delivery_address : null,
    notes: so.notes,
    status: so.status === 'Invoiced' ? 'Confirmed' : so.status,
    can_start: NOT_STARTED.includes(so.status),
    printed_at: so.printed_at,
    completed_at: so.completed_at || null,
    addon_of_number: so.addon_of_number || null,
    changed_after_approval: !!so.changed_after_approval,
    lines: (so.lines || []).filter((l) => l.quantity > 0).map((l) => ({ id: l.id, sku: l.sku, description: l.description, quantity: l.quantity, uom: l.uom, size: l.size })),
  };
}

// ---------- order block ----------
// COD: any invoice not yet verified as Paid blocks new orders ("Slip Uploaded" still counts).
// Credit terms (14 / 15 / 30 days): only invoices past their due date block.
export function blockingInvoices(customerId, now = new Date()) {
  const c = db.prepare('SELECT payment_term FROM customers WHERE id = ?').get(customerId);
  const today = todayMYT(now);
  const rows = db.prepare(`SELECT i.id, i.inv_number, ROUND(i.total - COALESCE((SELECT SUM(cn.total) FROM credit_notes cn WHERE cn.invoice_id = i.id AND cn.status = 'Issued'), 0), 2) AS total, i.total AS invoice_total, i.due_date, i.payment_status, so.so_number
                           FROM invoices i JOIN sales_orders so ON so.id = i.so_id
                           WHERE i.customer_id = ? AND i.void = 0 AND i.payment_status <> 'Paid' ORDER BY i.issue_date, i.id`).all(customerId);
  return isCredit(c?.payment_term) ? rows.filter((r) => r.due_date < today) : rows;
}

// The customer's registered business address (delivery address on file, else billing address)
export const registeredAddress = (c) => String(c.address || c.billing_address || '').trim();
const norm = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- create ----------
// slipFileId: required for COD customers ordering in the portal (byStaff orders are exempt)
export function createOrder({ customerId, lines, method, fulfilDate, timeSlot, areaConfirmed, deliveryAddress, notes, userId, slipFileId = null, slipReference = null, byStaff = false, addonOf = null, now = new Date() }) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) throw new HttpError(400, 'Customer is required');

  // payment block: lifts when Finance verifies the payment, or while Finance has granted an override
  const block = blockingInvoices(customerId, now);
  const override = block.length ? activeOverride(customerId, now) : null;
  if (block.length && !override) {
    const sum = round2(block.reduce((a, b) => a + b.total, 0));
    throw new HttpError(409, `New orders are on hold until outstanding invoices are paid: ${block.map((b) => `${b.inv_number} (${fmtMoney(b.total)})`).join(', ')} — total ${fmtMoney(sum)}.`, { blocked: true, invoices: block });
  }
  // add-on to an earlier open order of the same customer (its own number, approval, invoice and DO)
  let addon = null;
  if (addonOf) {
    addon = db.prepare('SELECT id, so_number, customer_id, status FROM sales_orders WHERE id = ?').get(Number(addonOf));
    if (!addon || addon.customer_id !== customerId) throw new HttpError(400, 'The order this adds to was not found');
    if (['Received', 'Cancelled'].includes(addon.status)) throw new HttpError(400, `${addon.so_number} is ${addon.status.toLowerCase()} — an add-on must link to an open order`);
  }
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpError(400, 'Add at least one product');

  const s = getSettings();
  const outlet = getOutlet(customer.outlet_id); // the customer's home outlet: its kitchen, slots, area, closures
  if (!['pickup', 'delivery'].includes(method)) throw new HttpError(400, 'Choose pickup or delivery');
  const slots = method === 'pickup' ? outlet.pickup_slots : outlet.delivery_slots;
  if (!slots.includes(timeSlot)) throw new HttpError(400, 'Choose a time slot');
  // Delivery goes to the registered business address unless the order gives a different one.
  // The registered address is on file for this outlet's area, so only a different address needs the area check.
  const registered = registeredAddress(customer);
  const other = String(deliveryAddress || '').trim();
  const useOther = method === 'delivery' && other && norm(other) !== norm(registered);
  const shipTo = method === 'delivery' ? (useOther ? other : registered) : null;
  if (method === 'delivery') {
    if (!shipTo) throw new HttpError(400, 'Delivery address is required — no registered business address on file');
    if (useOther && !areaConfirmed) throw new HttpError(400, `Please confirm the delivery address is within ${outlet.delivery_area}`);
  }
  const win = orderWindow(now, { outletId: outlet.id, method });
  if (!win.dates.includes(fulfilDate)) {
    const closed = win.blocked_info.find((b) => b.date === fulfilDate)?.[method];
    const near = closed ? ` Nearest available: ${nearestDates(fulfilDate, win.dates).join(', ')}.` : '';
    throw new HttpError(400, closed ? `${fulfilDate} is closed for ${method}: ${closed}.${near}` : `${fulfilDate || 'That date'} is not available for this order. ${win.explanation.slice(0, 3).join(' ')}`);
  }
  if (customer.payment_term === 'COD' && !byStaff && !slipFileId) {
    throw new HttpError(400, 'COD orders need the payment slip: transfer the total, then attach the slip before placing the order.');
  }

  const qtyByProduct = new Map();
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, 'Quantities must be whole numbers greater than 0');
    qtyByProduct.set(Number(l.product_id), (qtyByProduct.get(Number(l.product_id)) || 0) + qty);
  }

  const { soId, soNumber, t } = db.transaction(() => {
    const items = [...qtyByProduct].map(([productId, qty]) => {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (!p) throw new HttpError(400, 'Unknown product');
      if (!p.is_sellable) throw new HttpError(400, `"${p.name}" is not available for sale`);
      if (!p.is_available) throw new HttpError(400, `"${p.name}" is currently unavailable`);
      if (qty < p.moq) throw new HttpError(400, `Minimum order for "${p.name}" is ${p.moq} ${p.uom}`);
      return { product_id: p.id, description: p.name, quantity: qty, unit_price: p.sell_price, line_total: round2(qty * p.sell_price) };
    });
    const totals = computeTotals(linesSubtotal(items), method, s);
    const number = nextNumber('sales_orders', 'so_number', `SO-${outlet.code}-${todayMYT(now).slice(0, 4)}-`);
    const id = db.prepare(`
      INSERT INTO sales_orders (so_number, customer_id, outlet_id, order_date, processing_day, production_date, fulfil_date, method, time_slot,
        delivery_address, area_confirmed, notes, status, subtotal, delivery_fee, sst_rate, sst_amount, total, confirmed_at, confirmed_by, created_by, addon_of)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${byStaff ? "datetime('now')" : 'NULL'}, ?, ?, ?)`)
      .run(number, customerId, outlet.id, win.processing_day, productionDateFor(fulfilDate), fulfilDate, method, timeSlot,
        shipTo, method === 'delivery' ? 1 : 0, notes || null, byStaff ? 'Confirmed' : 'Pending',
        totals.subtotal, totals.delivery_fee, totals.sst_rate, totals.sst_amount, totals.total, byStaff ? userId || null : null, userId || null, addon?.id ?? null).lastInsertRowid;
    const ins = db.prepare('INSERT INTO sales_order_lines (so_id, product_id, description, original_quantity, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?,?)');
    for (const i of items) ins.run(id, i.product_id, i.description, i.quantity, i.quantity, i.unit_price, i.line_total);
    if (byStaff) addEvent(id, 'Confirmed', 'Order entered by our team — approved and sent to our kitchen', userId);
    else addEvent(id, 'Pending', EVENT_TEXT.Pending, userId);
    if (addon) addEvent(id, byStaff ? 'Confirmed' : 'Pending', `Add-on to ${addon.so_number}`, userId);
    if (override) {
      useOverride(override, id);
      addEvent(id, byStaff ? 'Confirmed' : 'Pending', `Placed under a Finance override: ${override.reason}`, userId);
    }
    audit({ entity: 'sales_order', entityId: id, action: 'placed', userId, outletId: outlet.id,
      after: { status: byStaff ? 'Confirmed' : 'Pending', total: totals.total, fulfil_date: fulfilDate, method, addon_of: addon?.so_number || null, override: override?.id || null } });
    if (slipFileId) {
      db.prepare("INSERT INTO payment_slips (customer_id, so_id, file_id, reference, amount, status, uploaded_by) VALUES (?,?,?,?,?, 'Pending', ?)")
        .run(customerId, id, slipFileId, slipReference ? String(slipReference).slice(0, 100) : null, totals.total, userId || null);
      addEvent(id, byStaff ? 'Confirmed' : 'Pending', 'Payment slip received with the order', userId);
    }
    return { soId: id, soNumber: number, t: totals };
  })();

  const what = `${method === 'pickup' ? 'Pickup' : 'Delivery'} ${fulfilDate}`;
  if (byStaff) { releaseToKitchen(getOrder(soId)); return soId; }
  // customer order: Admin reviews it first — kitchen and Finance hear about it only once it is approved
  notifyCustomer(customerId, 'order_status', `Order ${soNumber} received`, `${what}. Our team will review and approve it shortly.`, `/portal/orders/${soId}`);
  notifyRole('admin', outlet.id, 'new_order', `Approve order ${soNumber}`, `${customer.name} · ${fmtMoney(t.total)} · ${what}${addon ? ` · add-on to ${addon.so_number}` : ''}${slipFileId ? ' · COD slip attached' : ''}`, `/admin/sales/${soId}`);
  return soId;
}

// An approved order goes to the outlet's kitchen; Finance is asked to invoice it; the customer gets the confirmation
function releaseToKitchen(so) {
  const what = `${so.method === 'pickup' ? 'Pickup' : 'Delivery'} ${so.fulfil_date}`;
  notifyRole('kitchen', so.outlet_id, 'production', `New order ${so.so_number}`, `${so.customer_name} · make on ${so.production_date} · ${what}`, `/kitchen/orders/${so.id}`);
  notifyRole('finance', so.outlet_id, 'to_invoice', `Issue invoice: ${so.so_number}`, `${so.customer_name} · ${fmtMoney(so.total)}${so.order_slip ? ' · COD slip attached' : ''}`, `/finance/invoices/new/${so.id}`);
  queueEmail({ to: customerEmail(so.customer_id), template: 'order_confirmed', data: { order: so }, related: { type: 'sales_order', id: so.id } });
}

// ---------- admin approval ----------
// Every customer order starts as 'Pending' (shown as "Awaiting approval"). Admin approves → kitchen + Finance,
// or rejects with a reason → the customer sees it; Finance is told to refund a COD slip that came with it.
export function approveOrder(soId, { userId }) {
  const so = getOrder(soId);
  if (!so) throw new HttpError(404, 'Order not found');
  if (so.status !== 'Pending') throw new HttpError(400, `Only orders awaiting approval can be approved (this one is ${so.status})`);
  if (!so.lines.some((l) => l.quantity > 0)) throw new HttpError(400, 'Every item is at 0 — reject the order instead');
  // The payment block is checked again here. A blocked customer's order can be approved only under a Finance
  // override (the one in force now, or the single-order override this order was placed under).
  const blocked = blockingInvoices(so.customer_id);
  const override = blocked.length ? (activeOverride(so.customer_id) || so.override) : null;
  if (blocked.length && !override) {
    throw new HttpError(409, `${so.customer_name} is on hold until payment is verified: ${blocked.map((b) => `${b.inv_number} (${fmtMoney(b.total)})`).join(', ')}. Approve once Finance has verified it or granted an override, or reject the order.`, { blocked: true, invoices: blocked });
  }
  db.transaction(() => {
    db.prepare("UPDATE sales_orders SET status='Confirmed', confirmed_at=datetime('now'), confirmed_by=?, updated_at=datetime('now') WHERE id=?").run(userId, soId);
    addEvent(soId, 'Confirmed', override ? `${EVENT_TEXT.Approved} (under a Finance override: ${override.reason})` : EVENT_TEXT.Approved, userId);
  })();
  audit({ entity: 'sales_order', entityId: soId, action: 'approved', userId, outletId: so.outlet_id, before: { status: 'Pending' }, after: { status: 'Confirmed' }, note: override ? `override #${override.id}` : null });
  const fresh = getOrder(soId);
  notifyCustomer(so.customer_id, 'order_status', `Order ${so.so_number} approved`, `${EVENT_TEXT.Approved}.`, `/portal/orders/${soId}`);
  releaseToKitchen(fresh);
  return fresh;
}

export function rejectOrder(soId, { userId, reason }) {
  const so = getOrder(soId);
  if (!so) throw new HttpError(404, 'Order not found');
  if (so.status !== 'Pending') throw new HttpError(400, `Only orders awaiting approval can be rejected (this one is ${so.status}) — cancel it instead`);
  const why = String(reason || '').trim();
  if (!why) throw new HttpError(400, 'Give the reason — the customer will see it');
  db.transaction(() => {
    db.prepare(`UPDATE sales_orders SET status='Cancelled', cancel_reason=?, rejected_at=datetime('now'), rejected_by=?, reject_reason=?, updated_at=datetime('now') WHERE id=?`)
      .run(`Rejected: ${why}`, userId, why.slice(0, 500), soId);
    addEvent(soId, 'Rejected', `Not approved: ${why}`, userId);
  })();
  audit({ entity: 'sales_order', entityId: soId, action: 'rejected', userId, outletId: so.outlet_id, before: { status: 'Pending' }, after: { status: 'Rejected', reason: why } });
  notifyCustomer(so.customer_id, 'order_status', `Order ${so.so_number} not approved`, why, `/portal/orders/${soId}`);
  if (so.order_slip) notifyRole('finance', so.outlet_id, 'slip', `Refund needed: ${so.so_number} rejected`, `${so.customer_name} attached a COD payment slip (${fmtMoney(so.total)}). Reject the slip and arrange a refund if it was paid.`, '/finance/payments');
  return getOrder(soId);
}

// ---------- totals ----------
function recalc(soId) {
  const so = db.prepare('SELECT method FROM sales_orders WHERE id = ?').get(soId);
  const lines = db.prepare('SELECT quantity, unit_price FROM sales_order_lines WHERE so_id = ? AND quantity > 0').all(soId);
  const t = computeTotals(linesSubtotal(lines), so.method);
  db.prepare("UPDATE sales_orders SET subtotal=?, delivery_fee=?, sst_rate=?, sst_amount=?, total=?, updated_at=datetime('now') WHERE id=?")
    .run(t.subtotal, t.delivery_fee, t.sst_rate, t.sst_amount, t.total, soId);
  return t;
}

const pickTotals = (o) => ({ subtotal: o.subtotal, delivery_fee: o.delivery_fee, sst_rate: o.sst_rate, sst_amount: o.sst_amount, total: o.total });

// ---------- admin: reduce quantities (before the kitchen starts) ----------
// If an unpaid, system-generated invoice exists it is updated (PDFs regenerate on next download).
export function adjustOrder(soId, changes, { userId }) {
  const so = getOrder(soId);
  if (!so) throw new HttpError(404, 'Order not found');
  if (!NOT_STARTED.includes(so.status)) throw new HttpError(400, 'Quantities can only be changed before the kitchen starts production');
  if (so.invoice && (so.invoice.payment_status === 'Paid' || so.invoice.source === 'uploaded')) {
    throw new HttpError(400, `Invoice ${so.invoice.inv_number} is ${so.invoice.payment_status === 'Paid' ? 'already paid' : 'an uploaded file'} — ask Finance before changing quantities`);
  }
  if (!Array.isArray(changes) || !changes.length) throw new HttpError(400, 'No changes given');

  const real = [];
  for (const c of changes) {
    const line = so.lines.find((l) => l.id === Number(c.line_id));
    if (!line) throw new HttpError(400, 'Unknown order line');
    const q = Number(c.quantity);
    if (!Number.isInteger(q) || q < 0) throw new HttpError(400, 'Quantities must be whole numbers (0 removes the item)');
    if (q > line.quantity) throw new HttpError(400, `Adjustments can only reduce quantities (${line.description})`);
    if (q === line.quantity) continue;
    if (!String(c.reason || '').trim()) throw new HttpError(400, `Give a reason for changing ${line.description}`);
    real.push({ line, q, reason: String(c.reason).trim() });
  }
  if (!real.length) throw new HttpError(400, 'Nothing changed');
  const remaining = so.lines.filter((l) => (real.find((r) => r.line.id === l.id)?.q ?? l.quantity) > 0);
  if (!remaining.length) throw new HttpError(400, 'All items would be removed — cancel the order instead');

  const batch = crypto.randomBytes(6).toString('hex');
  const before = pickTotals(so);
  const after = db.transaction(() => {
    const upd = db.prepare('UPDATE sales_order_lines SET quantity = ?, line_total = ? WHERE id = ?');
    for (const r of real) upd.run(r.q, round2(r.q * r.line.unit_price), r.line.id);
    const t = recalc(soId);
    const ins = db.prepare(`INSERT INTO order_adjustments (so_id, batch, line_id, product_name, old_qty, new_qty, reason, totals_before, totals_after, user_id)
                            VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const r of real) ins.run(soId, batch, r.line.id, r.line.description, r.line.quantity, r.q, r.reason, JSON.stringify(before), JSON.stringify(t), userId);
    if (so.invoice) {
      db.prepare('UPDATE invoices SET subtotal=?, delivery_fee=?, sst_rate=?, sst_amount=?, total=?, invoice_file_id=NULL, do_file_id=NULL WHERE id=?')
        .run(t.subtotal, t.delivery_fee, t.sst_rate, t.sst_amount, t.total, so.invoice.id);
    }
    addEvent(soId, so.status, `Quantities adjusted: ${real.map((r) => `${r.line.description} ${r.line.quantity}→${r.q}`).join(', ')}`, userId);
    return t;
  })();
  audit({ entity: 'sales_order', entityId: soId, action: 'adjusted', userId, outletId: so.outlet_id,
    before: { lines: real.map((r) => ({ product: r.line.description, qty: r.line.quantity })), total: before.total },
    after: { lines: real.map((r) => ({ product: r.line.description, qty: r.q, reason: r.reason })), total: after.total }, note: so.status === 'Pending' ? 'before approval' : 'after approval' });

  const fresh = getOrder(soId);
  const list = real.map((r) => ({ product_name: r.line.description, old_qty: r.line.quantity, new_qty: r.q, reason: r.reason }));
  notifyCustomer(so.customer_id, 'order_status', `Order ${so.so_number} adjusted`, `${list.length} item(s) changed due to availability. New total ${fmtMoney(after.total)}.`, `/portal/orders/${soId}`);
  if (so.status !== 'Pending') notifyRole('kitchen', so.outlet_id, 'production', `${so.so_number} quantities changed`, list.map((l) => `${l.product_name} ${l.old_qty}→${l.new_qty}`).join(', '), `/kitchen/orders/${soId}`);
  if (so.invoice || so.order_slip) {
    notifyRole('finance', so.outlet_id, 'to_invoice', `${so.so_number} total changed to ${fmtMoney(after.total)}`,
      `${so.invoice ? `Invoice ${so.invoice.inv_number} updated.` : 'Not invoiced yet.'}${so.order_slip ? ` COD slip was for ${fmtMoney(so.order_slip.amount)}.` : ''}`, `/finance/invoices/new/${soId}`);
  }
  queueEmail({ to: customerEmail(so.customer_id), template: 'quantity_adjusted', data: { order: fresh, changes: list, before, after }, related: { type: 'sales_order', id: soId } });
  return after;
}

// ---------- cancel ----------
export function cancelOrder(soId, { user, reason }) {
  const so = getOrder(soId);
  if (!so || (user.role === 'customer' && so.customer_id !== user.customer_id)) throw new HttpError(404, 'Order not found');
  if (user.role === 'customer' && so.status !== 'Pending') {
    throw new HttpError(400, 'This order has been approved, so it can no longer be cancelled online. Please contact us.');
  }
  if (user.role === 'admin' && ![...NOT_STARTED, 'Processing'].includes(so.status)) {
    throw new HttpError(400, `Orders that are ${so.status} can no longer be cancelled`);
  }
  if (!['customer', 'admin'].includes(user.role)) throw new HttpError(403, 'Not allowed');
  const note = user.role === 'customer' ? 'Cancelled by customer' : `Cancelled by our team${reason ? `: ${reason}` : ''}`;
  db.transaction(() => {
    db.prepare("UPDATE sales_orders SET status='Cancelled', cancel_reason=?, updated_at=datetime('now') WHERE id=?").run(reason || note, soId);
    if (so.invoice) db.prepare('UPDATE invoices SET void = 1 WHERE id = ?').run(so.invoice.id);
    addEvent(soId, 'Cancelled', note, user.id);
  })();
  audit({ entity: 'sales_order', entityId: soId, action: 'cancelled', userId: user.id, outletId: so.outlet_id, before: { status: so.status }, after: { status: 'Cancelled', reason: reason || note } });
  if (user.role === 'customer') notifyRole('admin', so.outlet_id, 'order_status', `Order ${so.so_number} cancelled by customer`, so.customer_name, `/admin/sales/${soId}`);
  else notifyCustomer(so.customer_id, 'order_status', `Order ${so.so_number}: Cancelled`, note, `/portal/orders/${soId}`);
  if (so.status !== 'Pending') notifyRole('kitchen', so.outlet_id, 'production', `Order ${so.so_number} cancelled`, 'Remove it from the production plan.', '/kitchen/orders');
  if (so.invoice || so.order_slip) {
    notifyRole('finance', so.outlet_id, 'to_invoice', `Order ${so.so_number} cancelled`,
      `${so.invoice ? `${so.invoice.inv_number} has been voided. ` : ''}${so.order_slip ? 'A COD payment slip was attached — arrange a refund if it was paid.' : ''}`, '/finance/payments');
  }
}

// ---------- kitchen ----------
export function markPrinted(soId) {
  const so = db.prepare('SELECT status FROM sales_orders WHERE id = ?').get(soId);
  if (!so || !KITCHEN_STATUSES.includes(so.status)) throw new HttpError(404, 'Order not found');
  db.prepare("UPDATE sales_orders SET printed_at = datetime('now') WHERE id = ?").run(soId);
}

export function markProcessing(soId) {
  const so = getOrder(soId);
  if (!so || !KITCHEN_STATUSES.includes(so.status)) throw new HttpError(404, 'Order not found');
  if (!NOT_STARTED.includes(so.status)) throw new HttpError(400, `Order is already ${so.status}`);
  if (!so.printed_at) throw new HttpError(400, 'Print the production sheet first');
  db.transaction(() => {
    db.prepare("UPDATE sales_orders SET status='Processing', updated_at=datetime('now') WHERE id=?").run(soId);
    addEvent(soId, 'Processing', EVENT_TEXT.Processing);
  })();
  notifyCustomer(so.customer_id, 'order_status', `Order ${so.so_number}: Processing`, EVENT_TEXT.Processing, `/portal/orders/${soId}`);
  notifyRole('admin', so.outlet_id, 'order_status', `${so.so_number} in production`, `${so.customer_name} · ${so.method} ${so.fulfil_date}`, `/admin/sales/${soId}`);
}

// ---------- admin: dispatch ----------
export function dispatchOrder(soId, { userId }) {
  const so = getOrder(soId);
  if (!so) throw new HttpError(404, 'Order not found');
  if (so.status !== 'Processing') throw new HttpError(400, 'Only orders in production can be dispatched');
  const status = so.method === 'pickup' ? 'Ready for Pickup' : 'Out for Delivery';
  db.transaction(() => {
    for (const l of so.lines.filter((x) => x.quantity > 0)) {
      moveStock(l.product_id, so.outlet_id, 'sale', -l.quantity, { reason: status, ref: so.so_number, userId });
    }
    db.prepare("UPDATE sales_orders SET status=?, updated_at=datetime('now') WHERE id=?").run(status, soId);
    addEvent(soId, status, status === 'Ready for Pickup' ? `Ready for pickup at our outlet${so.time_slot ? ` (${so.time_slot})` : ''}` : EVENT_TEXT[status], userId);
  })();
  audit({ entity: 'sales_order', entityId: soId, action: 'dispatched', userId, outletId: so.outlet_id, before: { status: so.status }, after: { status } });
  const msg = so.method === 'pickup' ? `Please collect on ${so.fulfil_date}${so.time_slot ? `, ${so.time_slot}` : ''}.` : 'Your order is on the way.';
  notifyCustomer(so.customer_id, 'order_status', `Order ${so.so_number}: ${status}`, msg, `/portal/orders/${soId}`);
  return status;
}

export function setDeliveryLink(soId, { provider, url }) {
  const so = getOrder(soId);
  if (!so) throw new HttpError(404, 'Order not found');
  if (so.method !== 'delivery') throw new HttpError(400, 'This is a pickup order');
  if (![...NOT_STARTED, 'Processing', 'Out for Delivery'].includes(so.status)) throw new HttpError(400, `Cannot add a delivery link to a ${so.status} order`);
  if (!DELIVERY_PROVIDERS.includes(provider)) throw new HttpError(400, 'Choose GoGet, Lalamove or Other');
  let parsed;
  try { parsed = new URL(url); } catch { throw new HttpError(400, 'Enter a valid tracking link (https://…)'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new HttpError(400, 'Tracking link must start with https://');
  db.transaction(() => {
    db.prepare("UPDATE sales_orders SET delivery_provider=?, delivery_link=?, updated_at=datetime('now') WHERE id=?").run(provider, parsed.href, soId);
    addEvent(soId, so.status, `Delivery booked with ${provider} — tracking link added`);
  })();
  notifyCustomer(so.customer_id, 'delivery_link', `Track order ${so.so_number}`, `Delivery booked with ${provider}. Tap to view the tracking link.`, `/portal/orders/${soId}`);
  queueEmail({ to: customerEmail(so.customer_id), template: 'delivery_link', data: { order: getOrder(soId) }, related: { type: 'sales_order', id: soId } });
}

// ---------- customer: mark received ----------
export function receiveOrder(soId, { customerId, userId, matchesDo, discrepancies = [], fileId = null }) {
  const so = getOrder(soId);
  if (!so || so.customer_id !== customerId) throw new HttpError(404, 'Order not found');
  if (!['Ready for Pickup', 'Out for Delivery'].includes(so.status)) throw new HttpError(400, 'This order is not ready to be received yet');
  const items = (Array.isArray(discrepancies) ? discrepancies : []).filter((d) => d && (d.line_id || d.note));
  if (!matchesDo && !items.length) throw new HttpError(400, 'Tick the box confirming the items match the Delivery Order, or report a discrepancy');
  const rows = items.map((d) => {
    const line = so.lines.find((l) => l.id === Number(d.line_id));
    if (!line) throw new HttpError(400, 'Choose the item that has a problem');
    const qty = d.qty === '' || d.qty == null ? null : Number(d.qty);
    if (qty != null && (!Number.isInteger(qty) || qty < 0)) throw new HttpError(400, 'Quantity must be a whole number');
    if (!String(d.note || '').trim()) throw new HttpError(400, `Describe the problem with ${line.description}`);
    return { line, qty, note: String(d.note).trim().slice(0, 1000) };
  });
  db.transaction(() => {
    db.prepare("UPDATE sales_orders SET status='Received', received_at=datetime('now'), matches_do=?, updated_at=datetime('now') WHERE id=?").run(matchesDo ? 1 : 0, soId);
    const ins = db.prepare('INSERT INTO discrepancies (so_id, line_id, product_name, qty, note, file_id, created_by) VALUES (?,?,?,?,?,?,?)');
    for (const r of rows) ins.run(soId, r.line.id, r.line.description, r.qty, r.note, fileId, userId);
    addEvent(soId, 'Received', rows.length ? `Received — ${rows.length} discrepancy report(s)` : 'Received — items match the Delivery Order');
  })();
  if (rows.length) {
    notifyRole('admin', so.outlet_id, 'discrepancy', `Discrepancy reported: ${so.so_number}`, `${so.customer_name}: ${rows.map((r) => `${r.line.description}${r.qty != null ? ` (qty ${r.qty})` : ''}`).join(', ')}`, `/admin/sales/${soId}`);
  } else {
    notifyRole('admin', so.outlet_id, 'order_status', `${so.so_number} received`, `${so.customer_name} confirmed items match the DO`, `/admin/sales/${soId}`);
  }
}
