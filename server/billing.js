// Invoices & DOs, payment slips, payment terms, aging.
import db from './db.js';
import { HttpError, fmtMoney } from './errors.js';
import { round2 } from './pricing.js';
import { getSettings } from './settings.js';
import { addDays, todayMYT } from './schedule.js';
import { getOrder, nextNumber } from './sales.js';
import { notifyRole, notifyCustomer } from './notify.js';
import { queueEmail } from './email.js';
import { renderInvoice, renderDeliveryOrder } from './pdf.js';
import { saveBuffer, getFile } from './files.js';
import { getOutlet } from './outlets.js';
import { TERMS, termDays, isCredit, termLabel } from './terms.js';
import { audit, auditFor } from './audit.js';
import { assertBukkuReady } from './bukku.js';
import { mapEach } from './each.js';

// What is still owed on an invoice: total minus issued credit notes
export const CREDITED_SQL = (a = 'i') => `COALESCE((SELECT SUM(cn.total) FROM credit_notes cn WHERE cn.invoice_id = ${a}.id AND cn.status = 'Issued'), 0)`;
// Deposits: verified part payments on the invoice (a slip verified as "deposit" covers exactly one invoice)
export const DEPOSITED_SQL = (a = 'i') => `COALESCE((SELECT SUM(ps.amount_received) FROM payment_slips ps JOIN payment_slip_invoices psi ON psi.slip_id = ps.id
  WHERE psi.invoice_id = ${a}.id AND ps.status = 'Verified' AND ps.kind = 'deposit'), 0)`;
// What is still owed on an invoice: total − issued credit notes − deposits received
export const BALANCE_SQL = (a = 'i') => `ROUND(${a}.total - ${CREDITED_SQL(a)} - ${DEPOSITED_SQL(a)}, 2)`;

const customerById = async (id) => await db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
const emailOf = async (c) => c?.email || (await db.prepare('SELECT email FROM users WHERE customer_id = ? LIMIT 1').get(c?.id))?.email;

// ---------- invoices ----------
// COD customers pay when they order, so the invoice is due on issue; credit terms: issue date + 14 / 15 / 30 days
export function dueDateFor(customer, order, issueDate) {
  void order;
  const days = termDays(customer.payment_term);
  return days ? addDays(issueDate, days) : issueDate;
}

