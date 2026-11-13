// Email: every message is stored in email_outbox (Admin › Email Outbox).
// EMAIL_MODE=log (default) only logs; EMAIL_MODE=smtp also sends through Nodemailer.
import nodemailer from 'nodemailer';
import db from './db.js';
import { config } from './config.js';
import { getOutlet, listOutlets } from './outlets.js';

// the company (outlet) an email is sent on behalf of — set per email in renderEmail
let CUR = null;

const C = { ivory: '#faf6ee', white: '#ffffff', gold: '#b8975f', goldSoft: '#e9dcc3', ink: '#2b2620', muted: '#857a6c' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rm = (n) => `RM ${Number(n).toFixed(2)}`;

let transport = null;
function getTransport() {
  if (transport) return transport;
  transport = config.emailMode === 'smtp' && config.smtp.host
    ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
    : nodemailer.createTransport({ jsonTransport: true });
  return transport;
}

// ---------- layout ----------
function layout({ preheader, heading, body, cta }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${C.ivory};font-family:Georgia,'Times New Roman',serif;color:${C.ink};">
<span style="display:none;max-height:0;overflow:hidden;">${esc(preheader || heading)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ivory};padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
    <tr><td align="center" style="padding:8px 0 22px;">
      <div style="font-size:22px;letter-spacing:6px;color:${C.ink};">ÊTRE PATISSERIE</div>
      <div style="width:48px;height:1px;background:${C.gold};margin:12px auto 0;"></div>
    </td></tr>
    <tr><td style="background:${C.white};border:1px solid ${C.goldSoft};border-radius:6px;padding:34px 34px 30px;">
      <h1 style="margin:0 0 18px;font-weight:normal;font-size:22px;color:${C.ink};">${esc(heading)}</h1>
      <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:${C.ink};">${body}</div>
      ${cta ? `<div style="margin-top:26px;"><a href="${esc(cta.url)}" style="display:inline-block;background:${C.ink};color:${C.ivory};text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:1px;padding:12px 22px;border-radius:3px;">${esc(cta.label)}</a></div>` : ''}
    </td></tr>
    <tr><td align="center" style="padding:22px 10px;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:${C.muted};line-height:1.6;">
      ${esc(CUR?.company_name || '')}<br>Wholesale orders · This is an automated message.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const p = (t) => `<p style="margin:0 0 12px;">${t}</p>`;
const small = (t) => `<p style="margin:12px 0 0;font-size:12px;color:${C.muted};">${t}</p>`;

function totalsTable(t, method) {
  const row = (k, v, strong) => `<tr><td style="padding:4px 0;color:${strong ? C.ink : C.muted};${strong ? 'font-weight:bold;' : ''}">${k}</td><td align="right" style="padding:4px 0;${strong ? 'font-weight:bold;' : ''}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;border-top:1px solid ${C.goldSoft};font-size:14px;">
    ${row('Subtotal', rm(t.subtotal))}
    ${row('Delivery fee', method === 'pickup' ? 'Pickup' : t.delivery_fee > 0 ? rm(t.delivery_fee) : 'FREE')}
    ${row(`SST ${Math.round(t.sst_rate * 100)}%`, rm(t.sst_amount))}
    <tr><td colspan="2" style="border-top:1px solid ${C.ink};"></td></tr>
    ${row('Total (incl. SST)', rm(t.total), true)}
  </table>`;
}

function bankBox() {
  const s = CUR;
  return `<div style="margin:16px 0;padding:14px 16px;background:${C.ivory};border-left:3px solid ${C.gold};font-size:13px;">
    <div style="letter-spacing:1px;color:${C.gold};font-size:11px;margin-bottom:6px;">PAYMENT BY BANK TRANSFER ONLY</div>
    Bank: <b>${esc(s.bank_name)}</b><br>Account name: <b>${esc(s.bank_account_name)}</b><br>Account no.: <b>${esc(s.bank_account_no)}</b>
  </div>`;
}

function itemsTable(rows, headers) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin:10px 0;">
    <tr>${headers.map((h, i) => `<td ${i ? 'align="right"' : ''} style="padding:6px 0;border-bottom:1px solid ${C.goldSoft};color:${C.muted};font-size:11px;letter-spacing:.5px;text-transform:uppercase;">${h}</td>`).join('')}</tr>
    ${rows.map((r) => `<tr>${r.map((c, i) => `<td ${i ? 'align="right"' : ''} style="padding:6px 0;border-bottom:1px solid #f1ece2;">${c}</td>`).join('')}</tr>`).join('')}
  </table>`;
}

const fulfil = (o) => `${o.method === 'pickup' ? 'Pickup' : 'Delivery'} on <b>${esc(o.fulfil_date)}</b>${o.time_slot ? `, ${esc(o.time_slot)}` : ''}`;

// ---------- templates ----------
const TEMPLATES = {
  quantity_adjusted: ({ order, changes, before, after }) => ({
    subject: `Order ${order.so_number}: quantities adjusted`,
    heading: 'Your order has been adjusted',
    body: p(`Dear ${esc(order.customer_name)},`) +
      p(`Due to availability we have had to adjust order <b>${esc(order.so_number)}</b>. Please review the changes below.`) +
      itemsTable(changes.map((c) => [esc(c.product_name), c.old_qty, c.new_qty === 0 ? 'Removed' : c.new_qty, esc(c.reason)]), ['Item', 'Ordered', 'Adjusted', 'Reason']) +
      p(`<b>New total</b> (previously ${rm(before.total)}):`) + totalsTable(after, order.method) +
      small('Delivery fee and SST have been recalculated on the adjusted subtotal.'),
    cta: { label: 'View order', url: `${config.appUrl}/portal/orders/${order.id}` },
  }),
  order_confirmed: ({ order }) => ({
    subject: `Order ${order.so_number} confirmed`,
    heading: 'Thank you — your order is confirmed',
    body: p(`Dear ${esc(order.customer_name)},`) + p(`We have confirmed order <b>${esc(order.so_number)}</b>. ${fulfil(order)}.`) +
      itemsTable(order.lines.filter((l) => l.quantity > 0).map((l) => [esc(l.description), `${l.quantity}`, rm(l.line_total)]), ['Item', 'Qty', 'Amount']) +
      totalsTable(order, order.method) + small('Your invoice will follow shortly.'),
    cta: { label: 'View order', url: `${config.appUrl}/portal/orders/${order.id}` },
  }),
  invoice_issued: ({ order, invoice }) => ({
    subject: `Invoice ${invoice.inv_number} for order ${order.so_number}`,
    heading: `Invoice ${invoice.inv_number}`,
    body: p(`Dear ${esc(order.customer_name)},`) + p(`Your invoice for order <b>${esc(order.so_number)}</b> is ready. Payment is due by <b>${esc(invoice.due_date)}</b>.`) +
      totalsTable(invoice, order.method) + bankBox() +
      p(`Please quote <b>${esc(invoice.inv_number)}</b> as your payment reference and upload the payment slip in the customer portal.`),
    cta: { label: 'View invoice & pay', url: `${config.appUrl}/portal/payments` },
  }),
  payment_verified: ({ customer, slip, invoices }) => ({
    subject: `Payment received — ${invoices.map((i) => i.inv_number).join(', ')}`,
    heading: 'Payment received, thank you',
    body: p(`Dear ${esc(customer.name)},`) + p('We have verified your payment for:') +
      itemsTable(invoices.map((i) => [esc(i.inv_number), rm(i.total)]), ['Invoice', 'Amount']) +
      (slip.reference ? small(`Your reference: ${esc(slip.reference)}`) : ''),
    cta: { label: 'View payments', url: `${config.appUrl}/portal/payments` },
  }),
  payment_rejected: ({ customer, slip, invoices }) => ({
    subject: `Payment slip could not be verified — ${invoices.length ? invoices.map((i) => i.inv_number).join(', ') : 'your order'}`,
    heading: 'We could not verify your payment slip',
    body: p(`Dear ${esc(customer.name)},`) + p(`Your payment slip for <b>${invoices.length ? invoices.map((i) => esc(i.inv_number)).join(', ') : 'your order'}</b> was not accepted.`) +
      `<div style="margin:14px 0;padding:12px 14px;background:#fbf3ef;border-left:3px solid #b5654a;font-size:13px;"><b>Reason:</b> ${esc(slip.reject_reason)}</div>` +
      p('Please upload a corrected slip in the customer portal. New orders remain on hold until payment is verified.') + bankBox(),
    cta: { label: 'Upload slip', url: `${config.appUrl}/portal/payments` },
  }),
  credit_note_issued: ({ customer, creditNote: cn, invoice }) => ({
    subject: `Credit note ${cn.cn_number} for invoice ${invoice.inv_number}`,
    heading: `Credit note ${cn.cn_number}`,
    body: p(`Dear ${esc(customer.name)},`) + p(`We have issued a credit note against invoice <b>${esc(invoice.inv_number)}</b> (order ${esc(cn.so_number)}).`) +
      itemsTable(cn.lines.map((l) => [esc(l.description), `${l.quantity}`, rm(l.amount)]), ['Item', 'Qty', 'Amount']) +
      p(`SST: ${rm(cn.sst_amount)} · <b>Total credit: ${rm(cn.total)}</b>`) + small(`Reason: ${esc(cn.reason)}`) +
      p(cn.settlement === 'Reduces amount due' ? `This amount is deducted from what is due on ${esc(invoice.inv_number)}.` : `As ${esc(invoice.inv_number)} is already paid, we will refund or offset this amount against your next invoice.`),
    cta: { label: 'View payments', url: `${config.appUrl}/portal/payments` },
  }),
  delivery_link: ({ order }) => ({
    subject: `Order ${order.so_number} is on its way`,
    heading: 'Track your delivery',
    body: p(`Dear ${esc(order.customer_name)},`) + p(`Order <b>${esc(order.so_number)}</b> has been booked with <b>${esc(order.delivery_provider)}</b>. ${fulfil(order)}.`) +
      p('Use the button below to follow the driver in real time.'),
    cta: { label: `Track on ${order.delivery_provider}`, url: order.delivery_link },
  }),
  term_result: ({ customer, approved, note }) => ({
    subject: approved ? 'Your 14-day credit term is approved' : 'Update on your credit term request',
    heading: approved ? 'Credit term approved' : 'Credit term request',
    body: p(`Dear ${esc(customer.name)},`) +
      (approved
        ? p('Good news — your account is now on a <b>14-day credit term</b>. New invoices will be due 14 days after the invoice date.')
        : p('Thank you for your request. We are unable to offer a 14-day credit term at this time, and your account remains on <b>COD</b>.')) +
      (note ? small(esc(note)) : ''),
    cta: { label: 'View account', url: `${config.appUrl}/portal/account` },
  }),
};

export function renderEmail(template, data) {
  const oid = data.order?.outlet_id ?? data.invoice?.outlet_id ?? data.customer?.outlet_id ?? data.invoices?.[0]?.outlet_id;
  CUR = (oid && getOutlet(oid)) || listOutlets()[0];
  const t = TEMPLATES[template](data);
  const html = layout({ preheader: t.subject, heading: t.heading, body: t.body, cta: t.cta });
  const text = `${t.heading}\n\n${t.body.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|tr|div)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim()}${t.cta ? `\n\n${t.cta.label}: ${t.cta.url}` : ''}`;
  return { subject: t.subject, html, text };
}

// Store in the outbox now; deliver in the background (never blocks or fails the request)
export function queueEmail({ to, template, data, related = {}, at = null }) {
  if (!to) return null;
  const { subject, html, text } = renderEmail(template, data);
  const id = db.prepare(`INSERT INTO email_outbox (to_email, subject, html, text, template, related_type, related_id, outlet_id, status, created_at)
                         VALUES (?,?,?,?,?,?,?,?, 'logged', COALESCE(?, datetime('now')))`)
    .run(to, subject, html, text, template, related.type || null, related.id || null, CUR?.id || null, at).lastInsertRowid;
  if (at) return id; // seeded history — don't send
  if (!config.quiet) console.log(`[email] ${config.emailMode === 'smtp' ? 'sending' : 'logged'} → ${to} · ${subject}`);
  if (config.emailMode === 'smtp') {
    getTransport().sendMail({ from: config.emailFrom, to, subject, html, text })
      .then(() => db.prepare("UPDATE email_outbox SET status = 'sent' WHERE id = ?").run(id))
      .catch((e) => db.prepare("UPDATE email_outbox SET status = 'failed', error = ? WHERE id = ?").run(String(e.message).slice(0, 500), id));
  }
  return id;
}
