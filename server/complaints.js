// Complaints (customer-reported discrepancies) and credit notes.
//   Admin resolves every complaint with either:
//     • a credit note request → Finance is alerted and issues it (CN-KL-2026-0001), or declines it back to Admin
//     • a replacement order   → a no-charge order straight to the outlet's kitchen (never invoiced)
//   Finance can also raise a credit note on any invoice directly.
// An issued credit note lowers what the customer owes on that invoice (balance = total − issued credit notes);
// if the invoice was already paid, the credit is a refund / offset for Finance to settle.
import db from './db.js';
import { HttpError, fmtMoney } from './errors.js';
import { round2 } from './pricing.js';
import { getSettings } from './settings.js';
import { orderWindow, productionDateFor, todayMYT } from './schedule.js';
import { getOrder, nextNumber, addEvent, registeredAddress } from './sales.js';
import { notifyRole, notifyCustomer } from './notify.js';
import { queueEmail } from './email.js';
import { getOutlet } from './outlets.js';
import { saveBuffer, getFile } from './files.js';
import { renderCreditNote } from './pdf.js';

const customerById = (id) => db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
const emailOf = (c) => c?.email || db.prepare('SELECT email FROM users WHERE customer_id = ? LIMIT 1').get(c?.id)?.email;
const invoiceOf = (soId) => db.prepare('SELECT * FROM invoices WHERE so_id = ? AND void = 0').get(soId);

// Issued credit notes already given on an invoice
export const creditedOn = (invoiceId, exceptId = 0) =>
  db.prepare("SELECT COALESCE(SUM(total),0) AS t FROM credit_notes WHERE invoice_id = ? AND status = 'Issued' AND id <> ?").get(invoiceId, exceptId).t;

function openComplaint(id) {
  const d = db.prepare('SELECT * FROM discrepancies WHERE id = ?').get(id);
  if (!d) throw new HttpError(404, 'Complaint not found');
  if (d.status !== 'Open') throw new HttpError(400, 'This complaint is already resolved');
  return d;
}

