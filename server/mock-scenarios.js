// Mock "live work" for trying the portal: one of each situation each portal has to act on today.
// Added ON TOP of the mock history (npm run mock:finance), only for the real customers' @demo.test test logins.
// Everything is numbered MOCK-… and listed in mock_records, so `npm run mock:clear` removes it all.
import db from './db.js';
import { round2, computeTotals, linesSubtotal } from './pricing.js';
import { addDays, todayMYT, isWeekend, productionDateFor, orderWindow } from './schedule.js';
import { getSettings } from './settings.js';
import { getOutlet } from './outlets.js';
import { termDays } from './terms.js';
import { saveBuffer } from './files.js';
import { simplePdf } from './pdf.js';
import { notifyRole } from './notify.js';
import { requestCreditNote } from './complaints.js';
import { fmtMoney } from './errors.js';
import { mockCustomers } from './mock-finance.js';

const track = (table, id) => db.prepare('INSERT OR IGNORE INTO mock_records (table_name, row_id) VALUES (?, ?)').run(table, Number(id));
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const HOUR = 3600e3;

export function createMockScenarios({ now = Date.now() } = {}) {
  if (db.prepare("SELECT 1 FROM sales_orders WHERE notes LIKE 'MOCK scenario:%'").get()) return { skipped: true };
  const all = mockCustomers();
  const byCode = (re) => all.find((c) => re.test(c.payment_term));
  const kl = all.find((c) => getOutlet(c.outlet_id).code === 'KL');
  const iph = all.filter((c) => getOutlet(c.outlet_id).code === 'IPH');
  const codI = iph.find((c) => c.payment_term === 'COD');
  const lateI = iph.find((c) => /NET1[45]/.test(c.payment_term)) || byCode(/NET/);
  const goodI = iph.find((c) => c.payment_term === 'NET30') || byCode(/NET/);
  if (!kl || !codI || !lateI || !goodI) return { skipped: true, reason: 'Needs the test-login customers (KL COD, Ipoh COD, Ipoh 14/15-day, Ipoh 30-day).' };

  const TODAY = todayMYT(new Date(now));
  const settings = getSettings();
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND outlet_id IS NULL ORDER BY id LIMIT 1").get()?.id ?? null;
  const finance = db.prepare("SELECT id FROM users WHERE role = 'finance' ORDER BY id LIMIT 1").get()?.id ?? null;
  const products = db.prepare("SELECT * FROM products WHERE is_sellable = 1 AND is_available = 1 AND uom = 'PC' ORDER BY id LIMIT 8").all();
  const workdayBack = (d) => { while (isWeekend(d)) d = addDays(d, -1); return d; };

  // next free MOCK number, continuing after the existing mock history
  const nextNo = (table, col, prefix) => {
    const last = db.prepare(`SELECT ${col} AS n FROM ${table} WHERE ${col} LIKE ? ORDER BY ${col} DESC LIMIT 1`).get(`${prefix}%`)?.n;
    return `${prefix}${String((last ? Number(last.slice(prefix.length)) : 0) + 1).padStart(4, '0')}`;
  };
  const addSO = db.prepare(`INSERT INTO sales_orders (so_number, customer_id, outlet_id, order_date, processing_day, production_date, fulfil_date, method, time_slot,
      delivery_address, area_confirmed, notes, status, subtotal, delivery_fee, sst_rate, sst_amount, total, printed_at, confirmed_at, received_at, matches_do,
      delivery_provider, delivery_link, cancel_reason, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addLine = db.prepare('INSERT INTO sales_order_lines (so_id, product_id, description, original_quantity, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?,?)');
  const addEvent = db.prepare('INSERT INTO delivery_events (so_id, status, note, created_at) VALUES (?,?,?,?)');
  const made = [];

  // one order: who, what situation, when it's for, how far along it is
  const order = ({ c, label, fulfil, placedAt, status, method, printed = false, picks = [0, 1], qty = [10, 6], provider = null, link = null, cancel = null, invoice = null, paid = false }) => {
    const outlet = getOutlet(c.outlet_id);
    const meth = method || (c.address ? 'delivery' : 'pickup');
    const lines = picks.map((i, k) => ({ p: products[i % products.length], q: Math.max(products[i % products.length].moq || 1, qty[k] || 6) }));
    const t = computeTotals(linesSubtotal(lines.map((l) => ({ quantity: l.q, unit_price: l.p.sell_price }))), meth, settings);
    const placedDay = todayMYT(new Date(placedAt));
    const so_number = nextNo('sales_orders', 'so_number', `MOCK-SO-${outlet.code}-${placedDay.slice(0, 4)}-`);
    const started = ['Processing', 'Ready for Pickup', 'Out for Delivery', 'Received'].includes(status);
    const id = addSO.run(so_number, c.id, c.outlet_id, sql(placedAt), workdayBack(placedDay), productionDateFor(fulfil), fulfil, meth,
      (meth === 'pickup' ? outlet.pickup_slots : outlet.delivery_slots)[0] || null, meth === 'delivery' ? c.address : null, meth === 'delivery' ? 1 : 0,
      `MOCK scenario: ${label}`, status, t.subtotal, t.delivery_fee, t.sst_rate, t.sst_amount, t.total,
      printed || started ? sql(placedAt + 2 * HOUR) : null, sql(placedAt), status === 'Received' ? sql(now - 20 * HOUR) : null, status === 'Received' ? 1 : null,
      provider, link, cancel, c.user_id, sql(placedAt)).lastInsertRowid;
    track('sales_orders', id);
    for (const l of lines) addLine.run(id, l.p.id, l.p.name, l.q, l.q, l.p.sell_price, round2(l.q * l.p.sell_price));
    addEvent.run(id, 'Confirmed', 'Order placed — sent straight to the kitchen', sql(placedAt));
    if (started) addEvent.run(id, 'Processing', 'The kitchen has started your order', sql(placedAt + 3 * HOUR));
    if (['Ready for Pickup', 'Out for Delivery', 'Received'].includes(status)) addEvent.run(id, meth === 'pickup' ? 'Ready for Pickup' : 'Out for Delivery', meth === 'pickup' ? 'Ready for pickup at our outlet' : `On the way${provider ? ` with ${provider}` : ''}`, sql(Math.min(now - HOUR, placedAt + 26 * HOUR)));
    if (status === 'Received') addEvent.run(id, 'Received', 'Received — customer reported a problem', sql(now - 20 * HOUR));
    if (status === 'Cancelled') addEvent.run(id, 'Cancelled', cancel, sql(placedAt + HOUR));
    let inv = null;
    if (invoice) {
      const issue = invoice; const n = nextNo('invoices', 'inv_number', `MOCK-INV-${outlet.code}-${issue.slice(0, 4)}-`);
      const invId = db.prepare(`INSERT INTO invoices (inv_number, do_number, so_id, customer_id, outlet_id, issue_date, due_date, subtotal, delivery_fee, sst_rate, sst_amount, total,
          payment_status, source, paid_at, issued_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'generated', ?, ?, ?)`)
        .run(n, n.replace('MOCK-INV-', 'MOCK-DO-'), id, c.id, c.outlet_id, issue, addDays(issue, termDays(c.payment_term)), t.subtotal, t.delivery_fee, t.sst_rate, t.sst_amount, t.total,
          paid ? 'Paid' : 'Unpaid', paid ? sql(placedAt + 5 * HOUR) : null, finance, sql(placedAt + 4 * HOUR)).lastInsertRowid;
      track('invoices', invId);
      addEvent.run(id, 'Invoiced', 'Invoice issued', sql(placedAt + 4 * HOUR));
      inv = { id: invId, inv_number: n, total: t.total };
    }
    const o = { id, so_number, c, label, total: t.total, inv, lines };
    made.push(o);
    return o;
  };
  const slipFile = (c, ref, amount) => {
    const outlet = getOutlet(c.outlet_id);
    const fileId = saveBuffer(simplePdf(['MOCK BANK TRANSFER RECEIPT', 'Mock data - not a real transaction', `From: ${c.name}`, `To: ${outlet.bank_account_name}`,
      `Account: ${outlet.bank_account_no}`, `Amount: RM ${amount.toFixed(2)}`, `Reference: ${ref}`]), { kind: 'slip', customerId: c.id, userId: c.user_id, name: `mock-slip-${ref}.pdf` });
    track('files', fileId);
    return fileId;
  };

  const next = orderWindow(new Date(now), { outletId: kl.outlet_id }).dates;
  const ago = (h) => now - h * HOUR;

  // ---- Kitchen + Finance: brand-new COD order with its slip, not invoiced, not printed (KL)
  const a = order({ c: kl, label: 'new COD order with slip — Finance: issue invoice & verify slip · Kitchen: print sheet', fulfil: next[0], placedAt: ago(1), status: 'Confirmed', method: 'pickup', picks: [0, 2], qty: [10, 8] });
  const aSlip = db.prepare("INSERT INTO payment_slips (customer_id, so_id, file_id, reference, amount, status, uploaded_by, created_at) VALUES (?,?,?,?,?, 'Pending', ?, ?)")
    .run(kl.id, a.id, slipFile(kl, a.so_number, a.total), a.so_number, a.total, kl.user_id, sql(ago(1))).lastInsertRowid;
  track('payment_slips', aSlip);
  addEvent.run(a.id, 'Confirmed', 'Payment slip received with the order', sql(ago(1)));

  // ---- Admin: order for a later date, with a quantity already adjusted (KL) → "Yet to dispatch"
  const b = order({ c: kl, label: 'later date, quantity adjusted by Admin — Admin: Yet to dispatch', fulfil: next[Math.min(4, next.length - 1)], placedAt: ago(26), status: 'Confirmed', method: 'pickup', picks: [3, 4], qty: [12, 6] });
  const bl = b.lines[0];
  db.prepare("UPDATE sales_order_lines SET quantity = ?, line_total = ? WHERE so_id = ? AND product_id = ?").run(bl.q - 2, round2((bl.q - 2) * bl.p.sell_price), b.id, bl.p.id);
  const line = db.prepare('SELECT id FROM sales_order_lines WHERE so_id = ? AND product_id = ?').get(b.id, bl.p.id);
  const before = db.prepare('SELECT subtotal, delivery_fee, sst_amount, total FROM sales_orders WHERE id = ?').get(b.id);
  const sub = db.prepare('SELECT SUM(line_total) AS s FROM sales_order_lines WHERE so_id = ?').get(b.id).s;
  const after = computeTotals(sub, 'pickup', settings);
  db.prepare('UPDATE sales_orders SET subtotal=?, delivery_fee=?, sst_amount=?, total=? WHERE id=?').run(after.subtotal, after.delivery_fee, after.sst_amount, after.total, b.id);
  db.prepare(`INSERT INTO order_adjustments (so_id, batch, line_id, product_name, old_qty, new_qty, reason, totals_before, totals_after, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.id, `mock-${b.id}`, line.id, bl.p.name, bl.q, bl.q - 2, 'MOCK: only 10 available that day', JSON.stringify(before), JSON.stringify(after), admin, sql(ago(20)));
  addEvent.run(b.id, 'Confirmed', `Quantities adjusted: ${bl.p.name} ${bl.q}→${bl.q - 2}`, sql(ago(20)));

  // ---- Kitchen: printed, ready to start today (Ipoh COD, invoiced & paid)
  order({ c: codI, label: 'sheet printed — Kitchen: start production', fulfil: addDays(TODAY, 1), placedAt: ago(28), status: 'Confirmed', method: 'pickup', printed: true, picks: [1, 5], qty: [15, 10], invoice: todayMYT(new Date(ago(24))), paid: true });

  // ---- Admin: in production, pickup / delivery is today → "To dispatch today" (Ipoh 30-day)
  order({ c: goodI, label: 'in production, delivery today — Admin: dispatch (add GoGet / Lalamove link)', fulfil: TODAY, placedAt: ago(50), status: 'Processing', picks: [2, 6], qty: [20, 12], invoice: todayMYT(new Date(ago(46))) });

  // ---- Admin: LATE — pickup date was yesterday and it's still not dispatched (Ipoh 14/15-day)
  order({ c: lateI, label: 'late — pickup date passed, not dispatched — Admin: dispatch today', fulfil: addDays(TODAY, -1), placedAt: ago(74), status: 'Processing', method: 'pickup', picks: [0, 3], qty: [10, 10], invoice: todayMYT(new Date(ago(70))) });

  // ---- Customer: out for delivery with a tracking link (Ipoh 30-day) → customer confirms receipt
  order({ c: goodI, label: 'out for delivery — Customer: track it, then Mark as Received', fulfil: TODAY, placedAt: ago(52), status: 'Out for Delivery', picks: [4, 7], qty: [8, 8],
    provider: 'Lalamove', link: 'https://example.com/mock-tracking', invoice: todayMYT(new Date(ago(48))) });

  // ---- Customer: ready for pickup today (Ipoh COD, paid)
  order({ c: codI, label: 'ready for pickup — Customer: collect & Mark as Received', fulfil: TODAY, placedAt: ago(54), status: 'Ready for Pickup', method: 'pickup', picks: [6, 1], qty: [12, 10], invoice: todayMYT(new Date(ago(50))), paid: true });

  // ---- Admin: received with an open complaint → offer credit note or replacement (Ipoh 30-day)
  const f = order({ c: goodI, label: 'received with a complaint — Admin: offer credit note or replacement', fulfil: addDays(TODAY, -1), placedAt: ago(75), status: 'Received', picks: [5, 2], qty: [10, 10], invoice: todayMYT(new Date(ago(72))) });
  const fl = db.prepare('SELECT id, description FROM sales_order_lines WHERE so_id = ? ORDER BY id LIMIT 1').get(f.id);
  track('discrepancies', db.prepare("INSERT INTO discrepancies (so_id, line_id, product_name, qty, note, status, created_by, created_at) VALUES (?,?,?,?,?, 'Open', ?, ?)")
    .run(f.id, fl.id, fl.description, 2, 'MOCK: 2 arrived squashed', goodI.user_id, sql(now - 19 * HOUR)).lastInsertRowid);

  // ---- Finance: complaint already turned into a credit note request → Finance issues or declines it (Ipoh 14/15-day)
  const g = order({ c: lateI, label: 'complaint → credit note requested — Finance: issue or decline', fulfil: addDays(TODAY, -2), placedAt: ago(98), status: 'Received', method: 'pickup', picks: [7, 0], qty: [8, 10], invoice: todayMYT(new Date(ago(96))) });
  const gl = db.prepare('SELECT id, description FROM sales_order_lines WHERE so_id = ? ORDER BY id LIMIT 1').get(g.id);
  const gd = db.prepare("INSERT INTO discrepancies (so_id, line_id, product_name, qty, note, status, created_by, created_at) VALUES (?,?,?,?,?, 'Open', ?, ?)")
    .run(g.id, gl.id, gl.description, 3, 'MOCK: 3 missing from the box', lateI.user_id, sql(now - 40 * HOUR)).lastInsertRowid;
  track('discrepancies', gd);
  requestCreditNote(gd, { qty: 3, reason: 'MOCK: 3 missing from the box', userId: admin });

  // ---- History: a cancelled order (KL)
  order({ c: kl, label: 'cancelled by the customer', fulfil: next[1] || next[0], placedAt: ago(30), status: 'Cancelled', method: 'pickup', picks: [5], qty: [10], cancel: 'MOCK: customer changed plans' });

  // ---- Finance: overdue customer uploads a slip for an overdue invoice → verify (Ipoh 14/15-day)
  const overdue = db.prepare(`SELECT i.* FROM invoices i WHERE i.customer_id = ? AND i.void = 0 AND i.payment_status IN ('Unpaid','Rejected') AND i.due_date < ? AND i.inv_number LIKE 'MOCK-%' ORDER BY i.due_date LIMIT 1`).get(lateI.id, TODAY);
  if (overdue) {
    const s = db.prepare("INSERT INTO payment_slips (customer_id, file_id, reference, amount, status, uploaded_by, created_at) VALUES (?,?,?,?, 'Pending', ?, ?)")
      .run(lateI.id, slipFile(lateI, overdue.inv_number, overdue.total), overdue.inv_number, overdue.total, lateI.user_id, sql(ago(3))).lastInsertRowid;
    track('payment_slips', s);
    db.prepare('INSERT INTO payment_slip_invoices (slip_id, invoice_id) VALUES (?,?)').run(s, overdue.id);
    db.prepare("UPDATE invoices SET payment_status = 'Slip Uploaded' WHERE id = ?").run(overdue.id);
  }

  // ---- Finance: a COD customer asks for a credit term (Ipoh COD)
  if (!db.prepare("SELECT 1 FROM credit_term_requests WHERE customer_id = ? AND status = 'Pending'").get(codI.id)) {
    track('credit_term_requests', db.prepare("INSERT INTO credit_term_requests (customer_id, status, note, created_at) VALUES (?, 'Pending', ?, ?)")
      .run(codI.id, 'MOCK: we order 3 times a week now — could we move to 14-day terms?', sql(ago(5))).lastInsertRowid);
  }

  // ---- Bell notifications so each portal has something new to open
  const n = (role, outletId, type, title, msg, linkTo) => notifyRole(role, outletId, type, title, msg, linkTo);
  n('finance', kl.outlet_id, 'to_invoice', `Issue invoice: ${a.so_number}`, `${kl.name} · ${fmtMoney(a.total)} · COD slip attached`, '/finance/invoices/new');
  n('kitchen', kl.outlet_id, 'production', `New order ${a.so_number}`, `${kl.name} · print the sheet, then start`, `/kitchen/orders/${a.id}`);
  n('admin', goodI.outlet_id, 'discrepancy', `Complaint: ${f.so_number}`, `${goodI.name}: 2 arrived squashed`, '/admin/discrepancies');
  if (overdue) n('finance', lateI.outlet_id, 'slip', `Payment slip from ${lateI.name}`, `${overdue.inv_number} · ${fmtMoney(overdue.total)}`, '/finance/payments');

  return { orders: made.map((o) => `${o.so_number} · ${o.c.name} · ${o.label}`), slips: 1 + (overdue ? 1 : 0), credit_notes: 1, complaints: 2, term_requests: 1 };
}
