import { Router } from 'express';
import ExcelJS from 'exceljs';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { round2 } from '../pricing.js';
import { getOrder, blockingInvoices } from '../sales.js';
import { activeOverride, listOverrides, grantOverride, revokeOverride, MAX_OVERRIDE_DAYS } from '../overrides.js';
import { pushInvoiceToBukku, bukkuStatus, integrationLog } from '../bukku.js';
import { issueInvoice, listInvoices, verifySlip, rejectSlip, slipInvoices, slipExpected, uploadDocument, documentHistory, termStatus, decideTermRequest, setPaymentTerm, agingReport, BALANCE_SQL } from '../billing.js';
import { listPayables, recordBill, payBill, cashCycle, BILL_TERMS } from '../payables.js';
import { listCreditNotes, getCreditNote, issueCreditNote, rejectCreditNote, createCreditNote, ensureCreditNotePdf } from '../complaints.js';
import { upload, registerUpload, removeTempUploads, sendFile } from '../files.js';
import { todayMYT, addDays } from '../schedule.js';
import { outletSql, assertOutlet, listOutlets, getOutlet } from '../outlets.js';
import { termLabel } from '../terms.js';

const r = Router();

// KL and Ipoh are separate companies: every figure is also given per company, so "Both" never
// blends two sets of books into one number.
const companiesInScope = (req) => (req.outletId ? [getOutlet(req.outletId)] : listOutlets());
const only = (outletId, alias) => (outletId ? ` AND ${alias}.outlet_id = ${Number(outletId)}` : '');

function dashboardFigures(outletId) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const today = todayMYT();
  const SO = only(outletId, 'so'); const I = only(outletId, 'i'); const C = only(outletId, 'c');
  return {
    to_invoice: one(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status NOT IN ('Cancelled','Pending') AND so.replacement_for IS NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.so_id = so.id AND i.void = 0)${SO}`).n,
    slips_pending: one(`SELECT COUNT(*) AS n FROM payment_slips s JOIN customers c ON c.id = s.customer_id WHERE s.status = 'Pending'${C}`).n,
    term_requests: one(`SELECT COUNT(*) AS n FROM credit_term_requests t JOIN customers c ON c.id = t.customer_id WHERE t.status = 'Pending'${C}`).n,
    bills_to_record: one(`SELECT COUNT(*) AS n FROM purchase_orders po WHERE po.status = 'Received' AND NOT EXISTS (SELECT 1 FROM supplier_bills b WHERE b.po_id = po.id)${only(outletId, 'po')}`).n,
    bills_overdue: one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS t FROM supplier_bills b WHERE b.status = 'Unpaid' AND b.due_date < ?${only(outletId, 'b')}`, today),
    credit_notes_to_issue: one(`SELECT COUNT(*) AS n FROM credit_notes cn WHERE cn.status = 'Requested'${only(outletId, 'cn')}`).n,
    outstanding: one(`SELECT COALESCE(SUM(${BALANCE_SQL()}),0) AS t, COUNT(*) AS n FROM invoices i WHERE i.void = 0 AND i.payment_status <> 'Paid'${I}`),
    overdue: one(`SELECT COALESCE(SUM(${BALANCE_SQL()}),0) AS t, COUNT(*) AS n FROM invoices i WHERE i.void = 0 AND i.payment_status <> 'Paid' AND i.due_date < ?${I}`, today),
    paid_this_month: one(`SELECT COALESCE(SUM(total),0) AS t FROM invoices i WHERE i.payment_status = 'Paid' AND date(i.paid_at, '+8 hours') >= ?${I}`, `${today.slice(0, 7)}-01`).t,
    invoiced_this_month: one(`SELECT COALESCE(SUM(total),0) AS t FROM invoices i WHERE i.void = 0 AND i.issue_date >= ?${I}`, `${today.slice(0, 7)}-01`).t,
  };
}
const companyInfo = (o) => ({ outlet_id: o.id, code: o.code, name: o.name, company_name: o.company_name, company_reg_no: o.company_reg_no, sst_reg_no: o.sst_reg_no });

r.get('/dashboard', (req, res) => {
  res.json({ ...dashboardFigures(req.outletId), companies: companiesInScope(req).map((o) => ({ ...companyInfo(o), ...dashboardFigures(o.id) })) });
});

// ---------- monthly report per company: invoiced (with SST), collected, outstanding ----------
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };

