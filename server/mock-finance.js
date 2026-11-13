// MOCK finance data on the real customers that have a test login ("demo_login" in customers.json).
// Purpose: give Finance something to work with in both companies (KL and Ipoh) — orders, invoices,
// payment slips, overdue invoices — without touching any real customer details.
//
// Every mock record is:
//   * numbered with a MOCK- prefix (MOCK-SO-KL-2026-0001, MOCK-INV-IPH-…), so it can never be mistaken
//     for a real document and never affects the real numbering sequence;
//   * listed in the mock_records table, so `npm run mock:clear` removes all of it (plus anything staff
//     created on top of it, e.g. an invoice issued for a mock order).
import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';
import { config } from './config.js';
import { round2, computeTotals, linesSubtotal } from './pricing.js';
import { addDays, todayMYT, mytDate, isWeekend, productionDateFor } from './schedule.js';
import { getSettings } from './settings.js';
import { getOutlet } from './outlets.js';
import { termDays, isCredit } from './terms.js';
import { saveBuffer } from './files.js';
import { simplePdf } from './pdf.js';
import { fmtMoney } from './errors.js';

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const at = (date, time) => mytDate(date, time).getTime();

const track = (table, id) => db.prepare('INSERT OR IGNORE INTO mock_records (table_name, row_id) VALUES (?, ?)').run(table, Number(id));
const ids = (table) => db.prepare('SELECT row_id FROM mock_records WHERE table_name = ?').all(table).map((r) => r.row_id);
const inList = (arr) => (arr.length ? arr.join(',') : 'NULL');

export const mockCount = () => db.prepare("SELECT COUNT(*) AS n FROM mock_records WHERE table_name = 'sales_orders'").get().n;

// Customers that get mock history: real customers with a @demo.test login
export const mockCustomers = () => db.prepare(`SELECT c.*, u.id AS user_id FROM customers c JOIN users u ON u.customer_id = c.id
  WHERE c.is_demo = 0 AND u.role = 'customer' AND u.email LIKE '%@demo.test' ORDER BY c.outlet_id, c.code`).all();

