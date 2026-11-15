import { Router } from 'express';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { getOutlet, bankOf, pricingFor } from '../outlets.js';
import { termLabel } from '../terms.js';
import { orderWindow, todayMYT } from '../schedule.js';
import { listCreditNotes } from '../complaints.js';
import { createOrder, cancelOrder, getOrder, receiveOrder, blockingInvoices, registeredAddress } from '../sales.js';
import { listInvoices, uploadSlip, slipInvoices, termStatus, requestCreditTerm } from '../billing.js';
import { upload, registerUpload, removeTempUploads } from '../files.js';
import { activeOverride } from '../overrides.js';

// Customer portal API — every query is scoped to req.user.customer_id
const r = Router();
const me = (req) => db.prepare('SELECT * FROM customers WHERE id = ?').get(req.user.customer_id);
export const productImageUrl = (fileId) => (fileId ? `/api/public/product-images/${fileId}` : null);

r.get('/profile', (req, res) => {
  const c = me(req);
  const o = getOutlet(c.outlet_id);
  res.json({ ...c, registered_address: registeredAddress(c), outlet_name: o.name, outlet_company: o.company_name, term_label: termLabel(c.payment_term), terms: termStatus(c) });
});

// Catalog: no stock levels at all — only what a buyer needs
r.get('/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE is_sellable = 1 ORDER BY id').all();
  res.json(rows.map((p) => ({
    id: p.id, sku: p.sku, name: p.name, category: p.category, category_note: p.notes, uom: p.uom,
    size: p.size, moq: p.moq, rsp: p.recommended_rsp, shelf_life: p.shelf_life,
    storage_notes: p.storage_notes, heating_notes: p.heating_notes,
    price: p.sell_price, available: !!p.is_available, image_url: productImageUrl(p.image_file_id),
  })));
});

r.get('/announcements', (req, res) => {
  const today = todayMYT();
  // announcements for this customer's outlet, plus ones for both outlets
  res.json(db.prepare('SELECT id, title, body, type, starts_on, ends_on, closure_from, closure_to FROM announcements WHERE starts_on <= ? AND ends_on >= ? AND (outlet_id IS NULL OR outlet_id = ?) ORDER BY starts_on DESC').all(today, today, req.outletId));
});

// Everything the checkout needs in one call
r.get('/checkout-info', (req, res) => {
  const o = getOutlet(req.outletId); // the customer's home outlet
  const s = pricingFor(o.id);
  const blocking = blockingInvoices(req.user.customer_id);
  const override = blocking.length ? activeOverride(req.user.customer_id) : null;
  res.json({
    outlet: { id: o.id, code: o.code, name: o.name, company_name: o.company_name },
    window: orderWindow(new Date(), { outletId: o.id }),
    sst_rate: s.sst_rate, delivery_fee: s.delivery_fee, free_delivery_threshold: s.free_delivery_threshold,
    delivery_area: o.delivery_area, pickup_address: o.pickup_address,
    pickup_slots: o.pickup_slots, delivery_slots: o.delivery_slots,
    bank: bankOf(o), cutoff_time: s.cutoff_time,
    payment_term: me(req).payment_term, term_label: termLabel(me(req).payment_term),
    // blocked = can't order now (unpaid / overdue invoices and no Finance override in force)
    blocked: blocking.length > 0 && !override, blocking_invoices: blocking,
    override: override ? { reason: override.reason, expires_on: override.expires_on, single_order: !!override.single_order } : null,
  });
});

// ---------- what needs the customer's attention now (red dots in the portal menu) ----------
r.get('/attention', (req, res) => {
  const cid = req.user.customer_id;
  const today = todayMYT();
  const owed = db.prepare(`SELECT i.inv_number, i.due_date, i.payment_status FROM invoices i
                           WHERE i.customer_id = ? AND i.void = 0 AND i.payment_status IN ('Unpaid','Rejected')`).all(cid);
  const c = me(req);
  // pay now: rejected slips, invoices due today or overdue, and (COD) any unpaid invoice — it pauses ordering
  const pay = owed.filter((i) => i.payment_status === 'Rejected' || i.due_date <= today || c.payment_term === 'COD');
  const receive = db.prepare("SELECT so_number, status FROM sales_orders WHERE customer_id = ? AND status IN ('Ready for Pickup','Out for Delivery')").all(cid);
  const why = (list, fn) => list.map(fn).join(', ');
  res.json({
    payments: pay.length ? { count: pay.length, reason: `${pay.some((i) => i.payment_status === 'Rejected') ? 'A payment slip was rejected — please upload a new one. ' : ''}Pay now: ${why(pay, (i) => i.inv_number)}` } : null,
    orders: receive.length ? { count: receive.length, reason: `Confirm receipt: ${why(receive, (o) => o.so_number)}` } : null,
  });
});