// mode: 'generate' (branded PDF) | 'upload' (Finance attaches the invoice made elsewhere) | 'bukku' (created in Bukku, see bukku.js)
// For an upload Finance records the invoice's own number, date, due date and amount (checked against the order).
export async function issueInvoice(soId, { mode = 'generate', invoiceFileId = null, doFileId = null, userId, now = new Date(), externalNumber = null, invoiceDate = null, dueDate = null, uploadedAmount = null }) {
  const order = await getOrder(soId);
  if (!order) throw new HttpError(404, 'Order not found');
  if (['Cancelled', 'Pending'].includes(order.status)) throw new HttpError(400, `This order is ${order.status} — no invoice needed`);
  if (order.invoice) throw new HttpError(400, `Order already has invoice ${order.invoice.inv_number}`);
  if (order.replacement_for) throw new HttpError(400, 'This is a no-charge replacement order — no invoice needed');
  if (mode === 'upload' && !invoiceFileId) throw new HttpError(400, 'Upload the invoice file, or choose "Generate PDF"');
  if (mode === 'bukku') assertBukkuReady((await getOutlet(order.outlet_id)).code); // switched off / not set up → refused
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (mode === 'upload') {
    if (!String(externalNumber || '').trim()) throw new HttpError(400, 'Enter the invoice number printed on the uploaded invoice');
    if (invoiceDate && !DATE.test(invoiceDate)) throw new HttpError(400, 'Invoice date must be a date');
    if (dueDate && !DATE.test(dueDate)) throw new HttpError(400, 'Due date must be a date');
    if (invoiceDate && dueDate && dueDate < invoiceDate) throw new HttpError(400, 'The due date is before the invoice date');
    if (uploadedAmount != null && uploadedAmount !== '' && !(Number(uploadedAmount) > 0)) throw new HttpError(400, 'Amount must be greater than 0');
  }
  const customer = await customerById(order.customer_id);
  const issue = mode === 'upload' && invoiceDate ? invoiceDate : todayMYT(now);
  const year = issue.slice(0, 4);
  const outlet = await getOutlet(order.outlet_id); // each outlet is its own company with its own numbering

  const invId = await db.transaction(async () => {
    const up = mode === 'upload';
    const id = (await db.prepare(`INSERT INTO invoices (inv_number, do_number, so_id, customer_id, outlet_id, issue_date, due_date, subtotal, delivery_fee, sst_rate, sst_amount, total,
                             payment_status, source, invoice_file_id, do_file_id, issued_by, issue_method, external_number, uploaded_amount, uploaded_by, uploaded_at,
                             do_source, do_uploaded_by, do_uploaded_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'Unpaid', ?,?,?,?,?,?,?,?, ${up ? "NOW()" : 'NULL'}, ?, ?, ${doFileId ? "NOW()" : 'NULL'})`)
      .run(await nextNumber('invoices', 'inv_number', `INV-${outlet.code}-${year}-`), await nextNumber('invoices', 'do_number', `DO-${outlet.code}-${year}-`), soId, order.customer_id, outlet.id,
        issue, up && dueDate ? dueDate : dueDateFor(customer, order, issue), order.subtotal, order.delivery_fee, order.sst_rate, order.sst_amount, order.total,
        up ? 'uploaded' : 'generated', invoiceFileId, doFileId, userId, mode === 'bukku' ? 'bukku' : up ? 'uploaded' : 'generated',
        up ? String(externalNumber).trim().slice(0, 60) : null, up && uploadedAmount !== '' && uploadedAmount != null ? round2(Number(uploadedAmount)) : null, up ? userId : null,
        doFileId ? 'uploaded' : null, doFileId ? userId : null)).lastInsertRowid;
    if (invoiceFileId) await db.prepare('UPDATE files SET customer_id = ? WHERE id IN (?, ?)').run(order.customer_id, invoiceFileId, doFileId ?? -1);
    // the invoice is a separate track: the order stage does not change
    await db.prepare('INSERT INTO delivery_events (so_id, status, note) VALUES (?,?,?)').run(soId, 'Invoiced', 'Invoice issued');
    // COD slip sent with the order → attach it to this invoice
    for (const slip of await db.prepare("SELECT * FROM payment_slips WHERE so_id = ? AND status IN ('Pending','Verified')").all(soId)) {
      await db.prepare('INSERT IGNORE INTO payment_slip_invoices (slip_id, invoice_id) VALUES (?,?)').run(slip.id, id);
      await db.prepare('UPDATE invoices SET payment_status = ?, paid_at = ? WHERE id = ?')
        .run(slip.status === 'Verified' ? 'Paid' : 'Slip Uploaded', slip.status === 'Verified' ? slip.reviewed_at : null, id);
    }
    return id;
  })();

  if (mode === 'bukku') await db.prepare("UPDATE invoices SET bukku_status = 'pending' WHERE id = ?").run(invId);
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invId);
  inv.amount_mismatch = inv.uploaded_amount != null && Math.abs(inv.uploaded_amount - inv.total) > 0.005;
  await audit({ entity: 'invoice', entityId: invId, action: 'issued', userId, outletId: inv.outlet_id,
    after: { inv_number: inv.inv_number, method: inv.issue_method, external_number: inv.external_number, issue_date: inv.issue_date, due_date: inv.due_date, total: inv.total, uploaded_amount: inv.uploaded_amount } });
  await notifyCustomer(order.customer_id, 'invoice', `Invoice ${inv.inv_number} issued`, `${fmtMoney(inv.total)} for ${order.so_number} · due ${inv.due_date}`, '/portal/payments');
  await queueEmail({ to: await emailOf(customer), template: 'invoice_issued', data: { order, invoice: inv }, related: { type: 'invoice', id: invId } });
  return inv;
}

