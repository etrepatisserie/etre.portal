// Payables (supplier bills) and the cash conversion cycle.
//
// Supplier bills: when Admin marks a purchase order Received, Finance is alerted to record the supplier's
// bill (number, date, term) and later marks it paid. That gives accounts payable and DPO.
//
// Cash conversion cycle (per company, never summed), for a period of N days:
//   DSO = average receivables ÷ sales × N           (customer invoices, after credit notes)
//   DIO = average inventory ÷ cost of goods × N     (ingredient & packaging stock at unit cost)
//   DPO = average payables ÷ purchases × N          (supplier bills)
//   CCC = DIO + DSO − DPO
// Cost of goods = opening inventory + stock received − closing inventory (i.e. what was used / sold, at cost).
// Inventory on a date is worked back from today's stock and the movements since. "Opening stock" entered
// at go-live counts as stock already on hand, not as a purchase.
import db from './db.js';
import { HttpError, fmtMoney } from './errors.js';
import { round2 } from './pricing.js';
import { addDays, todayMYT } from './schedule.js';
import { notifyRole } from './notify.js';
import { mapEach } from './each.js';

export const BILL_TERMS = [0, 7, 14, 30, 45, 60];

// ---------- supplier bills ----------
const PO_SELECT = `SELECT po.id, po.po_number, po.order_date, po.received_at, DATE(po.received_at) AS received_day, po.subtotal, po.tax_amount, po.total, po.outlet_id,
    s.id AS supplier_id, s.name AS supplier_name, s.code AS supplier_code, o.code AS outlet_code,
    b.id AS bill_id, b.bill_number, b.bill_date, b.term_days, b.due_date, b.amount, b.status AS bill_status, b.paid_date, b.paid_reference
  FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN outlets o ON o.id = po.outlet_id
  LEFT JOIN supplier_bills b ON b.po_id = po.id`;