function companyReport(o, month) {
  const from = `${month}-01`, to = monthEnd(month), today = todayMYT();
  const I = only(o.id, 'i');
  const invoices = db.prepare(`SELECT i.id, i.inv_number, i.issue_date, i.due_date, i.subtotal, i.delivery_fee, i.sst_amount, i.total, i.payment_status, i.paid_at,
                                 c.code AS customer_code, c.name AS customer_name, c.payment_term, so.so_number
                               FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN sales_orders so ON so.id = i.so_id
                               WHERE i.void = 0 AND i.issue_date BETWEEN ? AND ?${I} ORDER BY i.issue_date, i.inv_number`).all(from, to);
  const sum = (rows, k) => round2(rows.reduce((a, x) => a + x[k], 0));
  const collected = db.prepare(`SELECT COALESCE(SUM(i.total),0) AS t, COUNT(*) AS n FROM invoices i WHERE i.void = 0 AND i.payment_status = 'Paid'
                                AND date(i.paid_at, '+8 hours') BETWEEN ? AND ?${I}`).get(from, to);
  const open = db.prepare(`SELECT COALESCE(SUM(${BALANCE_SQL()}),0) AS t, COUNT(*) AS n, COALESCE(SUM(CASE WHEN i.due_date < ? THEN ${BALANCE_SQL()} END),0) AS overdue
                           FROM invoices i WHERE i.void = 0 AND i.payment_status <> 'Paid'${I}`).get(today);
  // credit notes issued in the month (they reduce sales and output SST for the month they are issued)
  const creditNotes = db.prepare(`SELECT cn.cn_number, cn.issue_date, cn.subtotal, cn.sst_amount, cn.total, cn.reason, cn.settlement, i.inv_number, c.code AS customer_code, c.name AS customer_name
                                  FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id JOIN customers c ON c.id = cn.customer_id
                                  WHERE cn.status = 'Issued' AND cn.issue_date BETWEEN ? AND ?${only(o.id, 'cn')} ORDER BY cn.issue_date, cn.cn_number`).all(from, to);
  const byCustomer = new Map();
  for (const i of invoices) {
    const c = byCustomer.get(i.customer_code) || { customer_code: i.customer_code, customer_name: i.customer_name, payment_term: i.payment_term, invoices: 0, total: 0, paid: 0, unpaid: 0 };
    c.invoices += 1; c.total = round2(c.total + i.total);
    if (i.payment_status === 'Paid') c.paid = round2(c.paid + i.total); else c.unpaid = round2(c.unpaid + i.total);
    byCustomer.set(i.customer_code, c);
  }
  const trend = [];
  for (let k = 5; k >= 0; k--) {
    const m = shiftMonth(month, -k), f = `${m}-01`, t = monthEnd(m);
    const inv = db.prepare(`SELECT COALESCE(SUM(i.total),0) AS total, COALESCE(SUM(i.sst_amount),0) AS sst, COUNT(*) AS n FROM invoices i WHERE i.void = 0 AND i.issue_date BETWEEN ? AND ?${I}`).get(f, t);
    const col = db.prepare(`SELECT COALESCE(SUM(i.total),0) AS t FROM invoices i WHERE i.void = 0 AND i.payment_status = 'Paid' AND date(i.paid_at, '+8 hours') BETWEEN ? AND ?${I}`).get(f, t).t;
    trend.push({ month: m, invoices: inv.n, invoiced: round2(inv.total), sst: round2(inv.sst), collected: round2(col) });
  }
  return {
    ...companyInfo(o), month, from, to,
    invoiced: { count: invoices.length, subtotal: sum(invoices, 'subtotal'), delivery_fee: sum(invoices, 'delivery_fee'), sst: sum(invoices, 'sst_amount'), total: sum(invoices, 'total') },
    credit_notes: { count: creditNotes.length, subtotal: sum(creditNotes, 'subtotal'), sst: sum(creditNotes, 'sst_amount'), total: sum(creditNotes, 'total'), list: creditNotes },
    net: { sst: round2(sum(invoices, 'sst_amount') - sum(creditNotes, 'sst_amount')), total: round2(sum(invoices, 'total') - sum(creditNotes, 'total')) },
    collected: { count: collected.n, total: round2(collected.t) },
    outstanding_now: { count: open.n, total: round2(open.t), overdue: round2(open.overdue) },
    customers: [...byCustomer.values()].sort((a, b) => b.total - a.total),
    trend, invoices,
  };
}
const reportMonth = (q) => (MONTH.test(q.month || '') ? q.month : todayMYT().slice(0, 7));

