// PDF documents: tax invoice, delivery order, kitchen summary report (pdfkit),
// plus a tiny synchronous PDF writer used for mock bank slips in the seed.
import PDFDocument from 'pdfkit';
import { getOutlet } from './outlets.js';
import { termLabel } from './terms.js';

const GOLD = '#a8875a';
const INK = '#2b2620';
const MUTED = '#7a7065';
const LINE = '#e6dfd2';
const rm = (n) => `RM ${Number(n).toFixed(2)}`;

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function header(doc, title, s) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('ÊTRE PATISSERIE', 50, 50, { characterSpacing: 2 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text(s.company_name, 50, 76).text(s.company_address).text(`${s.company_reg_no}  ·  ${s.sst_reg_no}`);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(GOLD).text(title, 330, 52, { width: 215, align: 'right' });
  doc.moveTo(50, 118).lineTo(545, 118).lineWidth(1).strokeColor(GOLD).stroke();
}

function keyValues(doc, x, y, rows, width = 215) {
  for (const [k, v] of rows) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k, x, y, { width: 90 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(String(v ?? '—'), x + 90, y, { width: width - 90 });
    y += 14;
  }
  return y;
}

function table(doc, y, columns, rows) {
  const x0 = 50;
  doc.rect(x0, y, 495, 20).fill('#f6f1e7');
  let x = x0 + 6;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5);
  for (const c of columns) { doc.text(c.label, x, y + 6, { width: c.width - 8, align: c.align || 'left' }); x += c.width; }
  y += 24;
  doc.font('Helvetica').fontSize(9);
  for (const r of rows) {
    const h = Math.max(...columns.map((c, i) => doc.heightOfString(String(r[i]), { width: c.width - 8 }))) + 8;
    if (y + h > 740) { doc.addPage(); y = 50; }
    x = x0 + 6;
    columns.forEach((c, i) => { doc.fillColor(INK).text(String(r[i]), x, y, { width: c.width - 8, align: c.align || 'left' }); x += c.width; });
    y += h;
    doc.moveTo(x0, y - 3).lineTo(x0 + 495, y - 3).lineWidth(0.5).strokeColor(LINE).stroke();
  }
  return y + 4;
}

function fulfilLabel(order) {
  return `${order.method === 'pickup' ? 'Pickup' : 'Delivery'} · ${order.fulfil_date}${order.time_slot ? ` · ${order.time_slot}` : ''}`;
}

export async function renderInvoice({ invoice, order, customer }) {
  const s = getOutlet(invoice.outlet_id); // the issuing company (KL or Ipoh)
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: invoice.inv_number } });
  header(doc, 'TAX INVOICE', s);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('BILL TO', 50, 135);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(customer.name, 50, 148, { width: 230 });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(`${customer.code}${customer.reg_no ? ` · Reg. ${customer.reg_no}` : ''}${customer.contact ? ` · Attn: ${customer.contact}` : ''}`, { width: 230 })
    .text(customer.billing_address || customer.address || '', { width: 230 })
    .text(order.method === 'delivery' ? `Deliver to: ${order.delivery_address || customer.address || ''}` : `Pickup at: ${s.pickup_address}`, { width: 230 });
  keyValues(doc, 330, 135, [
    ['Invoice no.', invoice.inv_number], ['Invoice date', invoice.issue_date], ['Due date', invoice.due_date],
    ['Terms', termLabel(customer.payment_term)], ['Order no.', order.so_number],
    ['DO no.', invoice.do_number], ['Fulfilment', fulfilLabel(order)],
  ]);
  const lines = order.lines.filter((l) => l.quantity > 0);
  let y = table(doc, 245, [
    { label: '#', width: 25 }, { label: 'SKU', width: 75 }, { label: 'Description', width: 185 },
    { label: 'Qty', width: 50, align: 'right' }, { label: 'Unit price', width: 75, align: 'right' }, { label: 'Amount', width: 85, align: 'right' },
  ], lines.map((l, i) => [i + 1, l.sku, l.description, `${l.quantity} ${l.uom || ''}`, rm(l.unit_price), rm(l.line_total)]));

  const totals = [
    ['Subtotal', rm(invoice.subtotal)],
    ['Delivery fee', order.method === 'pickup' ? 'Pickup' : invoice.delivery_fee > 0 ? rm(invoice.delivery_fee) : 'FREE'],
    [`SST ${Math.round(invoice.sst_rate * 100)}% (on subtotal + delivery)`, rm(invoice.sst_amount)],
  ];
  if (y > 640) { doc.addPage(); y = 50; }
  for (const [k, v] of totals) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, 300, y, { width: 160, align: 'right' });
    doc.fillColor(INK).text(v, 465, y, { width: 80, align: 'right' });
    y += 15;
  }
  doc.moveTo(300, y).lineTo(545, y).lineWidth(1).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Total (incl. SST)', 300, y + 6, { width: 160, align: 'right' }).text(rm(invoice.total), 445, y + 6, { width: 100, align: 'right' });
  y += 40;

  doc.roundedRect(50, y, 300, 76, 4).lineWidth(1).strokeColor(GOLD).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GOLD).text('PAYMENT BY BANK TRANSFER ONLY', 62, y + 10);
  keyValues(doc, 62, y + 26, [['Bank', s.bank_name], ['Account name', s.bank_account_name], ['Account no.', s.bank_account_no]], 280);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(`Please quote ${invoice.inv_number} as the payment reference and upload your slip in the customer portal.`, 365, y + 10, { width: 180 });
  doc.fontSize(7.5).text('This is a computer-generated invoice. No signature is required.', 50, 780, { width: 495, align: 'center' });
  return toBuffer(doc);
}