// ---------- remove ----------
export function clearMock() {
  const removed = {};
  db.transaction(() => {
    const base = ids('sales_orders');
    // plus no-charge replacement orders made from mock complaints
    const so = [...base, ...(base.length ? db.prepare(`SELECT id FROM sales_orders WHERE replacement_for IN (${inList(base)})`).all().map((r) => r.id) : [])];
    const soNums = so.length ? db.prepare(`SELECT so_number FROM sales_orders WHERE id IN (${inList(so)})`).all().map((r) => r.so_number) : [];
    // invoices + slips made by the generator or later by staff/customers on mock orders
    const inv = db.prepare(`SELECT id, invoice_file_id, do_file_id FROM invoices WHERE id IN (${inList(ids('invoices'))}) OR so_id IN (${inList(so)})`).all();
    const invIds = inv.map((i) => i.id);
    const slips = db.prepare(`SELECT DISTINCT s.id, s.file_id FROM payment_slips s LEFT JOIN payment_slip_invoices psi ON psi.slip_id = s.id
                              WHERE s.id IN (${inList(ids('payment_slips'))}) OR s.so_id IN (${inList(so)}) OR psi.invoice_id IN (${inList(invIds)})`).all();
    const slipIds = slips.map((s) => s.id);
    const disc = db.prepare(`SELECT id, file_id FROM discrepancies WHERE so_id IN (${inList(so)})`).all();
    const cns = db.prepare(`SELECT id, file_id FROM credit_notes WHERE so_id IN (${inList(so)}) OR invoice_id IN (${inList(invIds)})`).all();
    const files = [...new Set([...ids('files'), ...cns.map((c) => c.file_id), ...inv.flatMap((i) => [i.invoice_file_id, i.do_file_id]), ...slips.map((s) => s.file_id), ...disc.map((d) => d.file_id)].filter(Boolean))];

    removed.credit_notes = db.prepare(`DELETE FROM credit_notes WHERE id IN (${inList(cns.map((c) => c.id))})`).run().changes;
    db.prepare(`UPDATE discrepancies SET replacement_so_id = NULL WHERE replacement_so_id IN (${inList(so)})`).run();
    db.prepare(`DELETE FROM payment_slip_invoices WHERE slip_id IN (${inList(slipIds)}) OR invoice_id IN (${inList(invIds)})`).run();
    removed.payment_slips = db.prepare(`DELETE FROM payment_slips WHERE id IN (${inList(slipIds)})`).run().changes;
    removed.invoices = db.prepare(`DELETE FROM invoices WHERE id IN (${inList(invIds)})`).run().changes;
    for (const t of ['sales_order_lines', 'delivery_events', 'order_adjustments', 'discrepancies']) db.prepare(`DELETE FROM ${t} WHERE so_id IN (${inList(so)})`).run();
    if (soNums.length) {
      // stock moved for mock orders (e.g. staff dispatched one) goes back
      const moves = db.prepare(`SELECT product_id, outlet_id, qty FROM stock_movements WHERE ref IN (${soNums.map(() => '?').join(',')})`).all(...soNums);
      for (const m of moves) db.prepare('UPDATE product_stock SET stock_on_hand = stock_on_hand - ? WHERE product_id = ? AND outlet_id = ?').run(m.qty, m.product_id, m.outlet_id);
      db.prepare(`DELETE FROM stock_movements WHERE ref IN (${soNums.map(() => '?').join(',')})`).run(...soNums);
    }
    removed.sales_orders = db.prepare(`DELETE FROM sales_orders WHERE id IN (${inList(so)})`).run().changes;
    db.prepare(`DELETE FROM credit_term_requests WHERE id IN (${inList(ids('credit_term_requests'))})`).run();
    removed.notifications = db.prepare(`DELETE FROM notifications WHERE id IN (${inList(ids('notifications'))}) OR title LIKE '%MOCK-%' OR message LIKE '%MOCK-%'`).run().changes;
    removed.emails = db.prepare("DELETE FROM email_outbox WHERE subject LIKE '%MOCK-%' OR text LIKE '%MOCK-%'").run().changes;
    const stored = files.length ? db.prepare(`SELECT stored_name FROM files WHERE id IN (${inList(files)})`).all() : [];
    db.prepare(`DELETE FROM files WHERE id IN (${inList(files)})`).run();
    for (const f of stored) fs.rmSync(path.join(config.uploadDir, f.stored_name), { force: true });
    removed.files = stored.length;
    // purchasing mock: bills, POs, ingredient movements (net zero, so stock levels need no correction), suppliers made for it
    const pos = ids('purchase_orders');
    removed.supplier_bills = db.prepare(`DELETE FROM supplier_bills WHERE id IN (${inList(ids('supplier_bills'))}) OR po_id IN (${inList(pos)})`).run().changes;
    removed.stock_movements = db.prepare(`DELETE FROM stock_movements WHERE id IN (${inList(ids('stock_movements'))})`).run().changes;
    db.prepare(`DELETE FROM purchase_order_lines WHERE po_id IN (${inList(pos)})`).run();
    removed.purchase_orders = db.prepare(`DELETE FROM purchase_orders WHERE id IN (${inList(pos)})`).run().changes;
    db.prepare(`DELETE FROM suppliers WHERE id IN (${inList(ids('suppliers'))}) AND NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.supplier_id = suppliers.id)`).run();
    db.prepare('DELETE FROM mock_records').run();
  })();
  return removed;
}