// Return the invoice / DO file, generating the PDF the first time it's needed.
// A company set to "uploaded DOs" shows a DO only once someone has uploaded it.
export async function ensureDocument(invoice, type) {
  const col = type === 'do' ? 'do_file_id' : 'invoice_file_id';
  if (invoice[col]) return await getFile(invoice[col]);
  if (type === 'do' && (await getOutlet(invoice.outlet_id))?.do_method === 'uploaded') throw new HttpError(404, 'The delivery order has not been uploaded yet');
  const order = await getOrder(invoice.so_id);
  const customer = await customerById(invoice.customer_id);
  const buffer = type === 'do' ? await renderDeliveryOrder({ invoice, order, customer }) : await renderInvoice({ invoice, order, customer });
  const fileId = await saveBuffer(buffer, { kind: type === 'do' ? 'do' : 'invoice', customerId: invoice.customer_id, name: `${type === 'do' ? invoice.do_number : invoice.inv_number}.pdf` });
  await db.prepare(`UPDATE invoices SET ${col} = ? WHERE id = ?`).run(fileId, invoice.id);
  return await getFile(fileId);
}

export const listInvoices = async (where = '1=1', params = []) => await db.prepare(`
  SELECT i.*, ${CREDITED_SQL()} AS credited, ${DEPOSITED_SQL()} AS deposited, ${BALANCE_SQL()} AS balance, c.name AS customer_name, c.code AS customer_code, c.payment_term, so.so_number, so.fulfil_date, so.method, o.code AS outlet_code,
    (SELECT ps.id FROM payment_slip_invoices psi JOIN payment_slips ps ON ps.id = psi.slip_id WHERE psi.invoice_id = i.id ORDER BY ps.id DESC LIMIT 1) AS last_slip_id,
    (SELECT ps.reject_reason FROM payment_slip_invoices psi JOIN payment_slips ps ON ps.id = psi.slip_id WHERE psi.invoice_id = i.id AND ps.status = 'Rejected' ORDER BY ps.id DESC LIMIT 1) AS last_reject_reason
  FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN sales_orders so ON so.id = i.so_id JOIN outlets o ON o.id = i.outlet_id
  WHERE ${where} ORDER BY i.issue_date DESC, i.id DESC`).all(...params);

// ---------- payment slips ----------
export async function uploadSlip({ customerId, userId, fileId, invoiceIds, reference, amount }) {
  const ids = [...new Set((Array.isArray(invoiceIds) ? invoiceIds : [invoiceIds]).map(Number).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, 'Select the invoice number(s) this slip pays');
  const invoices = await mapEach(ids, async (id) => {
    const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!inv || inv.customer_id !== customerId || inv.void) throw new HttpError(400, 'Invoice not found');
    if (inv.payment_status === 'Paid') throw new HttpError(400, `${inv.inv_number} is already paid`);
    if (inv.payment_status === 'Slip Uploaded') throw new HttpError(400, `${inv.inv_number} already has a slip waiting for verification`);
    return inv;
  });
  const amt = amount === '' || amount == null ? null : round2(Number(amount));
  if (amt != null && !(amt > 0)) throw new HttpError(400, 'Amount must be greater than 0');
  const slipId = await db.transaction(async () => {
    const id = (await db.prepare("INSERT INTO payment_slips (customer_id, file_id, reference, amount, status, uploaded_by) VALUES (?,?,?,?, 'Pending', ?)")
      .run(customerId, fileId, reference ? String(reference).slice(0, 100) : null, amt, userId)).lastInsertRowid;
    for (const inv of invoices) {
      await db.prepare('INSERT INTO payment_slip_invoices (slip_id, invoice_id) VALUES (?,?)').run(id, inv.id);
      await db.prepare("UPDATE invoices SET payment_status = 'Slip Uploaded' WHERE id = ?").run(inv.id);
    }
    return id;
  })();
  const c = await customerById(customerId);
  const total = round2((await mapEach(invoices, async (i) => (await db.prepare(`SELECT ${BALANCE_SQL('x')} AS t FROM invoices x WHERE x.id = ?`).get(i.id)).t)).reduce((a, t) => a + t, 0));
  await notifyRole('finance', c.outlet_id, 'slip', `Payment slip from ${c.name}`, `${invoices.map((i) => i.inv_number).join(', ')} · ${fmtMoney(total)}`, '/finance/payments');
  return slipId;
}