// ---------- orders ----------
r.get('/orders', (req, res) => {
  res.json(db.prepare(`
    SELECT so.id, so.so_number, so.order_date, so.status, so.rejected_at, so.reject_reason, so.addon_of, so.method, so.fulfil_date, so.time_slot, so.total, so.updated_at,
           so.delivery_provider, so.delivery_link,
           (SELECT COUNT(*) FROM sales_order_lines l WHERE l.so_id = so.id AND l.quantity > 0) AS line_count,
           (SELECT SUM(quantity) FROM sales_order_lines l WHERE l.so_id = so.id) AS unit_count,
           i.inv_number, i.payment_status, i.due_date,
           (SELECT ps.status FROM payment_slips ps WHERE ps.so_id = so.id ORDER BY ps.id DESC LIMIT 1) AS order_slip_status
    FROM sales_orders so LEFT JOIN invoices i ON i.so_id = so.id AND i.void = 0
    WHERE so.customer_id = ? ORDER BY so.order_date DESC`).all(req.user.customer_id));
});

const ownOrder = (req) => {
  const so = getOrder(req.params.id);
  if (!so || so.customer_id !== req.user.customer_id) throw new HttpError(404, 'Order not found');
  return so;
};

r.get('/orders/:id', (req, res) => {
  const so = ownOrder(req);
  const o = getOutlet(so.outlet_id);
  res.json({
    ...so, pickup_address: so.method === 'pickup' ? o.pickup_address : null, adjustments: so.adjustments.map(({ user_name, ...a }) => a),
    // internal notes (e.g. a credit note Finance declined) stay internal until the complaint is resolved
    discrepancies: so.discrepancies.map((d) => ({ ...d, resolution: d.status === 'Resolved' ? d.resolution : null })),
    credit_notes: so.credit_notes.filter((c) => c.status === 'Issued'),
  });
});

// JSON, or multipart with field "data" (the same JSON) + file "slip" — COD customers must attach the slip
r.post('/orders', upload.single('slip'), (req, res) => {
  try {
    const b = req.file || req.body.data ? JSON.parse(req.body.data || '{}') : req.body;
    const slipFileId = req.file ? registerUpload(req.file, { kind: 'slip', customerId: req.user.customer_id, userId: req.user.id }) : null;
    const id = createOrder({
      customerId: req.user.customer_id, lines: b.lines, method: b.method, fulfilDate: b.fulfil_date, timeSlot: b.time_slot,
      areaConfirmed: b.area_confirmed === true, deliveryAddress: b.delivery_address, notes: b.notes, userId: req.user.id,
      slipFileId, slipReference: b.slip_reference, addonOf: b.addon_of ? Number(b.addon_of) : null,
    });
    res.status(201).json({ id });
  } catch (e) { removeTempUploads(req); throw e; }
});

r.post('/orders/:id/cancel', (req, res) => {
  cancelOrder(Number(req.params.id), { user: req.user });
  res.json({ ok: true });
});

// multipart: field "data" = JSON { matches_do, discrepancies: [{line_id, qty, note}] }, optional file "photo"
r.post('/orders/:id/receive', upload.single('photo'), (req, res) => {
  try {
    const data = JSON.parse(req.body.data || '{}');
    ownOrder(req);
    const fileId = req.file ? registerUpload(req.file, { kind: 'discrepancy', customerId: req.user.customer_id, userId: req.user.id }) : null;
    receiveOrder(Number(req.params.id), { customerId: req.user.customer_id, userId: req.user.id, matchesDo: data.matches_do === true, discrepancies: data.discrepancies, fileId });
    res.json({ ok: true });
  } catch (e) { removeTempUploads(req); throw e; }
});

// ---------- invoices & payments ----------
r.get('/invoices', (req, res) => {
  res.json(listInvoices('i.customer_id = ? AND i.void = 0', [req.user.customer_id])
    .map(({ issued_by, invoice_file_id, do_file_id, ...i }) => i));
});

// issued credit notes only (requests and declines are internal)
r.get('/credit-notes', (req, res) => {
  res.json(listCreditNotes("cn.customer_id = ? AND cn.status = 'Issued'", [req.user.customer_id])
    .map((c) => ({ id: c.id, cn_number: c.cn_number, issue_date: c.issue_date, inv_number: c.inv_number, so_number: c.so_number, so_id: c.so_id,
      reason: c.reason, lines: c.lines, subtotal: c.subtotal, sst_amount: c.sst_amount, total: c.total, settlement: c.settlement })));
});

r.get('/slips', (req, res) => {
  const slips = db.prepare('SELECT * FROM payment_slips WHERE customer_id = ? ORDER BY id DESC').all(req.user.customer_id);
  res.json(slips.map((s) => ({ ...s, invoices: slipInvoices(s.id).map((i) => ({ id: i.id, inv_number: i.inv_number, total: i.total })) })));
});

// multipart: file "slip", fields invoice_ids (JSON array), reference, amount
r.post('/slips', upload.single('slip'), (req, res) => {
  try {
    const fileId = registerUpload(req.file, { kind: 'slip', customerId: req.user.customer_id, userId: req.user.id });
    let ids;
    try { ids = JSON.parse(req.body.invoice_ids || '[]'); } catch { ids = []; }
    const id = uploadSlip({ customerId: req.user.customer_id, userId: req.user.id, fileId, invoiceIds: ids, reference: req.body.reference, amount: req.body.amount });
    res.status(201).json({ id });
  } catch (e) { removeTempUploads(req); throw e; }
});

// ---------- payment terms ----------
r.post('/term-request', (req, res) => {
  const id = requestCreditTerm(req.user.customer_id, { userId: req.user.id, note: req.body.note });
  res.status(201).json({ id });
});

export default r;
