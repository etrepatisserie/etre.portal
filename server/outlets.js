// Outlets = separate companies (KL, Ipoh): own company details, bank, pickup, delivery area,
// kitchen, stock and document numbering. Starting rows: sql/seed.sql;
// company details come from the debtor reports (server/data/customers.json) when present, else Admin › Settings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { HttpError } from './errors.js';
import { getSettings } from './settings.js';

export async function ensureOutlets() {
  const cols = ['company_name', 'company_address', 'company_reg_no', 'sst_reg_no', 'bank_name', 'bank_account_name', 'bank_account_no',
    'pickup_address', 'pickup_slots', 'delivery_slots', 'delivery_area', 'email'];
  // company details from the accounting system's debtor reports, if available
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'customers.json');
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [code, o] of Object.entries(data.outlets || {})) {
      for (const [k, v] of Object.entries(o)) if (cols.includes(k)) await db.prepare(`UPDATE outlets SET ${k} = ? WHERE code = ?`).run(v, code);
    }
  }
  // delivery fee rules are per company; a company without its own yet starts from the old shared values
  const s = await getSettings();
  await db.prepare('UPDATE outlets SET delivery_fee = ? WHERE delivery_fee IS NULL').run(s.delivery_fee);
  await db.prepare('UPDATE outlets SET free_delivery_threshold = ? WHERE free_delivery_threshold IS NULL').run(s.free_delivery_threshold);
  // every product has a stock row in every outlet
  await db.prepare('INSERT IGNORE INTO product_stock (product_id, outlet_id) SELECT p.id, o.id FROM products p, outlets o').run();
}

const parse = (o) => o && { ...o, pickup_slots: JSON.parse(o.pickup_slots || '[]'), delivery_slots: JSON.parse(o.delivery_slots || '[]') };
export const listOutlets = async () => (await db.prepare('SELECT * FROM outlets ORDER BY id').all()).map(parse);
export const getOutlet = async (id) => parse(await db.prepare('SELECT * FROM outlets WHERE id = ?').get(id));
export const outletByCode = async (code) => parse(await db.prepare('SELECT * FROM outlets WHERE code = ?').get(code));
export const customerOutlet = async (customerId) => await getOutlet((await db.prepare('SELECT outlet_id FROM customers WHERE id = ?').get(customerId))?.outlet_id);
// pricing rules for one company: shared SST rate + that company's delivery fee and free-delivery amount
export async function pricingFor(outletId) {
  const s = await getSettings(), o = await getOutlet(outletId);
  return { ...s, delivery_fee: o?.delivery_fee ?? s.delivery_fee, free_delivery_threshold: o?.free_delivery_threshold ?? s.free_delivery_threshold };
}
export const bankOf = (o) => ({ bank: o.bank_name, account_name: o.bank_account_name, account_no: o.bank_account_no });

// The outlet a request is limited to: customers → their outlet; outlet staff → their outlet;
// head-office staff → the outlet picked in the menu bar (X-Outlet header), or null = all outlets.
export async function scopeOf(req) {
  if (req.user.role === 'customer') return (await db.prepare('SELECT outlet_id FROM customers WHERE id = ?').get(req.user.customer_id)).outlet_id;
  if (req.user.outlet_id) return req.user.outlet_id;
  const h = Number(req.headers['x-outlet']);
  return h && await getOutlet(h) ? h : null;
}
// SQL fragment limiting a query to the request's outlet (number only, never user text)
export const outletSql = (req, alias) => (req.outletId ? ` AND ${alias}.outlet_id = ${Number(req.outletId)}` : '');
// Throw 404 when a record belongs to another outlet
export function assertOutlet(req, outletId) {
  if (req.outletId && Number(outletId) !== Number(req.outletId)) throw new HttpError(404, 'Not found');
}
// Writes that need one specific outlet (stock, purchase orders…)
export async function requireOutlet(req, bodyOutletId) {
  const id = req.outletId || Number(bodyOutletId) || null;
  if (!id || !await getOutlet(id)) throw new HttpError(400, 'Choose KL or Ipoh first (outlet switch at the top of the page)');
  return id;
}