export const slipInvoices = async (slipId) => await db.prepare(`SELECT i.*, so.so_number FROM payment_slip_invoices psi JOIN invoices i ON i.id = psi.invoice_id
                                                   JOIN sales_orders so ON so.id = i.so_id WHERE psi.slip_id = ? ORDER BY i.id`).all(slipId);

async function pendingSlip(slipId, { needInvoice = true } = {}) {
  const slip = await db.prepare('SELECT * FROM payment_slips WHERE id = ?').get(slipId);
  if (!slip) throw new HttpError(404, 'Slip not found');
  if (slip.status !== 'Pending') throw new HttpError(400, `This slip was already ${slip.status.toLowerCase()}`);
  if (needInvoice && !(await slipInvoices(slipId)).some((i) => !i.void)) {
    const so = slip.so_id && await db.prepare('SELECT so_number, status FROM sales_orders WHERE id = ?').get(slip.so_id);
    throw new HttpError(400, so?.status === 'Cancelled' ? `${so.so_number} was cancelled — reject this slip and arrange a refund` : `Issue the invoice for ${so?.so_number || 'this order'} first, then verify the slip`);
  }
  return slip;
}

// What the slip's invoices still owe (after credit notes) — what Finance expects to receive
export async function slipExpected(slipId) {
  return round2((await mapEach((await slipInvoices(slipId)).filter((i) => !i.void), async (i) => (await db.prepare(`SELECT ${BALANCE_SQL('x')} AS t FROM invoices x WHERE x.id = ?`).get(i.id)).t)).reduce((a, t) => a + t, 0));
}