export async function listPayables(outletId = null) {
  const O = outletId ? ` AND po.outlet_id = ${Number(outletId)}` : '';
  const today = todayMYT();
  const rows = (await db.prepare(`${PO_SELECT} WHERE po.status = 'Received'${O} ORDER BY COALESCE(b.due_date, po.received_at) DESC, po.id DESC`).all())
    .map((r) => ({ ...r, overdue: r.bill_status === 'Unpaid' && r.due_date < today, days_overdue: r.bill_status === 'Unpaid' && r.due_date < today ? Math.round((Date.parse(today) - Date.parse(r.due_date)) / 864e5) : 0 }));
  const unpaid = rows.filter((r) => r.bill_status === 'Unpaid');
  return {
    to_record: rows.filter((r) => !r.bill_id),
    unpaid: unpaid.sort((a, b) => a.due_date.localeCompare(b.due_date)),
    paid: rows.filter((r) => r.bill_status === 'Paid'),
    totals: {
      unpaid: round2(unpaid.reduce((a, r) => a + r.amount, 0)),
      overdue: round2(unpaid.filter((r) => r.overdue).reduce((a, r) => a + r.amount, 0)),
      due_7_days: round2(unpaid.filter((r) => !r.overdue && r.due_date <= addDays(today, 7)).reduce((a, r) => a + r.amount, 0)),
    },
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export async function recordBill(poId, { billNumber, billDate, termDays, amount, userId }) {
  const po = await db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId);
  if (!po) throw new HttpError(404, 'Purchase order not found');
  if (po.status !== 'Received') throw new HttpError(400, 'Record the bill once the goods are received');
  if (await db.prepare('SELECT 1 FROM supplier_bills WHERE po_id = ?').get(poId)) throw new HttpError(400, `${po.po_number} already has a bill`);
  const number = String(billNumber || '').trim();
  if (!number) throw new HttpError(400, "Enter the supplier's invoice number");
  if (!DATE.test(billDate || '')) throw new HttpError(400, 'Enter the bill date');
  if (billDate > todayMYT()) throw new HttpError(400, 'The bill date cannot be in the future');
  const term = Number(termDays);
  if (!BILL_TERMS.includes(term)) throw new HttpError(400, 'Choose the payment term');
  const amt = amount === '' || amount == null ? po.total : round2(Number(amount));
  if (!(amt > 0)) throw new HttpError(400, 'Amount must be greater than 0');
  const id = (await db.prepare(`INSERT INTO supplier_bills (po_id, supplier_id, outlet_id, bill_number, bill_date, term_days, due_date, amount, recorded_by)
                         VALUES (?,?,?,?,?,?,?,?,?)`).run(po.id, po.supplier_id, po.outlet_id, number.slice(0, 60), billDate, term, addDays(billDate, term), amt, userId)).lastInsertRowid;
  return await db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(id);
}

export async function payBill(billId, { paidDate, reference, userId }) {
  const b = await db.prepare('SELECT * FROM supplier_bills WHERE id = ?').get(billId);
  if (!b) throw new HttpError(404, 'Bill not found');
  if (b.status === 'Paid') throw new HttpError(400, 'This bill is already paid');
  const d = paidDate || todayMYT();
  if (!DATE.test(d)) throw new HttpError(400, 'Enter the payment date');
  if (d > todayMYT()) throw new HttpError(400, 'The payment date cannot be in the future');
  if (d < b.bill_date) throw new HttpError(400, 'Payment date is before the bill date');
  await db.prepare("UPDATE supplier_bills SET status='Paid', paid_date=?, paid_reference=?, paid_by=? WHERE id=?").run(d, String(reference || '').trim().slice(0, 100) || null, userId, b.id);
}

// Purchasing: goods received → Finance records the supplier's bill
export async function notifyBillToRecord(po) {
  const s = await db.prepare('SELECT name FROM suppliers WHERE id = ?').get(po.supplier_id);
  await notifyRole('finance', po.outlet_id, 'supplier_bill', `Record supplier bill: ${po.po_number}`, `${s?.name || 'Supplier'} · ${fmtMoney(po.total)} · goods received`, '/finance/payables');
}

// ---------- cash conversion cycle ----------
const ymd = (sqlCol) => `DATE(${sqlCol})`; // stored Malaysia time → Malaysia date

// Receivables owed at the end of day D: invoices issued by D, not paid by D, less credit notes issued by D
async function receivablesAt(outletId, d) {
  return round2((await db.prepare(`SELECT COALESCE(SUM(GREATEST(0, i.total - COALESCE((SELECT SUM(cn.total) FROM credit_notes cn WHERE cn.invoice_id = i.id AND cn.status = 'Issued' AND cn.issue_date <= @d), 0)
      - COALESCE((SELECT SUM(ps.amount_received) FROM payment_slips ps JOIN payment_slip_invoices psi ON psi.slip_id = ps.id WHERE psi.invoice_id = i.id AND ps.status = 'Verified' AND ps.kind = 'deposit' AND ps.payment_date <= @d), 0))), 0) AS t
    FROM invoices i WHERE i.void = 0 AND i.outlet_id = @o AND i.issue_date <= @d AND NOT (i.payment_status = 'Paid' AND ${ymd('i.paid_at')} <= @d)`).get({ o: outletId, d })).t);
}
// Payables owed at the end of day D
async function payablesAt(outletId, d) {
  return round2((await db.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM supplier_bills WHERE outlet_id = @o AND bill_date <= @d AND NOT (status = 'Paid' AND paid_date <= @d)`).get({ o: outletId, d })).t);
}
// Stock value (at unit cost) at the end of day D: today's stock minus everything that moved after D
async function inventoryAt(outletId, d) {
  const rows = await db.prepare(`SELECT p.unit_cost, ps.stock_on_hand - COALESCE((SELECT SUM(m.qty) FROM stock_movements m WHERE m.product_id = p.id AND m.outlet_id = @o
                             AND ${ymd('m.created_at')} > @d AND COALESCE(m.reason, '') <> 'Opening stock'), 0) AS qty
                           FROM products p JOIN product_stock ps ON ps.product_id = p.id AND ps.outlet_id = @o WHERE p.unit_cost > 0`).all({ o: outletId, d });
  return round2(rows.reduce((a, r) => a + Math.max(0, r.qty) * r.unit_cost, 0));
}
// Stock received (at unit cost) from day A to day B, opening stock excluded
const receivedValue = async (outletId, a, b) => round2((await db.prepare(`SELECT COALESCE(SUM(m.qty * p.unit_cost), 0) AS t FROM stock_movements m JOIN products p ON p.id = m.product_id
  WHERE m.outlet_id = @o AND m.type = 'receipt' AND m.qty > 0 AND p.unit_cost > 0 AND COALESCE(m.reason, '') <> 'Opening stock' AND ${ymd('m.created_at')} BETWEEN @a AND @b`).get({ o: outletId, a, b })).t);
const salesValue = async (outletId, a, b) => round2(
  (await db.prepare('SELECT COALESCE(SUM(total), 0) AS t FROM invoices WHERE void = 0 AND outlet_id = @o AND issue_date BETWEEN @a AND @b').get({ o: outletId, a, b })).t
  - (await db.prepare("SELECT COALESCE(SUM(total), 0) AS t FROM credit_notes WHERE status = 'Issued' AND outlet_id = @o AND issue_date BETWEEN @a AND @b").get({ o: outletId, a, b })).t);
const purchasesValue = async (outletId, a, b) => round2((await db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM supplier_bills WHERE outlet_id = @o AND bill_date BETWEEN @a AND @b').get({ o: outletId, a, b })).t);

const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1;
const ratioDays = (avg, flow, n) => (flow > 0 ? round2((avg / flow) * n) : null);
const avg = (xs) => round2(xs.reduce((a, x) => a + x, 0) / xs.length);

// One period [a, b]: balances at the day before a and at b (plus month ends in between for long periods)
async function period(outletId, a, b, points) {
  const before = addDays(a, -1);
  const at = [before, ...points, b];
  const ar = await mapEach(at, async (d) => await receivablesAt(outletId, d));
  const inv = await mapEach(at, async (d) => await inventoryAt(outletId, d));
  const ap = await mapEach(at, async (d) => await payablesAt(outletId, d));
  const n = days(a, b);
  const sales = await salesValue(outletId, a, b);
  const received = await receivedValue(outletId, a, b);
  const cogs = round2(inv[0] + received - inv[inv.length - 1]);
  const purchases = await purchasesValue(outletId, a, b);
  const dso = ratioDays(avg(ar), sales, n);
  const dio = ratioDays(avg(inv), cogs, n);
  const dpo = ratioDays(avg(ap), purchases, n);
  return {
    from: a, to: b, days: n,
    sales, avg_receivables: avg(ar), cogs, stock_received: received, avg_inventory: avg(inv), purchases, avg_payables: avg(ap),
    receivables_end: ar[ar.length - 1], inventory_end: inv[inv.length - 1], payables_end: ap[ap.length - 1],
    dso, dio, dpo,
    ccc: dso != null && dio != null && dpo != null ? round2(dio + dso - dpo) : null,
    missing: [dio == null && 'DIO', dso == null && 'DSO', dpo == null && 'DPO'].filter(Boolean),
  };
}

const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };

export async function cashCycle(outletId, months = 6, now = new Date()) {
  const today = todayMYT(now);
  const cur = today.slice(0, 7);
  const list = Array.from({ length: months }, (_, k) => shiftMonth(cur, k - months + 1));
  const monthly = await mapEach(list, async (m) => ({ month: m, partial: m === cur, ...await period(outletId, `${m}-01`, m === cur ? today : monthEnd(m), []) }));
  const overall = await period(outletId, `${list[0]}-01`, today, list.slice(0, -1).map(monthEnd));
  return { as_of: today, months, overall, monthly };
}