export async function renderCreditNote({ cn, invoice, customer }) {
  const s = getOutlet(cn.outlet_id); // the same company that issued the invoice
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: cn.cn_number } });
  header(doc, 'CREDIT NOTE', s);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('CREDIT TO', 50, 135);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(customer.name, 50, 148, { width: 230 });
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(`${customer.code}${customer.reg_no ? ` · Reg. ${customer.reg_no}` : ''}`, { width: 230 })
    .text(customer.billing_address || customer.address || '', { width: 230 });
  keyValues(doc, 330, 135, [
    ['Credit note no.', cn.cn_number], ['Date', cn.issue_date], ['Against invoice', invoice.inv_number],
    ['Invoice date', invoice.issue_date], ['Order no.', cn.so_number],
  ]);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('REASON', 50, 222);
  doc.font('Helvetica').fontSize(9).fillColor(INK).text(cn.reason, 50, 234, { width: 495 });
  let y = table(doc, Math.max(doc.y + 12, 262), [
    { label: '#', width: 25 }, { label: 'SKU', width: 75 }, { label: 'Description', width: 185 },
    { label: 'Qty', width: 50, align: 'right' }, { label: 'Unit price', width: 75, align: 'right' }, { label: 'Amount', width: 85, align: 'right' },
  ], cn.lines.map((l, i) => [i + 1, l.sku || '', l.description, l.quantity, rm(l.unit_price), rm(l.amount)]));
  if (y > 640) { doc.addPage(); y = 50; }
  for (const [k, v] of [['Subtotal', rm(cn.subtotal)], [`SST ${Math.round(cn.sst_rate * 100)}%`, rm(cn.sst_amount)]]) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, 300, y, { width: 160, align: 'right' });
    doc.fillColor(INK).text(v, 465, y, { width: 80, align: 'right' });
    y += 15;
  }
  doc.moveTo(300, y).lineTo(545, y).lineWidth(1).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Total credit (incl. SST)', 280, y + 6, { width: 180, align: 'right' }).text(rm(cn.total), 445, y + 6, { width: 100, align: 'right' });
  y += 36;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(cn.settlement === 'Reduces amount due'
    ? `This credit is deducted from the amount due on ${invoice.inv_number}.`
    : `${invoice.inv_number} was already paid: this credit will be refunded or offset against your next invoice.`, 50, y, { width: 495 });
  doc.fontSize(7.5).text('This is a computer-generated credit note. No signature is required.', 50, 780, { width: 495, align: 'center' });
  return toBuffer(doc);
}

export async function renderDeliveryOrder({ invoice, order, customer }) {
  const s = getOutlet(invoice.outlet_id);
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: invoice.do_number } });
  header(doc, 'DELIVERY ORDER', s);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(order.method === 'pickup' ? 'COLLECTED BY' : 'DELIVER TO', 50, 135);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(customer.name, 50, 148, { width: 230 });
  doc.font('Helvetica').fontSize(9).text(order.method === 'delivery' ? (order.delivery_address || customer.address || '') : `Pickup at: ${s.pickup_address}`, { width: 230 })
    .text(customer.phone || '', { width: 230 });
  keyValues(doc, 330, 135, [
    ['DO no.', invoice.do_number], ['Invoice no.', invoice.inv_number], ['Order no.', order.so_number],
    ['Date', order.fulfil_date], ['Method', order.method === 'pickup' ? 'Pickup' : 'Delivery'], ['Time slot', order.time_slot || '—'],
  ]);
  let y = table(doc, 235, [
    { label: '#', width: 25 }, { label: 'SKU', width: 85 }, { label: 'Description', width: 245 },
    { label: 'Qty', width: 70, align: 'right' }, { label: 'Checked', width: 70, align: 'center' },
  ], order.lines.filter((l) => l.quantity > 0).map((l, i) => [i + 1, l.sku, l.description, `${l.quantity} ${l.uom || ''}`, '[    ]']));
  y = Math.max(y + 30, 560);
  for (const [i, label] of ['Issued by', 'Received by (name & signature)', 'Date / time & company chop'].entries()) {
    const x = 50 + i * 170;
    doc.moveTo(x, y + 40).lineTo(x + 150, y + 40).lineWidth(0.7).strokeColor(INK).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, x, y + 46, { width: 150 });
  }
  doc.fontSize(8).text('Please check all items against this Delivery Order on receipt and confirm in the customer portal ("Mark as Received").', 50, y + 90, { width: 495 });
  return toBuffer(doc);
}

export async function renderKitchenReport({ from, to, rows, generatedAt, outletName = '' }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Production summary ${from} to ${to}` } });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text('ÊTRE PATISSERIE', { characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(GOLD).text(`Central Kitchen${outletName ? ` ${outletName}` : ''} · Production summary`);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Production dates ${from} to ${to} · generated ${generatedAt}`);
  table(doc, 120, [
    { label: 'SKU', width: 75 }, { label: 'Product', width: 170 }, { label: 'Total qty', width: 60, align: 'right' },
    { label: 'Orders', width: 50, align: 'right' }, { label: 'Pickup / delivery dates', width: 140 },
  ], rows.length ? rows.map((r) => [r.sku, r.name, `${r.units} ${r.uom}`, r.orders, r.fulfil_dates.join(', ')]) : [['—', 'No orders in this range', '', '', '']]);
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