// Finance records what actually arrived and when, and whether it is the full payment or a DEPOSIT (part payment).
// Full: the invoices are marked Paid; a different amount is allowed but flagged (kept on the slip + audit log).
// Deposit: only for a slip on one invoice and less than what is owed — the invoice stays open with the remaining
// balance (the customer can upload another slip). Once deposits cover the whole amount the invoice is Paid.
export async function verifySlip(slipId, { userId, amountReceived, paymentDate, kind = 'full', now = new Date() }) {
  const slip = await pendingSlip(slipId);
  const invoices = await slipInvoices(slipId);
  const amt = round2(Number(amountReceived));
  if (!(amt > 0)) throw new HttpError(400, 'Enter the amount received');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate || '')) throw new HttpError(400, 'Enter the payment date shown on the bank record');
  if (paymentDate > todayMYT(now)) throw new HttpError(400, 'The payment date cannot be in the future');
  if (!['full', 'deposit'].includes(kind)) throw new HttpError(400, 'Choose full payment or deposit');
  const expected = await slipExpected(slipId);
  const paidAt = `${paymentDate} 04:00:00`; // noon in Malaysia, stored as UTC like other timestamps
  const c = await customerById(slip.customer_id);
  if (kind === 'deposit') {
    if (invoices.length !== 1) throw new HttpError(400, 'A deposit can be recorded on one invoice at a time — this slip covers several');
    if (amt >= expected - 0.005) throw new HttpError(400, `${fmtMoney(amt)} covers the full ${fmtMoney(expected)} owed — verify it as the full payment`);
    const inv = invoices[0];
    const balance = round2(expected - amt);
    await db.transaction(async () => {
      await db.prepare("UPDATE payment_slips SET status='Verified', kind='deposit', reviewed_by=?, reviewed_at=NOW(), amount_received=?, payment_date=? WHERE id=?").run(userId, amt, paymentDate, slipId);
      await db.prepare("UPDATE invoices SET payment_status='Unpaid' WHERE id=? AND payment_status <> 'Paid'").run(inv.id); // open again for the next slip
    })();
    await audit({ entity: 'payment_slip', entityId: slipId, action: 'deposit_verified', userId, outletId: c?.outlet_id,
      after: { invoice: inv.inv_number, owed_before: expected, deposit: amt, payment_date: paymentDate, balance } });
    await notifyCustomer(c.id, 'payment', 'Deposit received', `${fmtMoney(amt)} received for ${inv.inv_number}. Balance still owed: ${fmtMoney(balance)}.`, '/portal/payments');
    return { kind: 'deposit', expected, amount_received: amt, balance, mismatch: false, difference: 0 };
  }
  const mismatch = Math.abs(amt - expected) > 0.005;
  await db.transaction(async () => {
    await db.prepare("UPDATE payment_slips SET status='Verified', kind=NULL, reviewed_by=?, reviewed_at=NOW(), amount_received=?, payment_date=? WHERE id=?").run(userId, amt, paymentDate, slipId);
    for (const i of invoices) await db.prepare("UPDATE invoices SET payment_status='Paid', paid_at=? WHERE id=?").run(paidAt, i.id);
  })();
  await audit({ entity: 'payment_slip', entityId: slipId, action: 'verified', userId, outletId: c?.outlet_id,
    after: { invoices: invoices.map((i) => i.inv_number), expected, amount_received: amt, payment_date: paymentDate, mismatch } });
  await notifyCustomer(c.id, 'payment', 'Payment verified', `${invoices.map((i) => i.inv_number).join(', ')} marked as paid. Thank you!`, '/portal/payments');
  await queueEmail({ to: await emailOf(c), template: 'payment_verified', data: { customer: c, slip, invoices }, related: { type: 'payment_slip', id: slipId } });
  return { kind: 'full', expected, amount_received: amt, mismatch, difference: round2(amt - expected) };
}

export async function rejectSlip(slipId, { reason, userId }) {
  if (!String(reason || '').trim()) throw new HttpError(400, 'Give a reason so the customer knows what to fix');
  await pendingSlip(slipId, { needInvoice: false });
  const invoices = await slipInvoices(slipId);
  await db.transaction(async () => {
    await db.prepare("UPDATE payment_slips SET status='Rejected', reject_reason=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?").run(String(reason).trim(), userId, slipId);
    for (const i of invoices) await db.prepare("UPDATE invoices SET payment_status='Rejected' WHERE id=? AND payment_status='Slip Uploaded'").run(i.id);
  })();
  const slip = await db.prepare('SELECT * FROM payment_slips WHERE id = ?').get(slipId);
  await audit({ entity: 'payment_slip', entityId: slipId, action: 'rejected', userId, after: { reason: slip.reject_reason, invoices: invoices.map((i) => i.inv_number) } });
  const c = await customerById(slip.customer_id);
  const ref = invoices.length ? invoices.map((i) => i.inv_number).join(', ') : 'Your order payment';
  await notifyCustomer(c.id, 'payment', 'Payment slip rejected', `${ref}: ${slip.reject_reason}`, '/portal/payments');
  await queueEmail({ to: await emailOf(c), template: 'payment_rejected', data: { customer: c, slip, invoices }, related: { type: 'payment_slip', id: slipId } });
}

// ---------- payment terms ----------
export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export async function termStatus(customer, now = new Date()) {
  const s = await getSettings();
  const eligibleFrom = addMonths(customer.account_start_date, Number(s.credit_term_min_months));
  const pending = await db.prepare("SELECT * FROM credit_term_requests WHERE customer_id = ? AND status = 'Pending' ORDER BY id DESC LIMIT 1").get(customer.id) || null;
  const last = await db.prepare('SELECT * FROM credit_term_requests WHERE customer_id = ? ORDER BY id DESC LIMIT 1').get(customer.id) || null;
  const today = todayMYT(now);
  return {
    term: customer.payment_term,
    account_start_date: customer.account_start_date,
    eligible_from: eligibleFrom,
    can_request: customer.payment_term === 'COD' && today >= eligibleFrom && !pending,
    pending_request: pending,
    last_request: last,
  };
}

