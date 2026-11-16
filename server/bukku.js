// Bukku accounting integration — one Bukku company per outlet (KL, Ipoh). SWITCHED OFF by default.
//
// Confirmed from Bukku's API documentation (developers.bukku.my) and a public client library:
//   * every request carries  Authorization: Bearer <token>  and  Company-Subdomain: <subdomain>
//   * the token is created in Bukku → Control Panel → Integrations → API Access
//   * sales invoices are created with  POST /sales/invoices
// NOT yet confirmed (the docs' field reference needs a logged-in browser): the exact invoice body fields and the
// response shape. They live in toBukkuInvoice() / fromBukkuResponse() only — check both against the docs with a
// test company before setting BUKKU_ENABLED. Until then, issuing with "Bukku" is refused.
//
// Credentials stay on the server (.env, never in the frontend or git):
//   BUKKU_ENABLED=1          BUKKU_BASE_URL=https://api.bukku.my   (a staging URL for testing)
//   BUKKU_KL_TOKEN=…  BUKKU_KL_SUBDOMAIN=…   BUKKU_IPH_TOKEN=…  BUKKU_IPH_SUBDOMAIN=…
//
// Safety: an invoice is sent at most once (status pending → sending → sent; retries only from failed), every call is
// logged for Finance (integration_log), a failure alerts Finance and never affects the order or the kitchen —
// Finance can retry, or upload the invoice file instead.
import db from './db.js';
import { HttpError } from './errors.js';
import { getOrder } from './sales.js';
import { getOutlet } from './outlets.js';
import { notifyRole } from './notify.js';
import { audit } from './audit.js';

const TIMEOUT_MS = 15000;

export function bukkuConfig(outletCode) {
  const enabled = process.env.BUKKU_ENABLED === '1';
  const token = process.env[`BUKKU_${outletCode}_TOKEN`] || '';
  const subdomain = process.env[`BUKKU_${outletCode}_SUBDOMAIN`] || '';
  return { enabled, configured: !!(token && subdomain), token, subdomain, baseUrl: (process.env.BUKKU_BASE_URL || 'https://api.bukku.my').replace(/\/+$/, '') };
}
// what the UI may know (never the token)
export const bukkuStatus = () => Object.fromEntries(['KL', 'IPH'].map((code) => { const c = bukkuConfig(code); return [code, { enabled: c.enabled, configured: c.configured, ready: c.enabled && c.configured }]; }));
export function assertBukkuReady(outletCode) {
  const c = bukkuConfig(outletCode);
  if (!c.enabled) throw new HttpError(400, 'Bukku is switched off. Generate the PDF or upload the invoice instead.');
  if (!c.configured) throw new HttpError(400, `Bukku is not set up for ${outletCode} yet (API token and company subdomain).`);
  return c;
}

// ---- mapping (TO CONFIRM against Bukku's docs before switching on) ----
export function toBukkuInvoice(inv, order, customer) {
  return {
    contact_code: customer.code,                 // debtor code in Bukku (e.g. 300-X001)
    number: inv.inv_number,                      // our reference — also used to spot duplicates in Bukku
    date: inv.issue_date, due_date: inv.due_date,
    term: customer.payment_term,
    currency_code: 'MYR',
    status: 'ready',
    form_items: [
      ...order.lines.filter((l) => l.quantity > 0).map((l) => ({ product_code: l.sku, description: l.description, quantity: l.quantity, unit_price: l.unit_price, tax_code: inv.sst_rate ? 'SST' : null })),
      ...(inv.delivery_fee > 0 ? [{ description: 'Delivery fee', quantity: 1, unit_price: inv.delivery_fee, tax_code: inv.sst_rate ? 'SST' : null }] : []),
    ],
    totals: { subtotal: inv.subtotal, delivery_fee: inv.delivery_fee, tax: inv.sst_amount, total: inv.total }, // for checking only
    remarks: `Order ${order.so_number}`,
  };
}
export function fromBukkuResponse(body) {
  const t = body?.transaction || body?.data || body || {};
  return { id: t.id != null ? String(t.id) : null, number: t.number || t.number2 || t.reference || null, pdf_url: t.short_link || t.pdf_url || null };
}

