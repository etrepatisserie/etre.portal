// PDF documents: tax invoice, delivery order, credit note, kitchen summary report (pdfkit),
// plus a tiny synchronous PDF writer used for mock bank slips in the seed (left as it was).
//
// Design: white A4, Inter (embedded), navy as a thin accent only — prints cleanly in black & white.
// Every document uses the issuing outlet's own company details (KL or Ipoh are separate companies).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { getOutlet } from './outlets.js';
import { termLabel } from './terms.js';

const NAVY = '#263B5A';
const INK = '#20242C';
const MUTED = '#6A7280';
const LINE = '#E3E7ED';
const FILL = '#F3F5F8';
const L = 50, R = 545, W = R - L; // margins, content width
const rm = (n) => `RM ${Number(n).toFixed(2)}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// "2026-11-12" → "12 Nov 2026" (with weekday: "Thu 12 Nov 2026")
const fd = (iso, weekday = false) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${weekday ? `${DAYS[d.getUTCDay()]} ` : ''}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// Inter from the @fontsource package (Latin incl. "Ê" and "é"); falls back to Helvetica if missing
const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@fontsource', 'inter', 'files');
const INTER = { regular: 'inter-latin-400-normal.woff', medium: 'inter-latin-500-normal.woff', semibold: 'inter-latin-600-normal.woff' };
const HAS_INTER = Object.values(INTER).every((f) => fs.existsSync(path.join(FONT_DIR, f)));
const F = HAS_INTER ? { regular: 'Inter', medium: 'Inter-Medium', semibold: 'Inter-SemiBold' } : { regular: 'Helvetica', medium: 'Helvetica-Bold', semibold: 'Helvetica-Bold' };

function newDoc(title) {
  const doc = new PDFDocument({ size: 'A4', margin: L, bufferPages: true, info: { Title: title, Author: 'Être Patisserie' } });
  if (HAS_INTER) {
    doc.registerFont('Inter', path.join(FONT_DIR, INTER.regular));
    doc.registerFont('Inter-Medium', path.join(FONT_DIR, INTER.medium));
    doc.registerFont('Inter-SemiBold', path.join(FONT_DIR, INTER.semibold));
  }
  return doc;
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// Logo mark + wordmark, issuing company, document title and number
function header(doc, title, number, s) {
  doc.roundedRect(L, 48, 28, 28, 6).fill(NAVY);
  doc.font('Times-Bold').fontSize(17).fillColor('#FFFFFF').text('Ê', L, 54, { width: 28, align: 'center' });
  doc.font(F.semibold).fontSize(13).fillColor(INK).text('Être Patisserie', L + 38, 49, { lineBreak: false });
  doc.font(F.regular).fontSize(8).fillColor(MUTED).text(s.company_name, L + 38, 66, { lineBreak: false });
  doc.font(F.semibold).fontSize(18).fillColor(INK).text(title, 300, 46, { width: R - 300, align: 'right' });
  doc.font(F.medium).fontSize(10).fillColor(NAVY).text(number, 300, 70, { width: R - 300, align: 'right' });
  doc.font(F.regular).fontSize(7.5).fillColor(MUTED)
    .text([s.company_address, [s.company_reg_no && `Reg. no. ${s.company_reg_no}`, s.sst_reg_no && `SST no. ${s.sst_reg_no}`, s.email].filter(Boolean).join('   ·   ')].filter(Boolean).join('\n'), L, 92, { width: W });
  const y = Math.max(doc.y + 8, 116);
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.75).strokeColor(NAVY).stroke();
  return y + 16;
}

// Footer on every page: company line, computer-generated note, page x of y
function footer(doc, s, note) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0; // allow writing in the margin
    doc.moveTo(L, 790).lineTo(R, 790).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.font(F.regular).fontSize(7).fillColor(MUTED)
      .text(`${s.company_name}${s.company_reg_no ? ` · ${s.company_reg_no}` : ''}${note ? `   ·   ${note}` : ''}`, L, 797, { width: W - 70, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, R - 70, 797, { width: 70, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

function label(doc, text, x, y) {
  doc.font(F.medium).fontSize(7.5).fillColor(MUTED).text(text.toUpperCase(), x, y, { characterSpacing: 0.6 });
  return doc.y + 3;
}

function keyValues(doc, x, y, rows, width = 215) {
  for (const [k, v] of rows) {
    doc.font(F.regular).fontSize(8.5).fillColor(MUTED).text(k, x, y, { width: 88 });
    doc.font(F.medium).fontSize(8.5).fillColor(INK).text(String(v ?? '—'), x + 88, y, { width: width - 88 });
    y = Math.max(doc.y, y + 12) + 3;
  }
  return y;
}

// Table with a light header row that repeats on every new page
function table(doc, y, columns, rows) {
  const head = (yy) => {
    doc.rect(L, yy, W, 20).fill(FILL);
    let x = L + 8;
    doc.font(F.medium).fontSize(7.5).fillColor(MUTED);
    for (const c of columns) { doc.text(c.label, x, yy + 6.5, { width: c.width - 10, align: c.align || 'left', lineBreak: false }); x += c.width; }
    return yy + 26;
  };
  y = head(y);
  for (const r of rows) {
    doc.font(F.regular).fontSize(8.5);
    const h = Math.max(...columns.map((c, i) => doc.heightOfString(String(r[i]), { width: c.width - 10 }))) + 9;
    if (y + h > 760) { doc.addPage(); y = head(50); }
    let x = L + 8;
    columns.forEach((c, i) => { doc.font(c.strong ? F.medium : F.regular).fillColor(INK).text(String(r[i]), x, y, { width: c.width - 10, align: c.align || 'left' }); x += c.width; });
    y += h;
    doc.moveTo(L, y - 4).lineTo(R, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  }
  return y + 6;
}

// Right-hand totals block; the last row is the grand total
function totalsBlock(doc, y, rows, grand) {
  if (y > 650) { doc.addPage(); y = 50; }
  for (const [k, v] of rows) {
    doc.font(F.regular).fontSize(8.5).fillColor(MUTED).text(k, 290, y, { width: 165, align: 'right' });
    doc.fillColor(INK).text(v, 460, y, { width: R - 460, align: 'right' });
    y += 15;
  }
  doc.moveTo(290, y + 1).lineTo(R, y + 1).lineWidth(1).strokeColor(NAVY).stroke();
  doc.font(F.semibold).fontSize(11).fillColor(INK).text(grand[0], 260, y + 8, { width: 195, align: 'right' }).text(grand[1], 440, y + 8, { width: R - 440, align: 'right' });
  return y + 36;
}

const fulfilLabel = (order) => `${order.method === 'pickup' ? 'Pickup' : 'Delivery'} · ${fd(order.fulfil_date, true)}${order.time_slot ? ` · ${order.time_slot}` : ''}`;
const ITEM_COLUMNS = [
  { label: '#', width: 24 }, { label: 'SKU', width: 76 }, { label: 'Description', width: 185, strong: true },
  { label: 'Qty', width: 50, align: 'right' }, { label: 'Unit price', width: 75, align: 'right' }, { label: 'Amount', width: 85, align: 'right' },
];

export async function renderInvoice({ invoice, order, customer }) {
  const s = await getOutlet(invoice.outlet_id); // the issuing company (KL or Ipoh)
  const doc = newDoc(invoice.inv_number);
  let y = header(doc, 'Tax Invoice', invoice.inv_number, s);
  const top = y;
  y = label(doc, 'Bill to', L, y);
  doc.font(F.semibold).fontSize(10).fillColor(INK).text(customer.name, L, y, { width: 240 });
  doc.font(F.regular).fontSize(8.5).fillColor(INK).text(`${customer.code}${customer.reg_no ? ` · Reg. ${customer.reg_no}` : ''}${customer.contact ? ` · Attn: ${customer.contact}` : ''}`, { width: 240 })
    .text(customer.billing_address || customer.address || '', { width: 240 });
  y = label(doc, order.method === 'delivery' ? 'Deliver to' : 'Pickup at', L, doc.y + 8);
  doc.font(F.regular).fontSize(8.5).fillColor(INK).text(order.method === 'delivery' ? `Deliver to: ${order.delivery_address || customer.address || ''}` : `Pickup at: ${s.pickup_address}`, L, y, { width: 240 });
  const leftEnd = doc.y;
  const rightEnd = keyValues(doc, 320, top, [
    ['Invoice no.', invoice.inv_number], ['Invoice date', fd(invoice.issue_date)], ['Due date', fd(invoice.due_date)],
    ['Terms', termLabel(customer.payment_term)], ['Order no.', order.so_number],
    ['DO no.', invoice.do_number], ['Fulfilment', fulfilLabel(order)],
  ], R - 320);
  const lines = order.lines.filter((l) => l.quantity > 0);
  y = table(doc, Math.max(leftEnd, rightEnd) + 16, ITEM_COLUMNS,
    lines.map((l, i) => [i + 1, l.sku, l.description, `${l.quantity} ${l.uom || ''}`, rm(l.unit_price), rm(l.line_total)]));

  y = totalsBlock(doc, y, [
    ['Subtotal', rm(invoice.subtotal)],
    ['Delivery fee', order.method === 'pickup' ? 'Pickup' : invoice.delivery_fee > 0 ? rm(invoice.delivery_fee) : 'FREE'],
    [`SST ${Math.round(invoice.sst_rate * 100)}% (on subtotal + delivery)`, rm(invoice.sst_amount)],
  ], ['Total (incl. SST)', rm(invoice.total)]);

  if (y > 690) { doc.addPage(); y = 50; }
  doc.roundedRect(L, y, 300, 74, 6).lineWidth(0.75).strokeColor(LINE).stroke();
  doc.rect(L, y, 3, 74).fill(NAVY);
  doc.font(F.semibold).fontSize(8).fillColor(NAVY).text('PAYMENT BY BANK TRANSFER ONLY', L + 14, y + 10, { characterSpacing: 0.5 });
  keyValues(doc, L + 14, y + 26, [['Bank', s.bank_name], ['Account name', s.bank_account_name], ['Account no.', s.bank_account_no]], 280);
  doc.font(F.regular).fontSize(8).fillColor(MUTED)
    .text(`Please quote ${invoice.inv_number} as the payment reference and upload your slip in the customer portal.`, 368, y + 10, { width: R - 368 });
  footer(doc, s, 'This is a computer-generated invoice. No signature is required.');
  return toBuffer(doc);
}

export async function renderCreditNote({ cn, invoice, customer }) {
  const s = await getOutlet(cn.outlet_id); // the same company that issued the invoice
  const doc = newDoc(cn.cn_number);
  let y = header(doc, 'Credit Note', cn.cn_number, s);
  const top = y;
  y = label(doc, 'Credit to', L, y);
  doc.font(F.semibold).fontSize(10).fillColor(INK).text(customer.name, L, y, { width: 240 });
  doc.font(F.regular).fontSize(8.5).fillColor(INK).text(`${customer.code}${customer.reg_no ? ` · Reg. ${customer.reg_no}` : ''}`, { width: 240 })
    .text(customer.billing_address || customer.address || '', { width: 240 });
  const leftEnd = doc.y;
  const rightEnd = keyValues(doc, 320, top, [
    ['Credit note no.', cn.cn_number], ['Date', fd(cn.issue_date)], ['Against invoice', invoice.inv_number],
    ['Invoice date', fd(invoice.issue_date)], ['Order no.', cn.so_number],
  ], R - 320);
  y = label(doc, 'Reason', L, Math.max(leftEnd, rightEnd) + 12);
  doc.font(F.regular).fontSize(8.5).fillColor(INK).text(cn.reason, L, y, { width: W });
  y = table(doc, doc.y + 14, ITEM_COLUMNS, cn.lines.map((l, i) => [i + 1, l.sku || '', l.description, l.quantity, rm(l.unit_price), rm(l.amount)]));
  y = totalsBlock(doc, y, [['Subtotal', rm(cn.subtotal)], [`SST ${Math.round(cn.sst_rate * 100)}%`, rm(cn.sst_amount)]], ['Total credit (incl. SST)', rm(cn.total)]);
  doc.font(F.regular).fontSize(8.5).fillColor(INK).text(cn.settlement === 'Reduces amount due'
    ? `This credit is deducted from the amount due on ${invoice.inv_number}.`
    : `${invoice.inv_number} was already paid: this credit will be refunded or offset against your next invoice.`, L, y, { width: W });
  footer(doc, s, 'This is a computer-generated credit note. No signature is required.');
  return toBuffer(doc);
}

// Delivery order: items and quantities only — no prices or amounts
export async function renderDeliveryOrder({ invoice, order, customer }) {
  const s = await getOutlet(invoice.outlet_id);
  const doc = newDoc(invoice.do_number);
  let y = header(doc, 'Delivery Order', invoice.do_number, s);
  const top = y;
  y = label(doc, order.method === 'pickup' ? 'Collected by' : 'Deliver to', L, y);
  doc.font(F.semibold).fontSize(10).fillColor(INK).text(customer.name, L, y, { width: 240 });
  doc.font(F.regular).fontSize(8.5).fillColor(INK).text(order.method === 'delivery' ? (order.delivery_address || customer.address || '') : `Pickup at: ${s.pickup_address}`, { width: 240 })
    .text(customer.phone || '', { width: 240 });
  const leftEnd = doc.y;
  const rightEnd = keyValues(doc, 320, top, [
    ['DO no.', invoice.do_number], ['Invoice no.', invoice.inv_number], ['Order no.', order.so_number],
    ['Date', fd(order.fulfil_date, true)], ['Method', order.method === 'pickup' ? 'Pickup' : 'Delivery'], ['Time slot', order.time_slot || '—'],
  ], R - 320);
  y = table(doc, Math.max(leftEnd, rightEnd) + 16, [
    { label: '#', width: 24 }, { label: 'SKU', width: 86 }, { label: 'Description', width: 245, strong: true },
    { label: 'Qty', width: 70, align: 'right' }, { label: 'Checked', width: 70, align: 'center' },
  ], order.lines.filter((l) => l.quantity > 0).map((l, i) => [i + 1, l.sku, l.description, `${l.quantity} ${l.uom || ''}`, '[    ]']));
  y = Math.max(y + 30, 560);
  if (y > 680) { doc.addPage(); y = 80; }
  for (const [i, text] of ['Issued by', 'Received by (name & signature)', 'Date / time & company chop'].entries()) {
    const x = L + i * 170;
    doc.moveTo(x, y + 40).lineTo(x + 150, y + 40).lineWidth(0.6).strokeColor(INK).stroke();
    doc.font(F.regular).fontSize(7.5).fillColor(MUTED).text(text, x, y + 46, { width: 150 });
  }
  doc.font(F.regular).fontSize(8).fillColor(INK).text('Please check all items against this Delivery Order on receipt and confirm in the customer portal ("Mark as Received").', L, y + 82, { width: W });
  footer(doc, s, '');
  return toBuffer(doc);
}

// Kitchen summary: quantities only — no prices or amounts
export async function renderKitchenReport({ from, to, rows, generatedAt, outletName = '' }) {
  const doc = newDoc(`Production summary ${from} to ${to}`);
  doc.roundedRect(L, 48, 28, 28, 6).fill(NAVY);
  doc.font('Times-Bold').fontSize(17).fillColor('#FFFFFF').text('Ê', L, 54, { width: 28, align: 'center' });
  doc.font(F.semibold).fontSize(13).fillColor(INK).text('Être Patisserie', L + 38, 49, { lineBreak: false });
  doc.font(F.regular).fontSize(8).fillColor(MUTED).text(`Central Kitchen${outletName ? ` ${outletName}` : ''}`, L + 38, 66, { lineBreak: false });
  doc.font(F.semibold).fontSize(18).fillColor(INK).text('Production summary', 300, 46, { width: R - 300, align: 'right' });
  doc.font(F.regular).fontSize(8.5).fillColor(MUTED).text(`Production dates ${fd(from)} to ${fd(to)} · generated ${generatedAt}`, L, 94, { width: W });
  doc.moveTo(L, 112).lineTo(R, 112).lineWidth(0.75).strokeColor(NAVY).stroke();
  table(doc, 128, [
    { label: 'SKU', width: 75 }, { label: 'Product', width: 170, strong: true }, { label: 'Total qty', width: 60, align: 'right' },
    { label: 'Orders', width: 50, align: 'right' }, { label: 'Pickup / delivery dates', width: 140 },
  ], rows.length ? rows.map((r) => [r.sku, r.name, `${r.units} ${r.uom}`, r.orders, r.fulfil_dates.map((d) => fd(d)).join(', ')]) : [['—', 'No orders in this range', '', '', '']]);
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i); const b = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font(F.regular).fontSize(7).fillColor(MUTED).text(`Page ${i + 1} of ${range.count}`, R - 70, 797, { width: 70, align: 'right', lineBreak: false });
    doc.page.margins.bottom = b;
  }
  return toBuffer(doc);
}

// Minimal one-page PDF built by hand (synchronous) — used for mock bank slips in seed data.
export function simplePdf(lines) {
  const esc = (t) => String(t).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e\xa0-\xff]/g, '-'); // keep Latin-1 (é, â…), file is written as latin1
  const content = ['BT', '/F1 18 Tf', '60 780 Td', `(${esc(lines[0])}) Tj`, '/F1 11 Tf', ...lines.slice(1).flatMap((l) => ['0 -22 Td', `(${esc(l)}) Tj`]), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