const wholeQty = (q, what) => {
  const n = Number(q);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${what}: quantity must be a whole number greater than 0`);
  return n;
};

// items: [{ line_id, qty }] → priced credit note lines (at the price on the order), capped at what's not yet credited
function buildLines(order, items, exceptId = 0) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Choose at least one item to credit');
  const already = new Map();
  for (const cn of db.prepare("SELECT lines FROM credit_notes WHERE so_id = ? AND status IN ('Requested','Issued') AND id <> ?").all(order.id, exceptId)) {
    for (const l of JSON.parse(cn.lines)) already.set(l.line_id, (already.get(l.line_id) || 0) + l.quantity);
  }
  return items.map((it) => {
    const line = order.lines.find((l) => l.id === Number(it.line_id));
    if (!line || line.quantity <= 0) throw new HttpError(400, 'That item is not on this order');
    const qty = wholeQty(it.qty, line.description);
    const left = line.quantity - (already.get(line.id) || 0);
    if (qty > left) throw new HttpError(400, `${line.description}: only ${left} of ${line.quantity} can still be credited`);
    return { line_id: line.id, sku: line.sku, description: line.description, quantity: qty, unit_price: line.unit_price, amount: round2(qty * line.unit_price) };
  });
}

function totalsFor(lines, sstRate) {
  const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const sst_amount = round2(subtotal * sstRate);
  return { subtotal, sst_rate: sstRate, sst_amount, total: round2(subtotal + sst_amount) };
}

function insertCreditNote({ order, lines, reason, discrepancyId = null, userId }) {
  const t = totalsFor(lines, order.sst_rate);
  return db.prepare(`INSERT INTO credit_notes (customer_id, outlet_id, so_id, discrepancy_id, reason, lines, subtotal, sst_rate, sst_amount, total, status, requested_by)
                     VALUES (?,?,?,?,?,?,?,?,?,?, 'Requested', ?)`)
    .run(order.customer_id, order.outlet_id, order.id, discrepancyId, reason, JSON.stringify(lines), t.subtotal, t.sst_rate, t.sst_amount, t.total, userId).lastInsertRowid;
}

const reasonText = (r, fallback) => String(r || fallback || '').trim().slice(0, 500);

// ---------- Admin: resolve a complaint with a credit note ----------
export function requestCreditNote(discrepancyId, { qty, reason, userId }) {
  const d = openComplaint(discrepancyId);
  const order = getOrder(d.so_id);
  if (order.replacement_for) throw new HttpError(400, 'This was a no-charge replacement order — offer another replacement instead');
  const lines = buildLines(order, [{ line_id: d.line_id, qty: qty ?? d.qty }]);
  const why = reasonText(reason, `${d.product_name}: ${d.note}`);
  const cnId = db.transaction(() => {
    const id = insertCreditNote({ order, lines, reason: why, discrepancyId: d.id, userId });
    db.prepare(`UPDATE discrepancies SET status='Resolved', action='credit_note', resolution=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?`)
      .run(`Credit note requested: ${lines[0].quantity} × ${lines[0].description}`, userId, d.id);
    return id;
  })();
  const cn = getCreditNote(cnId);
  notifyRole('finance', order.outlet_id, 'credit_note', `Issue credit note: ${order.so_number}`,
    `${order.customer_name} · ${lines[0].quantity} × ${lines[0].description} · ${fmtMoney(cn.total)}`, '/finance/credit-notes');
  return cn;
}

// ---------- Admin: resolve a complaint with a free replacement order ----------
export function createReplacement(discrepancyId, { qty, method, fulfilDate, timeSlot, userId }) {
  const d = openComplaint(discrepancyId);
  const orig = getOrder(d.so_id);
  const line = orig.lines.find((l) => l.id === d.line_id);
  if (!line) throw new HttpError(400, 'The item on this complaint is no longer on the order');
  const n = wholeQty(qty ?? d.qty ?? line.quantity, line.description);
  const m = method || orig.method;
  if (!['pickup', 'delivery'].includes(m)) throw new HttpError(400, 'Choose pickup or delivery');
  const outlet = getOutlet(orig.outlet_id);
  if (!(m === 'pickup' ? outlet.pickup_slots : outlet.delivery_slots).includes(timeSlot)) throw new HttpError(400, 'Choose a time slot');
  const win = orderWindow(new Date(), { outletId: outlet.id });
  if (!win.dates.includes(fulfilDate)) throw new HttpError(400, `${fulfilDate || 'That date'} is not available. ${win.explanation.slice(0, 2).join(' ')}`);
  const customer = customerById(orig.customer_id);
  const address = m === 'delivery' ? (orig.delivery_address || registeredAddress(customer)) : null;
  if (m === 'delivery' && !address) throw new HttpError(400, 'No delivery address on file — choose pickup');

  const soId = db.transaction(() => {
    const mock = orig.so_number.startsWith('MOCK-') ? 'MOCK-' : ''; // replacements of mock orders stay out of the real numbering
    const number = nextNumber('sales_orders', 'so_number', `${mock}SO-${outlet.code}-${todayMYT().slice(0, 4)}-${mock ? 'R' : ''}`);
    const id = db.prepare(`INSERT INTO sales_orders (so_number, customer_id, outlet_id, order_date, processing_day, production_date, fulfil_date, method, time_slot,
        delivery_address, area_confirmed, notes, status, subtotal, delivery_fee, sst_rate, sst_amount, total, confirmed_at, created_by, replacement_for)
      VALUES (?,?,?, datetime('now'), ?,?,?,?,?,?,?,?, 'Confirmed', 0, 0, ?, 0, 0, datetime('now'), ?, ?)`)
      .run(number, orig.customer_id, outlet.id, win.processing_day, productionDateFor(fulfilDate), fulfilDate, m, timeSlot,
        address, m === 'delivery' ? 1 : 0, `Replacement for ${orig.so_number} — no charge. Complaint: ${d.note}`.slice(0, 1000),
        getSettings().sst_rate, userId, orig.id).lastInsertRowid;
    db.prepare('INSERT INTO sales_order_lines (so_id, product_id, description, original_quantity, quantity, unit_price, line_total) VALUES (?,?,?,?,?,0,0)')
      .run(id, line.product_id, line.description, n, n);
    addEvent(id, 'Confirmed', `Replacement for ${orig.so_number} — no charge, sent to our kitchen`);
    db.prepare(`UPDATE discrepancies SET status='Resolved', action='replacement', replacement_so_id=?, resolution=?, resolved_by=?, resolved_at=datetime('now') WHERE id=?`)
      .run(id, `Replacement order ${number}: ${n} × ${line.description}`, userId, d.id);
    return id;
  })();
  const so = getOrder(soId);
  const what = `${m === 'pickup' ? 'Pickup' : 'Delivery'} ${fulfilDate}`;
  notifyCustomer(so.customer_id, 'order_status', `Replacement ${so.so_number} on its way`, `${n} × ${line.description} for ${orig.so_number}, no charge · ${what}`, `/portal/orders/${soId}`);
  notifyRole('kitchen', outlet.id, 'production', `Replacement order ${so.so_number}`, `${so.customer_name} · ${n} × ${line.description} · make on ${productionDateFor(fulfilDate)}`, `/kitchen/orders/${soId}`);
  return so;
}

// ---------- reading ----------
const CN_SELECT = `SELECT cn.*, c.name AS customer_name, c.code AS customer_code, c.payment_term, so.so_number, o.code AS outlet_code,
    COALESCE(i.inv_number, (SELECT inv_number FROM invoices x WHERE x.so_id = cn.so_id AND x.void = 0)) AS inv_number,
    COALESCE(cn.invoice_id, (SELECT id FROM invoices x WHERE x.so_id = cn.so_id AND x.void = 0)) AS current_invoice_id,
    (SELECT payment_status FROM invoices x WHERE x.so_id = cn.so_id AND x.void = 0) AS invoice_payment_status,
    ru.name AS requested_by_name, iu.name AS issued_by_name, d.note AS complaint_note, d.file_id AS complaint_file_id
  FROM credit_notes cn JOIN customers c ON c.id = cn.customer_id JOIN sales_orders so ON so.id = cn.so_id JOIN outlets o ON o.id = cn.outlet_id
  LEFT JOIN invoices i ON i.id = cn.invoice_id LEFT JOIN users ru ON ru.id = cn.requested_by LEFT JOIN users iu ON iu.id = cn.issued_by
  LEFT JOIN discrepancies d ON d.id = cn.discrepancy_id`;
const parse = (cn) => cn && { ...cn, lines: JSON.parse(cn.lines) };
export const getCreditNote = (id) => parse(db.prepare(`${CN_SELECT} WHERE cn.id = ?`).get(id));
export const listCreditNotes = (where = '1=1', params = []) =>
  db.prepare(`${CN_SELECT} WHERE ${where} ORDER BY CASE cn.status WHEN 'Requested' THEN 0 ELSE 1 END, COALESCE(cn.issued_at, cn.requested_at) DESC, cn.id DESC`).all(...params).map(parse);

// ---------- Finance: issue / decline ----------
// items (optional): Finance may change the quantities before issuing
export function issueCreditNote(cnId, { items, reason, userId, now = new Date() }) {
  const cn = getCreditNote(cnId);
  if (!cn) throw new HttpError(404, 'Credit note not found');
  if (cn.status !== 'Requested') throw new HttpError(400, `This credit note is already ${cn.status.toLowerCase()}`);
  const inv = invoiceOf(cn.so_id);
  if (!inv) throw new HttpError(400, `Issue the invoice for ${cn.so_number} first — a credit note is always against an invoice`);
  const order = getOrder(cn.so_id);
  const lines = items ? buildLines(order, items, cn.id) : cn.lines;
  const t = totalsFor(lines, order.sst_rate);
  const already = creditedOn(inv.id, cn.id);
  if (t.total > round2(inv.total - already) + 0.005) {
    throw new HttpError(400, `Credit notes on ${inv.inv_number} can't exceed the invoice: ${fmtMoney(inv.total)} invoiced, ${fmtMoney(already)} already credited`);
  }
  const outlet = getOutlet(inv.outlet_id);
  const issue = todayMYT(now);
  const paid = inv.payment_status === 'Paid';
  db.transaction(() => {
    db.prepare(`UPDATE credit_notes SET cn_number=?, invoice_id=?, lines=?, subtotal=?, sst_amount=?, total=?, reason=?, status='Issued',
                settlement=?, issued_by=?, issued_at=datetime('now'), issue_date=? WHERE id=?`)
      .run(nextNumber('credit_notes', 'cn_number', `${inv.inv_number.startsWith('MOCK-') ? 'MOCK-' : ''}CN-${outlet.code}-${issue.slice(0, 4)}-`), inv.id, JSON.stringify(lines), t.subtotal, t.sst_amount, t.total,
        reasonText(reason, cn.reason), paid ? 'Refund or offset (invoice already paid)' : 'Reduces amount due', userId, issue, cn.id);
    // fully credited and nothing left to pay → the invoice is settled
    if (!paid && round2(inv.total - already - t.total) <= 0) {
      db.prepare("UPDATE invoices SET payment_status='Paid', paid_at=datetime('now') WHERE id=?").run(inv.id);
    }
    addEvent(cn.so_id, 'Credit note', `Credit note issued against ${inv.inv_number}`);
  })();
  const done = getCreditNote(cn.id);
  const c = customerById(done.customer_id);
  notifyCustomer(c.id, 'payment', `Credit note ${done.cn_number}`, `${fmtMoney(done.total)} against ${inv.inv_number}${paid ? ' — we will arrange the refund / offset' : ' — deducted from the amount due'}`, '/portal/payments');
  queueEmail({ to: emailOf(c), template: 'credit_note_issued', data: { customer: c, creditNote: done, invoice: inv }, related: { type: 'credit_note', id: done.id } });
  if (done.discrepancy_id) notifyRole('admin', done.outlet_id, 'credit_note', `Credit note ${done.cn_number} issued`, `${done.customer_name} · ${done.so_number} · ${fmtMoney(done.total)}`, '/admin/discrepancies?status=Resolved');
  return done;
}