const log = async (outletId, invoiceId, action, status, httpStatus, message, userId) =>
  await db.prepare('INSERT INTO integration_log (outlet_id, invoice_id, action, status, http_status, message, user_id) VALUES (?,?,?,?,?,?,?)')
    .run(outletId, invoiceId, action, status, httpStatus ?? null, String(message || '').slice(0, 1000), userId ?? null);

// Send one invoice. Never throws for Bukku problems — returns the invoice's new Bukku state.
export async function pushInvoiceToBukku(invoiceId, { userId = null } = {}) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw new HttpError(404, 'Invoice not found');
  if (inv.issue_method !== 'bukku') throw new HttpError(400, 'This invoice is not a Bukku invoice');
  const outlet = await getOutlet(inv.outlet_id);
  // claim it: only one sender, and never after it was sent (no duplicates on retry or double-click)
  const claimed = (await db.prepare("UPDATE invoices SET bukku_status = 'sending', bukku_attempts = bukku_attempts + 1 WHERE id = ? AND (bukku_status IS NULL OR bukku_status IN ('pending','failed'))").run(invoiceId)).changes;
  if (!claimed) { await log(inv.outlet_id, inv.id, 'create_invoice', 'skipped', null, `Not sent again: status is ${inv.bukku_status}`, userId); return { status: inv.bukku_status, skipped: true }; }
  const c = bukkuConfig(outlet.code);
  const fail = async (httpStatus, message) => {
    await db.prepare("UPDATE invoices SET bukku_status = 'failed', bukku_error = ? WHERE id = ?").run(message, invoiceId);
    await log(inv.outlet_id, inv.id, 'create_invoice', 'error', httpStatus, message, userId);
    await notifyRole('finance', inv.outlet_id, 'invoice', `Bukku failed: ${inv.inv_number}`, `${message}. Retry, or upload the invoice file instead. The order is not affected.`, '/finance/invoices?bukku=failed');
    await audit({ entity: 'invoice', entityId: inv.id, action: 'bukku_failed', userId, outletId: inv.outlet_id, after: { error: message } });
    return { status: 'failed', error: message };
  };
  if (!c.enabled || !c.configured) return await fail(null, !c.enabled ? 'Bukku is switched off' : `Bukku is not set up for ${outlet.code}`);
  const order = await getOrder(inv.so_id);
  const customer = await db.prepare('SELECT * FROM customers WHERE id = ?').get(inv.customer_id);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${c.baseUrl}/sales/invoices`, {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${c.token}`, 'Company-Subdomain': c.subdomain, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(toBukkuInvoice(inv, order, customer)),
    });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) return await fail(res.status, `Bukku answered ${res.status}: ${(body?.message || body?.error || text || '').toString().slice(0, 200)}`);
    const r = fromBukkuResponse(body);
    await db.prepare("UPDATE invoices SET bukku_status = 'sent', bukku_id = ?, external_number = COALESCE(?, external_number), bukku_error = NULL WHERE id = ?").run(r.id, r.number, invoiceId);
    await log(inv.outlet_id, inv.id, 'create_invoice', 'ok', res.status, `Created in Bukku${r.number ? ` as ${r.number}` : ''}${r.id ? ` (id ${r.id})` : ''}`, userId);
    await audit({ entity: 'invoice', entityId: inv.id, action: 'bukku_sent', userId, outletId: inv.outlet_id, after: { bukku_id: r.id, bukku_number: r.number } });
    return { status: 'sent', bukku_id: r.id, bukku_number: r.number };
  } catch (e) {
    return await fail(null, e.name === 'AbortError' ? 'Bukku did not answer in time' : `Could not reach Bukku: ${e.message}`);
  } finally { clearTimeout(timer); }
}

export const integrationLog = async (outletId = null, limit = 200) => await db.prepare(`SELECT l.*, i.inv_number, o.code AS outlet_code, u.name AS user_name FROM integration_log l
  LEFT JOIN invoices i ON i.id = l.invoice_id LEFT JOIN outlets o ON o.id = l.outlet_id LEFT JOIN users u ON u.id = l.user_id
  WHERE (? IS NULL OR l.outlet_id = ?) ORDER BY l.id DESC LIMIT ?`).all(outletId, outletId, limit);