// ---------- create ----------
export function createMock({ now = Date.now() } = {}) {
  clearMock();
  const customers = mockCustomers();
  if (!customers.length) return { orders: 0, invoices: 0, slips: 0, customers: [] };
  let seed = 20261111;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const TODAY = todayMYT(new Date(now));
  const past = (ms) => Math.min(ms, now - 10 * MIN);
  const settings = getSettings();
  const finance = db.prepare("SELECT id FROM users WHERE role = 'finance' ORDER BY outlet_id IS NOT NULL, id LIMIT 1").get()?.id ?? null;
  const products = db.prepare('SELECT * FROM products WHERE is_sellable = 1 AND is_available = 1 ORDER BY id').all();
  const qtyFor = (p) => (p.uom === 'CAKE' ? int(1, 2) : p.uom === 'LOAF' ? int(2, 6) : Math.max(p.moq, 1) * int(1, 4) * (p.moq > 1 ? 1 : 6));
  const workday = (d) => { while (isWeekend(d)) d = addDays(d, 1); return d; };

  // Who plays which part (works for any set of test logins):
  // COD #1 → one slip waiting for verification + an earlier rejected slip; COD #2 → all paid;
  // credit #1 → a late payer with overdue invoices; credit #2 → pays on time, one slip covering 2 invoices.
  const cod = customers.filter((c) => !isCredit(c.payment_term));
  const credit = customers.filter((c) => isCredit(c.payment_term));
  const role = new Map();
  if (cod[0]) role.set(cod[0].id, 'cod-pending');
  if (cod[1]) role.set(cod[1].id, 'cod-paid');
  credit.sort((a, b) => termDays(a.payment_term) - termDays(b.payment_term));
  if (credit[0]) role.set(credit[0].id, 'credit-late');
  if (credit[1]) role.set(credit[1].id, 'credit-ontime');
  for (const c of [...cod.slice(2), ...credit.slice(2)]) role.set(c.id, isCredit(c.payment_term) ? 'credit-ontime' : 'cod-paid');

  // ---------- 1. orders ----------
  const orders = [];
  for (const c of customers) {
    const r = role.get(c.id);
    const outlet = getOutlet(c.outlet_id);
    const method = isCredit(c.payment_term) && c.address ? 'delivery' : 'pickup';
    const base = { c, r, outlet, method };
    for (let d = workday(addDays(TODAY, -95 + int(0, 4))); d <= addDays(TODAY, isCredit(c.payment_term) ? -5 : -3); d = workday(addDays(d, isCredit(c.payment_term) ? int(5, 9) : int(3, 5)))) {
      orders.push({ ...base, placed: d, fulfil: addDays(d, 2 + int(0, 1)), status: 'Received', invoiced: true });
    }
    // current work
    const recent = workday(addDays(TODAY, -2));
    if (r !== 'credit-late') orders.push({ ...base, placed: isWeekend(TODAY) ? addDays(recent, 1) : TODAY, placedAt: now - 2 * HOUR, fulfil: workday(addDays(TODAY, 2)), status: 'Confirmed', invoiced: false });
    if (r === 'cod-paid' || r === 'credit-ontime') orders.push({ ...base, placed: recent, fulfil: addDays(TODAY, 1), status: 'Processing', invoiced: true });
    if (r === 'credit-ontime') orders.push({ ...base, placed: workday(addDays(TODAY, -4)), fulfil: TODAY, status: method === 'delivery' ? 'Out for Delivery' : 'Ready for Pickup', invoiced: true });
  }
  for (const o of orders) {
    o.placedAt ??= past(at(o.placed, pick(['09:10', '09:45', '10:20', '11:05', '11:40', '12:15'])));
    const lines = [...products].sort(() => rand() - 0.5).slice(0, int(2, 5)).map((p) => ({ p, qty: qtyFor(p) }));
    o.lines = lines;
    o.t = computeTotals(linesSubtotal(lines.map((l) => ({ quantity: l.qty, unit_price: l.p.sell_price }))), o.method, settings);
  }
  orders.sort((a, b) => a.placedAt - b.placedAt);

  const seq = {};
  const next = (kind, outlet, date) => { const k = `${kind}-${outlet.code}-${date.slice(0, 4)}`; seq[k] = (seq[k] || 0) + 1; return `MOCK-${k}-${String(seq[k]).padStart(4, '0')}`; };
  const addSO = db.prepare(`INSERT INTO sales_orders (so_number, customer_id, outlet_id, order_date, processing_day, production_date, fulfil_date, method, time_slot,
      delivery_address, area_confirmed, notes, status, subtotal, delivery_fee, sst_rate, sst_amount, total, printed_at, confirmed_at, received_at, matches_do, created_by, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addLine = db.prepare('INSERT INTO sales_order_lines (so_id, product_id, description, original_quantity, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?,?)');
  const addEvent = db.prepare('INSERT INTO delivery_events (so_id, status, note, created_at) VALUES (?,?,?,?)');
  for (const o of orders) {
    const production = productionDateFor(o.fulfil);
    const started = ['Processing', 'Ready for Pickup', 'Out for Delivery', 'Received'].includes(o.status);
    const dispatched = ['Ready for Pickup', 'Out for Delivery', 'Received'].includes(o.status);
    o.so_number = next('SO', o.outlet, o.placed);
    o.id = addSO.run(o.so_number, o.c.id, o.c.outlet_id, sql(o.placedAt), o.placed, production, o.fulfil, o.method,
      pick(o.method === 'pickup' ? o.outlet.pickup_slots : o.outlet.delivery_slots) || null, o.method === 'delivery' ? o.c.address : null, o.method === 'delivery' ? 1 : 0,
      'MOCK data — for testing only', o.status, o.t.subtotal, o.t.delivery_fee, o.t.sst_rate, o.t.sst_amount, o.t.total,
      started ? sql(past(at(production, '06:00'))) : null, sql(o.placedAt), o.status === 'Received' ? sql(past(at(o.fulfil, '14:00'))) : null,
      o.status === 'Received' ? 1 : null, o.c.user_id, sql(o.placedAt)).lastInsertRowid;
    track('sales_orders', o.id);
    for (const l of o.lines) addLine.run(o.id, l.p.id, l.p.name, l.qty, l.qty, l.p.sell_price, round2(l.qty * l.p.sell_price));
    addEvent.run(o.id, 'Confirmed', 'Order placed — sent straight to the kitchen', sql(o.placedAt));
    if (started) addEvent.run(o.id, 'Processing', 'The kitchen has started your order', sql(past(at(production, '06:15'))));
    if (dispatched) {
      const name = o.method === 'pickup' ? 'Ready for Pickup' : 'Out for Delivery';
      addEvent.run(o.id, name, name === 'Ready for Pickup' ? 'Ready for pickup at our outlet' : 'Your order is on the way', sql(past(at(o.fulfil, '08:30'))));
    }
    if (o.status === 'Received') addEvent.run(o.id, 'Received', 'Received — items match the Delivery Order', sql(past(at(o.fulfil, '14:00'))));
  }

  // ---------- 2. invoices ----------
  const addInv = db.prepare(`INSERT INTO invoices (inv_number, do_number, so_id, customer_id, outlet_id, issue_date, due_date, subtotal, delivery_fee, sst_rate, sst_amount, total,
      payment_status, source, paid_at, issued_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'Unpaid', 'generated', NULL, ?, ?)`);
  const invoices = [];
  for (const o of orders.filter((x) => x.invoiced)) {
    const issuedAt = past(Math.max(o.placedAt + 3 * HOUR, at(o.placed, '15:30')));
    const issue = todayMYT(new Date(issuedAt));
    const due = addDays(issue, termDays(o.c.payment_term));
    const n = next('INV', o.outlet, issue);
    const id = addInv.run(n, n.replace('MOCK-INV-', 'MOCK-DO-'), o.id, o.c.id, o.c.outlet_id, issue, due, o.t.subtotal, o.t.delivery_fee, o.t.sst_rate, o.t.sst_amount, o.t.total, finance, sql(issuedAt)).lastInsertRowid;
    track('invoices', id);
    db.prepare("INSERT INTO delivery_events (so_id, status, note, created_at) VALUES (?, 'Invoiced', 'Invoice issued', ?)").run(o.id, sql(issuedAt));
    invoices.push({ id, inv_number: n, o, c: o.c, r: o.r, issue, due, issuedAt, total: o.t.total });
  }

  // ---------- 3. payments ----------
  const addSlip = db.prepare(`INSERT INTO payment_slips (customer_id, so_id, file_id, reference, amount, status, reject_reason, uploaded_by, reviewed_by, reviewed_at, created_at)
                              VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const setPay = db.prepare('UPDATE invoices SET payment_status = ?, paid_at = ? WHERE id = ?');
  const slip = ({ c, so, invs, amount, uploadedAt, status, reviewedAt = null, reason = null }) => {
    const outlet = getOutlet(c.outlet_id);
    const ref = invs.length ? invs.map((i) => i.inv_number).join(' ') : so.so_number;
    const pdf = simplePdf(['MOCK BANK TRANSFER RECEIPT', 'Mock data - not a real transaction', `Date: ${sql(uploadedAt)} UTC`, `From: ${c.name}`,
      `To: ${outlet.bank_account_name}`, `Account: ${outlet.bank_account_no}`, `Amount: RM ${amount.toFixed(2)}`, `Reference: ${ref}`]);
    const fileId = saveBuffer(pdf, { kind: 'slip', customerId: c.id, userId: c.user_id, name: `mock-slip-${ref.split(' ')[0]}.pdf` });
    track('files', fileId);
    const id = addSlip.run(c.id, so?.id ?? null, fileId, ref, amount, status, reason, c.user_id, status === 'Pending' ? null : finance, reviewedAt ? sql(reviewedAt) : null, sql(uploadedAt)).lastInsertRowid;
    track('payment_slips', id);
    for (const i of invs) db.prepare('INSERT INTO payment_slip_invoices (slip_id, invoice_id) VALUES (?,?)').run(id, i.id);
    return id;
  };
  const paid = (inv, at2) => setPay.run('Paid', sql(at2), inv.id);

  for (const c of customers) {
    const r = role.get(c.id);
    const mine = invoices.filter((i) => i.c.id === c.id);
    if (!isCredit(c.payment_term)) {
      // COD: slip comes with the order, Finance verifies after invoicing
      const history = mine.filter((i) => i.o.status === 'Received');
      const lastHistory = history[history.length - 1];
      const rejectOne = r === 'cod-pending' ? history[history.length - 4] : null;
      for (const inv of mine) {
        const up = inv.o.placedAt + 4 * MIN;
        if (r === 'cod-pending' && inv === lastHistory) {
          slip({ c, so: inv.o, invs: [inv], amount: inv.total, uploadedAt: up, status: 'Pending' });
          setPay.run('Slip Uploaded', null, inv.id);
        } else if (inv === rejectOne) {
          const rejAt = inv.issuedAt + 2 * HOUR;
          slip({ c, so: inv.o, invs: [inv], amount: round2(inv.total - 50), uploadedAt: up, status: 'Rejected', reviewedAt: rejAt, reason: 'The amount on the slip does not match the invoice total — please check and re-upload.' });
          const reAt = rejAt + 18 * HOUR;
          slip({ c, so: null, invs: [inv], amount: inv.total, uploadedAt: reAt, status: 'Verified', reviewedAt: reAt + 3 * HOUR });
          paid(inv, reAt + 3 * HOUR);
        } else {
          const ok = past(inv.issuedAt + int(1, 3) * HOUR);
          slip({ c, so: inv.o, invs: [inv], amount: inv.total, uploadedAt: up, status: 'Verified', reviewedAt: ok });
          paid(inv, ok);
        }
      }
      // today's order: slip attached, waiting for the invoice
      for (const o of orders.filter((x) => x.c.id === c.id && !x.invoiced)) slip({ c, so: o, invs: [], amount: o.t.total, uploadedAt: o.placedAt + 3 * MIN, status: 'Pending' });
    } else {
      const notDue = mine.filter((i) => i.due >= TODAY);
      const lateA = r === 'credit-late' ? mine.find((i) => i.due >= addDays(TODAY, -55) && i.due <= addDays(TODAY, -31)) : null;
      const lateB = r === 'credit-late' ? mine.find((i) => i.due >= addDays(TODAY, -20) && i.due <= addDays(TODAY, -3)) : null;
      for (const inv of mine) {
        if (inv.due >= TODAY || inv === lateA || inv === lateB) continue; // still open
        const payDay = addDays(inv.due, -int(0, Math.min(6, termDays(c.payment_term) - 2)));
        const up = past(at(payDay, pick(['10:15', '11:30', '15:45'])));
        const ok = past(up + int(2, 20) * HOUR);
        slip({ c, so: null, invs: [inv], amount: inv.total, uploadedAt: up, status: 'Verified', reviewedAt: ok });
        paid(inv, ok);
      }
      // on-time payer: one transfer covering their two oldest open invoices, waiting for Finance
      if (r === 'credit-ontime' && notDue.length >= 2) {
        const two = notDue.slice(0, 2);
        slip({ c, so: null, invs: two, amount: round2(two[0].total + two[1].total), uploadedAt: now - 5 * HOUR, status: 'Pending' });
        for (const i of two) setPay.run('Slip Uploaded', null, i.id);
      }
    }
  }

  // ---------- 4. Finance notifications for the open work ----------
  const addNote = db.prepare('INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at) VALUES (?,?,?,?,?,0,?)');
  const financeUsers = (outletId) => db.prepare("SELECT id FROM users WHERE role = 'finance' AND (outlet_id IS NULL OR outlet_id = ?)").all(outletId).map((u) => u.id);
  const note = (outletId, type, title, message, link, ms) => { for (const u of financeUsers(outletId)) track('notifications', addNote.run(u, type, title, message, link, sql(ms)).lastInsertRowid); };
  for (const o of orders.filter((x) => !x.invoiced)) note(o.c.outlet_id, 'to_invoice', `Issue invoice: ${o.so_number}`, `${o.c.name} · ${fmtMoney(o.t.total)}${isCredit(o.c.payment_term) ? '' : ' · COD slip attached'}`, `/finance/invoices/new/${o.id}`, o.placedAt);
  for (const s of db.prepare(`SELECT s.*, c.name, c.outlet_id FROM payment_slips s JOIN customers c ON c.id = s.customer_id WHERE s.status = 'Pending' AND s.id IN (${inList(ids('payment_slips'))})`).all()) {
    note(s.outlet_id, 'slip', `Payment slip from ${s.name}`, `${s.reference} · ${fmtMoney(s.amount)}`, '/finance/payments', Date.parse(`${s.created_at.replace(' ', 'T')}Z`));
  }

  createMockPurchasing({ now, outletIds: [...new Set(customers.map((c) => c.outlet_id))] });

  const count = (t) => ids(t).length;
  return {
    orders: count('sales_orders'), invoices: count('invoices'), slips: count('payment_slips'), purchase_orders: count('purchase_orders'), supplier_bills: count('supplier_bills'),
    customers: customers.map((c) => ({ code: c.code, name: c.name, outlet: getOutlet(c.outlet_id).code, term: c.payment_term, role: role.get(c.id) })),
  };
}

// Mock purchasing on its own (also part of createMock): supplier POs, bills and ingredient usage per outlet.
// Safe to run on a database that already has mock orders — it only adds purchasing history (once).
export function createMockPurchasing({ now = Date.now(), outletIds = null } = {}) {
  if (ids('purchase_orders').length) return { purchase_orders: ids('purchase_orders').length, supplier_bills: ids('supplier_bills').length, skipped: true };
  outletIds ??= [...new Set(mockCustomers().map((c) => c.outlet_id))];
  let seed = 20261112;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const TODAY = todayMYT(new Date(now));
  const past = (ms) => Math.min(ms, now - 10 * MIN);
  const workday = (d) => { while (isWeekend(d)) d = addDays(d, 1); return d; };
  const addNote = db.prepare('INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at) VALUES (?,?,?,?,?,0,?)');
  const note = (outletId, type, title, message, link, ms) => {
    for (const u of db.prepare("SELECT id FROM users WHERE role = 'finance' AND (outlet_id IS NULL OR outlet_id = ?)").all(outletId)) track('notifications', addNote.run(u.id, type, title, message, link, sql(ms)).lastInsertRowid);
  };
  // ---------- 5. purchasing: supplier POs, bills and ingredient usage (for payables and the cash conversion cycle) ----------
  // Per outlet, ~13 weeks: weekly ingredient usage and a fortnightly restock that adds back exactly what was used,
  // so today's stock levels are unchanged. Bills: dairy on 14 days, others 30 days; most paid around the due date,
  // one Ipoh bill overdue, and the latest delivery still waiting for its bill.
  const START = addDays(TODAY, -91);
  const ings = db.prepare('SELECT * FROM products WHERE is_sellable = 0 AND unit_cost > 0 ORDER BY id').all();
  const supplierFor = (() => {
    const get = (code, name) => {
      const found = db.prepare('SELECT * FROM suppliers WHERE code IN (?, ?) ORDER BY code').get(code, `MOCK-${code}`);
      if (found) return found;
      const id = db.prepare('INSERT INTO suppliers (code, name) VALUES (?,?)').run(`MOCK-${code}`, name).lastInsertRowid;
      track('suppliers', id);
      return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    };
    const dairy = get('SUP-001', 'MOCK Dairy supplier'), baking = get('SUP-002', 'MOCK Baking supplier'), pack = get('SUP-003', 'MOCK Packaging supplier');
    return (p) => (p.sku.startsWith('PKG') ? pack : ['ING-BTR', 'ING-CRM'].includes(p.sku) ? dairy : baking);
  })();
  const termOf = (sup) => (sup.code === 'SUP-001' ? 14 : 30);
  const addMove = db.prepare(`INSERT INTO stock_movements (product_id, outlet_id, type, qty, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?,?,?)`);
  const addPO = db.prepare(`INSERT INTO purchase_orders (po_number, supplier_id, outlet_id, order_date, expected_date, status, notes, tax_rate, subtotal, tax_amount, total, created_at, updated_at, received_at)
                            VALUES (?,?,?,?,?, 'Received', 'MOCK purchase order — not real', 0, ?, 0, ?, ?, ?, ?)`);
  const addPOLine = db.prepare('INSERT INTO purchase_order_lines (po_id, line_no, product_id, description, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?,?)');
  const addBill = db.prepare(`INSERT INTO supplier_bills (po_id, supplier_id, outlet_id, bill_number, bill_date, term_days, due_date, amount, status, paid_date, paid_reference, created_at)
                              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  let poSeq = 0, billSeq = 0;
  for (const oid of outletIds) {
    const o = getOutlet(oid);
    const stockNow = new Map(db.prepare('SELECT product_id, stock_on_hand FROM product_stock WHERE outlet_id = ?').all(oid).map((r) => [r.product_id, r.stock_on_hand]));
    const items = ings.filter((p) => (stockNow.get(p.id) || 0) > 0);
    if (!items.length) continue;
    // weekly usage ≈ a quarter of today's stock (≈ 3–4 weeks of stock on hand)
    const weeks = Array.from({ length: 13 }, (_, k) => workday(addDays(START, 3 + 7 * k))).filter((d) => d <= TODAY);
    const use = new Map(items.map((p) => [p.id, weeks.map(() => Math.max(1, Math.round((stockNow.get(p.id) * int(20, 30)) / 100)))]));
    const restock = Array.from({ length: 7 }, (_, k) => workday(addDays(START, 14 * k))).filter((d) => d <= addDays(TODAY, -1));
    const events = [];
    weeks.forEach((d, w) => items.forEach((p) => events.push({ d, time: '17:00', p, qty: -use.get(p.id)[w], kind: 'use' })));
    // each restock brings in the usage of the following fortnight; the last one tops up whatever is left → net zero
    restock.forEach((d, k) => {
      const until = restock[k + 1] || '9999-12-31';
      const bySup = new Map();
      for (const p of items) {
        const q = weeks.reduce((a, wd, w) => a + (wd >= d && wd < until ? use.get(p.id)[w] : 0), 0)
          + (k === 0 ? weeks.reduce((a, wd, w) => a + (wd < d ? use.get(p.id)[w] : 0), 0) : 0);
        if (q <= 0) continue;
        const sup = supplierFor(p);
        if (!bySup.has(sup.id)) bySup.set(sup.id, { sup, lines: [] });
        bySup.get(sup.id).lines.push({ p, q });
      }
      for (const { sup, lines } of bySup.values()) {
        const number = `MOCK-PO-${o.code}-${d.slice(0, 4)}-${String(++poSeq).padStart(4, '0')}`;
        const total = round2(lines.reduce((a, l) => a + l.q * l.p.unit_cost, 0));
        const recvMs = past(at(d, '09:30'));
        const poId = addPO.run(number, sup.id, oid, addDays(d, -3), d, total, total, sql(at(addDays(d, -3), '10:00')), sql(recvMs), sql(recvMs)).lastInsertRowid;
        track('purchase_orders', poId);
        lines.forEach((l, n) => addPOLine.run(poId, n + 1, l.p.id, l.p.name, l.q, l.p.unit_cost, round2(l.q * l.p.unit_cost)));
        for (const l of lines) events.push({ d, time: '09:30', p: l.p, qty: l.q, kind: 'receipt', ref: number });
        // the supplier's bill
        const latest = k === restock.length - 1; // the latest delivery: bill not recorded yet
        if (latest) { note(oid, 'supplier_bill', `Record supplier bill: ${number}`, `${sup.name} · ${fmtMoney(total)} · goods received`, '/finance/payables', recvMs); continue; }
        const billDate = addDays(d, int(0, 2)) > TODAY ? d : addDays(d, int(0, 2));
        const term = termOf(sup);
        const due = addDays(billDate, term);
        const keepOverdue = o.code !== 'KL' && sup.code === 'SUP-003' && due < addDays(TODAY, -3) && due >= addDays(TODAY, -25);
        let paidDate = null;
        if (!keepOverdue && due <= addDays(TODAY, -2)) { paidDate = addDays(due, int(-5, 4)); if (paidDate < billDate) paidDate = billDate; if (paidDate > TODAY) paidDate = TODAY; }
        track('supplier_bills', addBill.run(poId, sup.id, oid, `MOCK-BILL-${String(++billSeq).padStart(4, '0')}`, billDate, term, due, total,
          paidDate ? 'Paid' : 'Unpaid', paidDate, paidDate ? 'MOCK transfer' : null, sql(past(at(billDate, '15:00')))).lastInsertRowid);
      }
    });
    // write the movements in date order; balance_after replays from today's stock (net change is zero)
    events.sort((x, y) => (x.d + x.time).localeCompare(y.d + y.time));
    const running = new Map(items.map((p) => [p.id, stockNow.get(p.id) - events.filter((e) => e.p.id === p.id).reduce((a, e) => a + e.qty, 0)]));
    for (const e of events) {
      running.set(e.p.id, running.get(e.p.id) + e.qty);
      track('stock_movements', addMove.run(e.p.id, oid, e.kind === 'use' ? 'adjustment' : 'receipt', e.qty, Math.max(0, running.get(e.p.id)),
        e.kind === 'use' ? 'MOCK ingredient usage' : 'Purchase order received', e.kind === 'use' ? 'MOCK-USAGE' : e.ref, sql(past(at(e.d, e.time)))).lastInsertRowid);
    }
  }

  return { purchase_orders: ids('purchase_orders').length, supplier_bills: ids('supplier_bills').length };
}