// ---------- statistics (graphs) per company: never summed across KL and Ipoh ----------
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
function companyStats(o, months) {
  const today = todayMYT();
  const thisMonth = today.slice(0, 7);
  const first = shiftMonth(thisMonth, -(months - 1));
  const from = `${first}-01`;
  const I = only(o.id, 'i');
  const monthsList = Array.from({ length: months }, (_, k) => shiftMonth(first, k));
  const blank = () => Object.fromEntries(monthsList.map((m) => [m, 0]));

  const inv = db.prepare(`SELECT i.id, i.issue_date, i.due_date, i.total, i.sst_amount, i.payment_status, date(i.paid_at, '+8 hours') AS paid_day, c.payment_term, c.name AS customer_name
                          FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.void = 0 AND i.issue_date >= ?${I}`).all(from);
  const paid = db.prepare(`SELECT i.issue_date, i.due_date, i.total, date(i.paid_at, '+8 hours') AS paid_day, c.payment_term FROM invoices i JOIN customers c ON c.id = i.customer_id
                           WHERE i.void = 0 AND i.payment_status = 'Paid' AND date(i.paid_at, '+8 hours') >= ?${I}`).all(from);
  const cns = db.prepare(`SELECT cn.issue_date, cn.total FROM credit_notes cn WHERE cn.status = 'Issued' AND cn.issue_date >= ?${only(o.id, 'cn')}`).all(from);

  const invoiced = blank(), collected = blank(), credited = blank(), count = blank();
  for (const x of inv) { const m = x.issue_date.slice(0, 7); if (m in invoiced) { invoiced[m] += x.total; count[m] += 1; } }
  for (const x of paid) { const m = x.paid_day.slice(0, 7); if (m in collected) collected[m] += x.total; }
  for (const x of cns) { const m = x.issue_date.slice(0, 7); if (m in credited) credited[m] += x.total; }

  // payment speed — credit-term customers only (COD pays with the order)
  const speed = Object.fromEntries(monthsList.map((m) => [m, { days: 0, n: 0, onTime: 0 }]));
  for (const x of paid.filter((p) => p.payment_term !== 'COD')) {
    const s = speed[x.paid_day.slice(0, 7)]; if (!s) continue;
    s.days += Math.max(0, dayDiff(x.issue_date, x.paid_day)); s.n += 1; if (x.paid_day <= x.due_date) s.onTime += 1;
  }
  const credit = paid.filter((p) => p.payment_term !== 'COD');
  const avgDays = credit.length ? round2(credit.reduce((a, x) => a + Math.max(0, dayDiff(x.issue_date, x.paid_day)), 0) / credit.length) : null;
  const onTimeRate = credit.length ? round2((credit.filter((x) => x.paid_day <= x.due_date).length / credit.length) * 100) : null;

  const by = (rows, key, val) => { const m = new Map(); for (const r of rows) m.set(r[key], round2((m.get(r[key]) || 0) + val(r))); return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value); };
  const aging = agingReport(new Date(), o.id);
  const totInvoiced = round2(inv.reduce((a, x) => a + x.total, 0));
  const totCollected = round2(paid.reduce((a, x) => a + x.total, 0));
  return {
    ...companyInfo(o), months, from, to: today, current_month: thisMonth,
    totals: {
      invoiced: totInvoiced, invoices: inv.length, collected: totCollected, credit_notes: round2(cns.reduce((a, x) => a + x.total, 0)),
      sst: round2(inv.reduce((a, x) => a + x.sst_amount, 0)), avg_invoice: inv.length ? round2(totInvoiced / inv.length) : 0,
      outstanding: round2(aging.customers.reduce((a, c) => a + c.total, 0)),
      overdue: round2(aging.invoices.filter((i) => i.days_overdue > 0).reduce((a, i) => a + i.balance, 0)),
      avg_days_to_pay: avgDays, on_time_rate: onTimeRate, credit_paid_count: credit.length,
    },
    monthly: monthsList.map((m) => ({
      month: m, invoiced: round2(invoiced[m]), collected: round2(collected[m]), credit_notes: round2(credited[m]), invoices: count[m],
      avg_days_to_pay: speed[m].n ? round2(speed[m].days / speed[m].n) : null, on_time_rate: speed[m].n ? round2((speed[m].onTime / speed[m].n) * 100) : null, paid_count: speed[m].n,
    })),
    aging: aging.buckets.map((b) => ({ label: b, value: round2(aging.invoices.filter((i) => i.bucket === b).reduce((a, i) => a + i.balance, 0)), count: aging.invoices.filter((i) => i.bucket === b).length })),
    top_customers: by(inv, 'customer_name', (x) => x.total).slice(0, 8),
    outstanding_customers: aging.customers.slice(0, 8).map((c) => ({ label: c.customer_name, value: c.total, count: c.invoices })),
    by_term: by(inv, 'payment_term', (x) => x.total),
  };
}
r.get('/statistics', (req, res) => {
  const months = [3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 6;
  res.json({ months, companies: companiesInScope(req).map((o) => companyStats(o, months)) });
});

r.get('/reports', (req, res) => {
  const month = reportMonth(req.query);
  res.json({ month, companies: companiesInScope(req).map((o) => companyReport(o, month)) });
});

r.get('/reports/download', async (req, res) => {
  const month = reportMonth(req.query);
  const reports = companiesInScope(req).map((o) => companyReport(o, month));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP Portal';
  const money = (col) => { col.numFmt = '#,##0.00'; };
  for (const c of reports) {
    // one pair of sheets per company — they file separate SST returns
    const s = wb.addWorksheet(`${c.code} summary`);
    s.addRow([c.company_name]).font = { bold: true, size: 13 };
    s.addRow([`Reg. ${c.company_reg_no || '—'} · SST ${c.sst_reg_no || '—'}`]);
    s.addRow([`Finance report for ${month} (${c.from} to ${c.to})`]);
    s.addRow([]);
    s.addRow(['Invoiced', 'Invoices', 'Subtotal (RM)', 'Delivery (RM)', 'SST (RM)', 'Total (RM)']).font = { bold: true };
    s.addRow(['', c.invoiced.count, c.invoiced.subtotal, c.invoiced.delivery_fee, c.invoiced.sst, c.invoiced.total]);
    s.addRow(['Credit notes', c.credit_notes.count, c.credit_notes.subtotal, '', c.credit_notes.sst, c.credit_notes.total]);
    s.addRow(['Net after credit notes', '', '', '', c.net.sst, c.net.total]).font = { bold: true };
    s.addRow([]);
    s.addRow(['Collected in month (RM)', c.collected.total, '', 'Outstanding today (RM)', c.outstanding_now.total, `of which overdue ${c.outstanding_now.overdue.toFixed(2)}`]);
    s.addRow([]);
    s.addRow(['Customer', 'Term', 'Invoices', 'Invoiced (RM)', 'Paid (RM)', 'Unpaid (RM)']).font = { bold: true };
    c.customers.forEach((x) => s.addRow([x.customer_name, x.payment_term, x.invoices, x.total, x.paid, x.unpaid]));
    s.addRow([]);
    s.addRow(['Month', 'Invoices', 'Invoiced (RM)', 'SST (RM)', 'Collected (RM)']).font = { bold: true };
    c.trend.forEach((t) => s.addRow([t.month, t.invoices, t.invoiced, t.sst, t.collected]));
    s.columns.forEach((col, i) => { col.width = i === 0 ? 30 : 16; if (i >= 2) money(col); });
    const d = wb.addWorksheet(`${c.code} invoices`);
    d.addRow(['Invoice', 'Order', 'Issued', 'Due', 'Customer code', 'Customer', 'Subtotal', 'Delivery', 'SST', 'Total', 'Status']).font = { bold: true };
    c.invoices.forEach((i) => d.addRow([i.inv_number, i.so_number, i.issue_date, i.due_date, i.customer_code, i.customer_name, i.subtotal, i.delivery_fee, i.sst_amount, i.total, i.payment_status]));
    d.columns.forEach((col, i) => { col.width = [20, 20, 12, 12, 13, 30, 12, 11, 11, 12, 14][i]; if (i >= 6 && i <= 9) money(col); });
    const cnSheet = wb.addWorksheet(`${c.code} credit notes`);
    cnSheet.addRow(['Credit note', 'Issued', 'Invoice', 'Customer code', 'Customer', 'Subtotal', 'SST', 'Total', 'Reason', 'Settlement']).font = { bold: true };
    c.credit_notes.list.forEach((x) => cnSheet.addRow([x.cn_number, x.issue_date, x.inv_number, x.customer_code, x.customer_name, x.subtotal, x.sst_amount, x.total, x.reason, x.settlement]));
    cnSheet.columns.forEach((col, i) => { col.width = [20, 12, 20, 13, 30, 12, 11, 12, 40, 30][i]; if (i >= 5 && i <= 7) money(col); });
  }
  const tag = reports.length === 1 ? `-${reports[0].code.toLowerCase()}` : '-kl-and-ipoh';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="finance-report${tag}-${month}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

// ---------- invoicing ----------
r.get('/orders-to-invoice', (req, res) => {
  res.json(db.prepare(`SELECT so.id, so.so_number, so.order_date, so.confirmed_at, so.method, so.fulfil_date, so.subtotal, so.delivery_fee, so.sst_amount, so.total,
                         so.status, so.order_date, c.name AS customer_name, c.payment_term, o.code AS outlet_code,
                         (SELECT ps.status FROM payment_slips ps WHERE ps.so_id = so.id ORDER BY ps.id DESC LIMIT 1) AS slip_status
                       FROM sales_orders so JOIN customers c ON c.id = so.customer_id JOIN outlets o ON o.id = so.outlet_id
                       WHERE so.status NOT IN ('Cancelled','Pending') AND so.replacement_for IS NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.so_id = so.id AND i.void = 0)${outletSql(req, 'so')}
                       ORDER BY so.order_date, so.id`).all());
});

r.get('/orders/:id', (req, res) => {
  const so = getOrder(req.params.id);
  if (!so) throw new HttpError(404, 'Order not found');
  assertOutlet(req, so.outlet_id);
  const o = getOutlet(so.outlet_id);
  res.json({ ...so, invoice_method: o.invoice_method || 'generated', do_method: o.do_method || 'generated', bukku: bukkuStatus()[o.code] });
});

// multipart: mode=generate|upload, files invoice_file (required for upload), do_file (optional — generated if missing)
r.post('/orders/:id/invoice', upload.fields([{ name: 'invoice_file', maxCount: 1 }, { name: 'do_file', maxCount: 1 }]), async (req, res) => {
  try {
    const so = db.prepare('SELECT customer_id, outlet_id FROM sales_orders WHERE id = ?').get(req.params.id);
    if (!so) throw new HttpError(404, 'Order not found');
    assertOutlet(req, so.outlet_id);
    const mode = ['upload', 'bukku'].includes(req.body.mode) ? req.body.mode : 'generate';
    let invoiceFileId = null; let doFileId = null;
    if (mode === 'upload') {
      const inv = req.files?.invoice_file?.[0];
      if (!inv) throw new HttpError(400, 'Attach the invoice file');
      invoiceFileId = registerUpload(inv, { kind: 'invoice', customerId: so.customer_id, userId: req.user.id });
      const doF = req.files?.do_file?.[0];
      if (doF) doFileId = registerUpload(doF, { kind: 'do', customerId: so.customer_id, userId: req.user.id });
    } else removeTempUploads(req);
    const inv = issueInvoice(Number(req.params.id), { mode, invoiceFileId, doFileId, userId: req.user.id,
      externalNumber: req.body.external_number, invoiceDate: req.body.invoice_date || null, dueDate: req.body.due_date || null, uploadedAmount: req.body.amount ?? null });
    // Bukku: send now; a failure is logged + Finance alerted, the invoice stays (retry or upload instead)
    if (mode === 'bukku') Object.assign(inv, await pushInvoiceToBukku(inv.id, { userId: req.user.id }));
    res.status(201).json(inv);
  } catch (e) { removeTempUploads(req); throw e; }
});
r.post('/invoices/:id/bukku/retry', async (req, res) => { invoiceInScope(req, req.params.id); res.json(await pushInvoiceToBukku(Number(req.params.id), { userId: req.user.id })); });
r.get('/integration-log', (req, res) => res.json({ status: bukkuStatus(), log: integrationLog(req.outletId || null) }));

r.get('/invoices', (req, res) => {
  const { payment_status, q } = req.query;
  let where = `i.void = 0${outletSql(req, 'i')}`; const p = [];
  if (['failed', 'pending', 'sent'].includes(req.query.bukku)) { where += ' AND i.bukku_status = ?'; p.push(req.query.bukku); }
  if (payment_status === 'Outstanding') where += " AND i.payment_status <> 'Paid'";
  else if (payment_status) { where += ' AND i.payment_status = ?'; p.push(payment_status); }
  if (q) { where += ' AND (i.inv_number LIKE ? OR c.name LIKE ? OR so.so_number LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(listInvoices(where, p));
});

// ---------- payment verification ----------
r.get('/slips', (req, res) => {
  const status = req.query.status || 'Pending';
  const slips = db.prepare(`SELECT s.*, c.name AS customer_name, c.code AS customer_code, f.mime, f.original_name, u.name AS reviewed_by_name,
                              so.so_number, so.status AS order_status, so.total AS order_total, o.code AS outlet_code
                            FROM payment_slips s JOIN customers c ON c.id = s.customer_id JOIN files f ON f.id = s.file_id
                            JOIN outlets o ON o.id = c.outlet_id
                            LEFT JOIN users u ON u.id = s.reviewed_by LEFT JOIN sales_orders so ON so.id = s.so_id
                            WHERE (? = 'All' OR s.status = ?)${outletSql(req, 'c')} ORDER BY s.id ${status === 'Pending' ? 'ASC' : 'DESC'} LIMIT 200`).all(status, status);
  res.json(slips.map((s) => {
    const invoices = slipInvoices(s.id);
    // expected = still owed after credit notes; compared with the amount Finance records as received
    return { ...s, invoices, invoices_total: round2(invoices.reduce((a, i) => a + i.total, 0)), expected: invoices.length ? slipExpected(s.id) : null };
  }));
});
const slipInScope = (req, id) => {
  const s = db.prepare('SELECT c.outlet_id FROM payment_slips s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?').get(id);
  if (!s) throw new HttpError(404, 'Slip not found');
  assertOutlet(req, s.outlet_id);
};
r.post('/slips/:id/verify', (req, res) => {
  slipInScope(req, req.params.id);
  res.json({ ok: true, ...verifySlip(Number(req.params.id), { userId: req.user.id, amountReceived: req.body?.amount_received, paymentDate: req.body?.payment_date }) });
});
r.post('/slips/:id/reject', (req, res) => { slipInScope(req, req.params.id); rejectSlip(Number(req.params.id), { reason: req.body.reason, userId: req.user.id }); res.json({ ok: true }); });

// ---------- payment terms ----------
r.get('/customers', (req, res) => {
  const today = todayMYT();
  const rows = db.prepare(`SELECT c.*, o.code AS outlet_code,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.customer_id = c.id AND i.void = 0 AND i.payment_status <> 'Paid') AS outstanding,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.customer_id = c.id AND i.void = 0 AND i.payment_status <> 'Paid' AND i.due_date < ?) AS overdue
    FROM customers c JOIN outlets o ON o.id = c.outlet_id WHERE 1=1${outletSql(req, 'c')} ORDER BY c.is_demo, c.name`).all(today);
  res.json(rows.map((c) => {
    const t = termStatus(c);
    const days = Math.floor((new Date(`${today}T00:00:00Z`) - new Date(`${c.account_start_date}T00:00:00Z`)) / 864e5);
    return { ...c, term_label: termLabel(c.payment_term), account_age_days: days, eligible_from: t.eligible_from, pending_request: t.pending_request };
  }));
});
r.post('/customers/:id/term', (req, res) => {
  const c = db.prepare('SELECT outlet_id FROM customers WHERE id = ?').get(req.params.id);
  if (!c) throw new HttpError(404, 'Customer not found');
  assertOutlet(req, c.outlet_id); setPaymentTerm(Number(req.params.id), req.body.term, { userId: req.user.id }); res.json({ ok: true }); });

// ---------- order block & Finance overrides ----------
// Blocked customers (unpaid COD / overdue credit-term invoices). The block lifts when Finance verifies enough
// payment — or Finance grants an override (reason + expiry date or one order), recorded in the audit log.
const customerInScope = (req, id) => {
  const c = db.prepare('SELECT id, name, code, outlet_id, payment_term FROM customers WHERE id = ?').get(id);
  if (!c) throw new HttpError(404, 'Customer not found');
  assertOutlet(req, c.outlet_id);
  return c;
};
r.get('/blocked', (req, res) => {
  const rows = db.prepare(`SELECT DISTINCT c.id, c.name, c.code, c.payment_term, o.code AS outlet_code FROM customers c JOIN outlets o ON o.id = c.outlet_id
                           JOIN invoices i ON i.customer_id = c.id AND i.void = 0 AND i.payment_status <> 'Paid' WHERE 1=1${outletSql(req, 'c')} ORDER BY c.name`).all();
  res.json({
    max_days: MAX_OVERRIDE_DAYS,
    customers: rows.map((c) => ({ ...c, term_label: termLabel(c.payment_term), blocking: blockingInvoices(c.id), override: activeOverride(c.id), history: listOverrides(c.id).slice(0, 5) }))
      .filter((c) => c.blocking.length || c.override),
  });
});
r.post('/customers/:id/override', (req, res) => {
  customerInScope(req, Number(req.params.id));
  const b = req.body || {};
  res.status(201).json(grantOverride(Number(req.params.id), { reason: b.reason, expiresOn: b.expires_on, singleOrder: !!b.single_order, userId: req.user.id }));
});
r.post('/overrides/:id/revoke', (req, res) => {
  const o = db.prepare('SELECT customer_id FROM block_overrides WHERE id = ?').get(req.params.id);
  if (!o) throw new HttpError(404, 'Override not found');
  customerInScope(req, o.customer_id);
  revokeOverride(Number(req.params.id), { userId: req.user.id });
  res.json({ ok: true });
});

r.get('/term-requests', (req, res) => {
  const status = req.query.status || 'Pending';
  res.json(db.prepare(`SELECT t.*, c.name AS customer_name, c.code AS customer_code, c.account_start_date, c.payment_term, u.name AS decided_by_name,
      (SELECT COALESCE(SUM(total),0) FROM invoices i WHERE i.customer_id = c.id AND i.void = 0 AND i.payment_status <> 'Paid') AS outstanding,
      (SELECT COUNT(*) FROM sales_orders so WHERE so.customer_id = c.id AND so.status <> 'Cancelled') AS order_count
    FROM credit_term_requests t JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.decided_by
    WHERE (? = 'All' OR t.status = ?)${outletSql(req, 'c')} ORDER BY t.id DESC`).all(status, status));
});
const reqInScope = (req, id) => {
  const t = db.prepare('SELECT c.outlet_id FROM credit_term_requests t JOIN customers c ON c.id = t.customer_id WHERE t.id = ?').get(id);
  if (!t) throw new HttpError(404, 'Request not found');
  assertOutlet(req, t.outlet_id);
};
r.post('/term-requests/:id/approve', (req, res) => { reqInScope(req, req.params.id); decideTermRequest(Number(req.params.id), { approve: true, note: req.body.note, userId: req.user.id }); res.json({ ok: true }); });
r.post('/term-requests/:id/reject', (req, res) => { reqInScope(req, req.params.id); decideTermRequest(Number(req.params.id), { approve: false, note: req.body.note, userId: req.user.id }); res.json({ ok: true }); });

// ---------- aging report ----------
// ---------- credit notes ----------
const cnInScope = (req, id) => {
  const cn = getCreditNote(Number(id));
  if (!cn) throw new HttpError(404, 'Credit note not found');
  assertOutlet(req, cn.outlet_id);
  return cn;
};
r.get('/credit-notes', (req, res) => {
  const status = ['Requested', 'Issued', 'Rejected'].includes(req.query.status) ? req.query.status : null;
  res.json(listCreditNotes(`${status ? 'cn.status = ?' : '1=1'}${outletSql(req, 'cn')}`, status ? [status] : []));
});
r.post('/credit-notes', (req, res) => {
  const inv = db.prepare('SELECT outlet_id FROM invoices WHERE id = ?').get(Number(req.body.invoice_id));
  if (!inv) throw new HttpError(404, 'Invoice not found');
  assertOutlet(req, inv.outlet_id);
  res.status(201).json(createCreditNote({ invoiceId: Number(req.body.invoice_id), items: req.body.items, reason: req.body.reason, userId: req.user.id }));
});
r.post('/credit-notes/:id/issue', (req, res) => {
  cnInScope(req, req.params.id);
  res.json(issueCreditNote(Number(req.params.id), { items: req.body.items, reason: req.body.reason, userId: req.user.id }));
});
r.post('/credit-notes/:id/reject', (req, res) => {
  cnInScope(req, req.params.id);
  rejectCreditNote(Number(req.params.id), { reason: req.body.reason, userId: req.user.id });
  res.json({ ok: true });
});
r.get('/credit-notes/:id/pdf', async (req, res) => {
  const cn = cnInScope(req, req.params.id);
  if (cn.status !== 'Issued') throw new HttpError(400, 'Only issued credit notes have a PDF');
  sendFile(res, await ensureCreditNotePdf(cn), req.query.download === '1');
});

// ---------- payables (supplier bills) ----------
r.get('/payables', (req, res) => res.json({ terms: BILL_TERMS, ...listPayables(req.outletId) }));
r.post('/payables/:poId/bill', (req, res) => {
  const po = db.prepare('SELECT outlet_id FROM purchase_orders WHERE id = ?').get(req.params.poId);
  if (!po) throw new HttpError(404, 'Purchase order not found');
  assertOutlet(req, po.outlet_id);
  const b = req.body;
  res.status(201).json(recordBill(Number(req.params.poId), { billNumber: b.bill_number, billDate: b.bill_date, termDays: b.term_days, amount: b.amount, userId: req.user.id }));
});
r.post('/bills/:id/pay', (req, res) => {
  const b = db.prepare('SELECT outlet_id FROM supplier_bills WHERE id = ?').get(req.params.id);
  if (!b) throw new HttpError(404, 'Bill not found');
  assertOutlet(req, b.outlet_id);
  payBill(Number(req.params.id), { paidDate: req.body.paid_date, reference: req.body.reference, userId: req.user.id });
  res.json({ ok: true });
});

// ---------- cash conversion cycle (per company) ----------
r.get('/cash-cycle', (req, res) => {
  const months = [3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 6;
  res.json({ months, companies: companiesInScope(req).map((o) => ({ ...companyInfo(o), ...cashCycle(o.id, months) })) });
});

r.get('/aging', (req, res) => res.json(agingReport(new Date(), req.outletId)));

r.get('/aging/download', async (req, res) => {
  const a = agingReport(new Date(), req.outletId);
  // optional ?customer= (partial company name) — same filter as the screen
  const cf = String(req.query.customer || '').trim().toLowerCase();
  if (cf) { a.invoices = a.invoices.filter((i) => i.customer_name.toLowerCase().includes(cf)); a.customers = a.customers.filter((c) => c.customer_name.toLowerCase().includes(cf)); }
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const invoiceRows = a.invoices.map((i) => [i.outlet_code, i.customer_code, i.customer_name, i.payment_term, i.inv_number, i.so_number, i.issue_date, i.due_date, i.days_overdue, i.bucket, i.payment_status, i.balance]);
  const invoiceHead = ['Company', 'Customer code', 'Customer', 'Term', 'Invoice', 'Order', 'Issued', 'Due', 'Days overdue', 'Bucket', 'Payment status', 'Amount due (RM)'];
  const companies = companiesInScope(req);
  const name = `aging-report${companies.length === 1 ? `-${companies[0].code.toLowerCase()}` : '-kl-and-ipoh'}-${a.as_of}`;

  if (format === 'csv') {
    const cell = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
    const csv = [`Aging report as of ${a.as_of}`, '', invoiceHead.map(cell).join(','), ...invoiceRows.map((r2) => r2.map(cell).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send('﻿' + csv);
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP Portal';
  // separate sheets per company (separate books)
  for (const o of companies) {
    const ids = new Set(a.invoices.filter((i) => i.outlet_id === o.id).map((i) => i.customer_id));
    const sum = wb.addWorksheet(`${o.code} by customer`);
    sum.addRow([`${o.company_name} — aging report as of ${a.as_of}`]).font = { bold: true, size: 13 };
    sum.addRow([]);
    sum.addRow(['Customer', 'Term', 'Invoices', ...a.buckets, 'Total (RM)']).font = { bold: true };
    for (const c of a.customers.filter((x) => ids.has(x.customer_id))) sum.addRow([c.customer_name, c.payment_term, c.invoices, ...a.buckets.map((b) => c.buckets[b]), c.total]);
    sum.columns.forEach((col, i) => { col.width = i === 0 ? 28 : 14; if (i >= 3) col.numFmt = '#,##0.00'; });
    const det = wb.addWorksheet(`${o.code} invoices`);
    det.addRow(invoiceHead).font = { bold: true };
    invoiceRows.filter((r2) => r2[0] === o.code).forEach((r2) => det.addRow(r2));
    det.columns.forEach((col, i) => { col.width = [9, 12, 28, 8, 20, 20, 12, 12, 12, 13, 15, 13][i]; });
    det.getColumn(12).numFmt = '#,##0.00';
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
});

// ---------- invoice / DO documents: upload, replace, history ----------
const invoiceInScope = (req, id) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  assertOutlet(req, inv.outlet_id);
  return inv;
};
r.get('/invoices/:id/documents', (req, res) => { invoiceInScope(req, req.params.id); res.json(documentHistory(Number(req.params.id))); });
r.post('/invoices/:id/documents', upload.single('file'), (req, res) => {
  try {
    const inv = invoiceInScope(req, req.params.id);
    if (!req.file) throw new HttpError(400, 'Attach the PDF');
    const kind = req.body.kind === 'do' ? 'do' : 'invoice';
    const fileId = registerUpload(req.file, { kind, customerId: inv.customer_id, userId: req.user.id });
    res.json(uploadDocument(inv.id, { kind, fileId, reason: req.body.reason, doDate: req.body.do_date || null, user: req.user }));
  } catch (e) { removeTempUploads(req); throw e; }
});

// ---------- collection: what's due and overdue, follow-up notes, payment history ----------
// Shown per company alongside the aging report. Buckets use the amount still owed after credit notes.
const COLLECTION_BUCKETS = [['due_today', 'Due today'], ['due_7', 'Due within 7 days'], ['over_1_7', 'Overdue 1–7 days'], ['over_8_14', 'Overdue 8–14 days'], ['over_15', 'Overdue more than 14 days']];
r.get('/collection', (req, res) => {
  const today = todayMYT();
  const companies = (req.outletId ? [getOutlet(req.outletId)] : listOutlets()).map((o) => {
    const rows = db.prepare(`SELECT i.id, i.inv_number, i.issue_date, i.due_date, i.payment_status, ${BALANCE_SQL('i')} AS balance,
        c.id AS customer_id, c.name AS customer_name, c.code AS customer_code, c.phone AS customer_phone, c.payment_term,
        (SELECT n.contact_date || ' · ' || COALESCE(n.contact,'') || CASE WHEN n.promised_date IS NOT NULL THEN ' · promised ' || n.promised_date ELSE '' END
           FROM collection_notes n WHERE n.customer_id = c.id ORDER BY n.id DESC LIMIT 1) AS last_note
      FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.void = 0 AND i.payment_status <> 'Paid' AND i.outlet_id = ? AND i.due_date <= ? ORDER BY i.due_date, c.name`).all(o.id, addDays(today, 7))
      .filter((r) => r.balance > 0.005)
      .map((r) => {
        const late = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.due_date}T00:00:00Z`)) / 864e5);
        const bucket = late <= -1 ? 'due_7' : late === 0 ? 'due_today' : late <= 7 ? 'over_1_7' : late <= 14 ? 'over_8_14' : 'over_15';
        return { ...r, days_late: late, bucket };
      });
    return {
      code: o.code, company_name: o.company_name,
      buckets: COLLECTION_BUCKETS.map(([k, label]) => { const list = rows.filter((x) => x.bucket === k); return { key: k, label, count: list.length, total: round2(list.reduce((a, x) => a + x.balance, 0)), invoices: list }; }),
    };
  });
  res.json({ today, companies });
});
r.get('/customers/:id/collection', (req, res) => {
  const c = customerInScope(req, Number(req.params.id));
  res.json({
    customer: c,
    notes: db.prepare('SELECT n.*, u.name AS user_name FROM collection_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.customer_id = ? ORDER BY n.contact_date DESC, n.id DESC').all(c.id),
    payments: db.prepare(`SELECT s.id, s.status, s.reference, s.amount, s.amount_received, s.payment_date, s.reject_reason, s.created_at, s.reviewed_at, u.name AS reviewed_by_name,
        (SELECT GROUP_CONCAT(i.inv_number, ', ') FROM payment_slip_invoices psi JOIN invoices i ON i.id = psi.invoice_id WHERE psi.slip_id = s.id) AS invoices
      FROM payment_slips s LEFT JOIN users u ON u.id = s.reviewed_by WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 50`).all(c.id),
  });
});
r.post('/customers/:id/notes', (req, res) => {
  const c = customerInScope(req, Number(req.params.id));
  const b = req.body || {};
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const contactDate = b.contact_date || todayMYT();
  if (!DATE.test(contactDate)) throw new HttpError(400, 'Contact date must be a date');
  if (b.promised_date && !DATE.test(b.promised_date)) throw new HttpError(400, 'Promised payment date must be a date');
  if (!String(b.contact || '').trim() && !String(b.remarks || '').trim()) throw new HttpError(400, 'Say who you spoke to or add a remark');
  const id = db.prepare('INSERT INTO collection_notes (customer_id, outlet_id, contact_date, contact, promised_date, remarks, user_id) VALUES (?,?,?,?,?,?,?)')
    .run(c.id, c.outlet_id, contactDate, String(b.contact || '').trim().slice(0, 200) || null, b.promised_date || null, String(b.remarks || '').trim().slice(0, 1000) || null, req.user.id).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM collection_notes WHERE id = ?').get(id));
});

export default r;