export async function requestCreditTerm(customerId, { userId, note, now = new Date() }) {
  const c = await customerById(customerId);
  const st = await termStatus(c, now);
  if (isCredit(c.payment_term)) throw new HttpError(400, `Your account is already on a ${termLabel(c.payment_term)} credit term`);
  if (st.pending_request) throw new HttpError(400, 'You already have a request waiting for review');
  if (!st.can_request) throw new HttpError(403, `Credit terms can be requested from ${st.eligible_from} (2 months after your account start date)`);
  const id = (await db.prepare("INSERT INTO credit_term_requests (customer_id, status, note) VALUES (?, 'Pending', ?)").run(customerId, note ? String(note).slice(0, 500) : null)).lastInsertRowid;
  await notifyRole('finance', c.outlet_id, 'term_request', `Credit term request: ${c.name}`, 'Requests a 14-day credit term', '/finance/terms');
  void userId;
  return id;
}

export async function decideTermRequest(requestId, { approve, note, userId }) {
  const r = await db.prepare('SELECT * FROM credit_term_requests WHERE id = ?').get(requestId);
  if (!r) throw new HttpError(404, 'Request not found');
  if (r.status !== 'Pending') throw new HttpError(400, `Request was already ${r.status.toLowerCase()}`);
  await db.transaction(async () => {
    await db.prepare("UPDATE credit_term_requests SET status=?, decided_by=?, decided_at=NOW(), decision_note=? WHERE id=?")
      .run(approve ? 'Approved' : 'Rejected', userId, note || null, requestId);
    if (approve) await db.prepare("UPDATE customers SET payment_term='NET14', term_updated_at=NOW(), term_updated_by=? WHERE id=?").run(userId, r.customer_id);
  })();
  const c = await customerById(r.customer_id);
  await notifyCustomer(c.id, 'term', approve ? '14-day credit term approved' : 'Credit term request declined', approve ? 'New invoices will be due 14 days after the invoice date.' : 'Your account remains on COD.', '/portal/account');
  await queueEmail({ to: await emailOf(c), template: 'term_result', data: { customer: c, approved: approve, note }, related: { type: 'credit_term_request', id: requestId } });
}

export async function setPaymentTerm(customerId, term, { userId }) {
  if (!TERMS[term]) throw new HttpError(400, `Term must be one of ${Object.keys(TERMS).join(', ')}`);
  const c = await customerById(customerId);
  if (!c) throw new HttpError(404, 'Customer not found');
  if (c.payment_term === term) return;
  await db.prepare("UPDATE customers SET payment_term=?, term_updated_at=NOW(), term_updated_by=? WHERE id=?").run(term, userId, customerId);
  await notifyCustomer(customerId, 'term', `Payment term changed to ${termLabel(term)}`, 'Applies to new invoices.', '/portal/account');
}

// ---------- aging ----------
export const AGING_BUCKETS = ['Not yet due', '1–30 days', '31–60 days', '61–90 days', '90+ days'];
export async function agingReport(now = new Date(), outletId = null) {
  const today = todayMYT(now);
  const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
  const invoices = (await listInvoices(`i.void = 0 AND i.payment_status <> 'Paid'${outletId ? ` AND i.outlet_id = ${Number(outletId)}` : ''}`)).map((i) => {
    const overdue = Math.max(0, daysBetween(i.due_date, today));
    const bucket = overdue === 0 ? 0 : overdue <= 30 ? 1 : overdue <= 60 ? 2 : overdue <= 90 ? 3 : 4;
    return { ...i, days_overdue: overdue, bucket: AGING_BUCKETS[bucket] };
  });
  const byCustomer = new Map();
  for (const i of invoices) {
    const row = byCustomer.get(i.customer_id) || { customer_id: i.customer_id, customer_name: i.customer_name, customer_code: i.customer_code, payment_term: i.payment_term, total: 0, invoices: 0, buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) };
    row.total = round2(row.total + i.balance);
    row.invoices += 1;
    row.buckets[i.bucket] = round2(row.buckets[i.bucket] + i.balance);
    byCustomer.set(i.customer_id, row);
  }
  return { as_of: today, buckets: AGING_BUCKETS, invoices, customers: [...byCustomer.values()].sort((a, b) => b.total - a.total) };
}