export function rejectCreditNote(cnId, { reason, userId }) {
  void userId;
  if (!String(reason || '').trim()) throw new HttpError(400, 'Give a reason so Admin knows what to change');
  const cn = getCreditNote(cnId);
  if (!cn) throw new HttpError(404, 'Credit note not found');
  if (cn.status !== 'Requested') throw new HttpError(400, `This credit note is already ${cn.status.toLowerCase()}`);
  db.transaction(() => {
    db.prepare("UPDATE credit_notes SET status='Rejected', reject_reason=? WHERE id=?").run(String(reason).trim(), cn.id);
    // the complaint goes back to Admin to offer something else
    if (cn.discrepancy_id) {
      db.prepare("UPDATE discrepancies SET status='Open', action=NULL, resolution=?, resolved_by=NULL, resolved_at=NULL WHERE id=?")
        .run(`Credit note declined by Finance: ${String(reason).trim()}`, cn.discrepancy_id);
    }
  })();
  if (cn.discrepancy_id) notifyRole('admin', cn.outlet_id, 'discrepancy', `Credit note declined: ${cn.so_number}`, `${cn.customer_name}: ${String(reason).trim()} — offer a replacement or a new credit note`, '/admin/discrepancies');
}

// Finance raises a credit note itself (no complaint): issued straight away
export function createCreditNote({ invoiceId, items, reason, userId }) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND void = 0').get(invoiceId);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (!String(reason || '').trim()) throw new HttpError(400, 'Give the reason for the credit note');
  const order = getOrder(inv.so_id);
  const lines = buildLines(order, items);
  const id = insertCreditNote({ order, lines, reason: reasonText(reason), userId });
  try { return issueCreditNote(id, { userId }); } catch (e) { db.prepare('DELETE FROM credit_notes WHERE id = ?').run(id); throw e; }
}

// Credit note PDF, generated the first time it's needed
export async function ensureCreditNotePdf(cn) {
  if (cn.file_id) return getFile(cn.file_id);
  const customer = customerById(cn.customer_id);
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(cn.invoice_id);
  const buffer = await renderCreditNote({ cn, invoice, customer });
  const fileId = saveBuffer(buffer, { kind: 'invoice', customerId: cn.customer_id, name: `${cn.cn_number}.pdf` });
  db.prepare('UPDATE credit_notes SET file_id = ? WHERE id = ?').run(fileId, cn.id);
  return getFile(fileId);
}
