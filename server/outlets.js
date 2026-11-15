// Outlets = separate companies (KL, Ipoh): own company details, bank, pickup, delivery area,
// kitchen, stock and document numbering. Defaults below are written on first start;
// company names come from the debtor reports (server/data/customers.json) when present.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { HttpError } from './errors.js';
import { getSettings } from './settings.js';

const SLOTS = (prefix) => JSON.stringify([`${prefix} 9:00 AM – 11:00 AM`, `${prefix} 11:00 AM – 1:00 PM`, `${prefix} 2:00 PM – 5:00 PM`]);
const DEFAULTS = [
  {
    code: 'KL', name: 'Kuala Lumpur',
    company_name: 'ETRE PATISSERIE KL SDN BHD', company_address: '[PLACEHOLDER] KL company address',
    company_reg_no: '202301018733 (1512655-A)', sst_reg_no: '[PLACEHOLDER] SST reg. no.',
    bank_name: 'Maybank', bank_account_name: 'ETRE PATISSERIE KL SDN BHD', bank_account_no: '514012480012',
    pickup_address: '[PLACEHOLDER] KL outlet address', pickup_slots: SLOTS('[PLACEHOLDER]'),
    delivery_slots: JSON.stringify(['[PLACEHOLDER] 8:00 AM – 11:00 AM', '[PLACEHOLDER] 11:00 AM – 2:00 PM']),
    delivery_area: 'Kuala Lumpur / Klang Valley', email: 'kl.etrepatisserie@gmail.com',
  },
  {
    code: 'IPH', name: 'Ipoh',
    company_name: 'ETRE PATISSERIE SDN BHD', company_address: '30-Jalan Lee Kwee Foh, Taman Canning, 31400 Ipoh, Perak',
    company_reg_no: '1375339-U', sst_reg_no: '[PLACEHOLDER] SST reg. no.',
    bank_name: 'RHB Bank', bank_account_name: 'ETRE PATISSERIE SDN BHD', bank_account_no: '20809800044129',
    pickup_address: '[PLACEHOLDER] Ipoh outlet address', pickup_slots: SLOTS('[PLACEHOLDER]'),
    delivery_slots: JSON.stringify(['[PLACEHOLDER] 8:00 AM – 11:00 AM', '[PLACEHOLDER] 11:00 AM – 2:00 PM']),
    delivery_area: 'Ipoh & surrounding Perak [PLACEHOLDER]', email: 'etrepatisserie@gmail.com',
  },
];

export function ensureOutlets() {
  const cols = Object.keys(DEFAULTS[0]);
  const ins = db.prepare(`INSERT OR IGNORE INTO outlets (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  for (const o of DEFAULTS) ins.run(...cols.map((c) => o[c]));
  // fill in details that are still placeholders once the real value is known (e.g. Ipoh's bank account)
  for (const o of DEFAULTS) for (const c of cols) {
    if (String(o[c]).startsWith('[PLACEHOLDER]')) continue;
    const filled = db.prepare(`UPDATE outlets SET ${c} = ? WHERE code = ? AND (${c} LIKE '[PLACEHOLDER]%' OR ${c} IS NULL OR ${c} = '')`).run(o[c], o.code).changes;
    // invoice PDFs already made still show the placeholder → make them again next time they're opened
    if (filled && (c.startsWith('bank_') || c === 'email')) db.prepare('UPDATE invoices SET invoice_file_id = NULL WHERE outlet_id = (SELECT id FROM outlets WHERE code = ?)').run(o.code);
  }
  // company details from the accounting system's debtor reports, if available
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'customers.json');
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [code, o] of Object.entries(data.outlets || {})) {
      for (const [k, v] of Object.entries(o)) if (cols.includes(k)) db.prepare(`UPDATE outlets SET ${k} = ? WHERE code = ?`).run(v, code);
    }
  }
  // delivery fee rules are per company; a company without its own yet starts from the old shared values
  const s = getSettings();
  db.prepare('UPDATE outlets SET delivery_fee = ? WHERE delivery_fee IS NULL').run(s.delivery_fee);
  db.prepare('UPDATE outlets SET free_delivery_threshold = ? WHERE free_delivery_threshold IS NULL').run(s.free_delivery_threshold);
  // every product has a stock row in every outlet
  db.prepare('INSERT OR IGNORE INTO product_stock (product_id, outlet_id) SELECT p.id, o.id FROM products p, outlets o').run();
}
ensureOutlets();

const parse = (o) => o && { ...o, pickup_slots: JSON.parse(o.pickup_slots || '[]'), delivery_slots: JSON.parse(o.delivery_slots || '[]') };
export const listOutlets = () => db.prepare('SELECT * FROM outlets ORDER BY id').all().map(parse);
export const getOutlet = (id) => parse(db.prepare('SELECT * FROM outlets WHERE id = ?').get(id));
export const outletByCode = (code) => parse(db.prepare('SELECT * FROM outlets WHERE code = ?').get(code));
export const customerOutlet = (customerId) => getOutlet(db.prepare('SELECT outlet_id FROM customers WHERE id = ?').get(customerId)?.outlet_id);
// pricing rules for one company: shared SST rate + that company's delivery fee and free-delivery amount
export function pricingFor(outletId) {
  const s = getSettings(), o = getOutlet(outletId);
  return { ...s, delivery_fee: o?.delivery_fee ?? s.delivery_fee, free_delivery_threshold: o?.free_delivery_threshold ?? s.free_delivery_threshold };
}
export const bankOf = (o) => ({ bank: o.bank_name, account_name: o.bank_account_name, account_no: o.bank_account_no });

// The outlet a request is limited to: customers → their outlet; outlet staff → their outlet;
// head-office staff → the outlet picked in the menu bar (X-Outlet header), or null = all outlets.
export function scopeOf(req) {
  if (req.user.role === 'customer') return db.prepare('SELECT outlet_id FROM customers WHERE id = ?').get(req.user.customer_id).outlet_id;
  if (req.user.outlet_id) return req.user.outlet_id;
  const h = Number(req.headers['x-outlet']);
  return h && getOutlet(h) ? h : null;
}
// SQL fragment limiting a query to the request's outlet (number only, never user text)
export const outletSql = (req, alias) => (req.outletId ? ` AND ${alias}.outlet_id = ${Number(req.outletId)}` : '');
// Throw 404 when a record belongs to another outlet
export function assertOutlet(req, outletId) {
  if (req.outletId && Number(outletId) !== Number(req.outletId)) throw new HttpError(404, 'Not found');
}
// Writes that need one specific outlet (stock, purchase orders…)
export function requireOutlet(req, bodyOutletId) {
  const id = req.outletId || Number(bodyOutletId) || null;
  if (!id || !getOutlet(id)) throw new HttpError(400, 'Choose KL or Ipoh first (outlet switch at the top of the page)');
  return id;
}