// ---------- uploaded documents: invoice file replacement, manual DO upload (history kept) ----------
// Invoice: Finance only, and only for an uploaded invoice (a generated one is rebuilt from the order).
// DO: Admin or Finance; one DO per order — a new upload replaces the current one and the old file stays in the history.
export async function uploadDocument(invoiceId, { kind, fileId, reason = '', doDate = null, user }) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.void) throw new HttpError(404, 'Invoice not found');
  if (!['invoice', 'do'].includes(kind)) throw new HttpError(400, 'Choose invoice or DO');
  if (!fileId) throw new HttpError(400, 'Attach the PDF');
  if (kind === 'invoice' && user.role !== 'finance') throw new HttpError(403, 'Only Finance can replace an invoice');
  const bukkuFallback = kind === 'invoice' && inv.issue_method === 'bukku' && inv.bukku_status !== 'sent';
  if (kind === 'invoice' && inv.source !== 'uploaded' && !bukkuFallback) throw new HttpError(400, 'Generated invoices are rebuilt from the order — only an uploaded invoice can be replaced');
  const why = String(reason || '').trim();
  const replacing = kind === 'invoice' ? !!inv.invoice_file_id && !bukkuFallback : inv.do_source === 'uploaded';
  if (replacing && !why) throw new HttpError(400, 'Give the reason for replacing it');
  if (doDate && !/^\d{4}-\d{2}-\d{2}$/.test(doDate)) throw new HttpError(400, 'DO date must be a date');
  const old = kind === 'do' ? inv.do_file_id : inv.invoice_file_id;
  await db.transaction(async () => {
    await db.prepare('INSERT INTO document_versions (invoice_id, kind, file_id, replaced_file_id, reason, user_id) VALUES (?,?,?,?,?,?)').run(inv.id, kind, fileId, old || null, why || null, user.id);
    await db.prepare('UPDATE files SET customer_id = ? WHERE id = ?').run(inv.customer_id, fileId);
    if (kind === 'do') await db.prepare("UPDATE invoices SET do_file_id = ?, do_source = 'uploaded', do_date = COALESCE(?, do_date, CURDATE()), do_uploaded_by = ?, do_uploaded_at = NOW() WHERE id = ?").run(fileId, doDate, user.id, inv.id);
    else await db.prepare(`UPDATE invoices SET invoice_file_id = ?, uploaded_by = ?, uploaded_at = NOW()${bukkuFallback ? ", source = 'uploaded', issue_method = 'uploaded', bukku_status = NULL" : ''} WHERE id = ?`).run(fileId, user.id, inv.id);
  })();
  await audit({ entity: 'invoice', entityId: inv.id, action: replacing ? `${kind}_replaced` : `${kind}_uploaded`, userId: user.id, outletId: inv.outlet_id,
    before: old ? { file_id: old } : null, after: { file_id: fileId, reason: why || null, do_date: doDate || null } });
  return await db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
}

export async function documentHistory(invoiceId) {
  return {
    versions: await db.prepare(`SELECT v.id, v.kind, v.file_id, v.replaced_file_id, v.reason, v.created_at, u.name AS user_name
                          FROM document_versions v LEFT JOIN users u ON u.id = v.user_id WHERE v.invoice_id = ? ORDER BY v.id DESC`).all(invoiceId),
    audit: await auditFor('invoice', invoiceId),
  };
}
