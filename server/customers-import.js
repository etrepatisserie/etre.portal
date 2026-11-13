// Imports the real B2B customers from server/data/customers.json (extracted from the accounting
// system's debtor reports; the file is git-ignored). Matches on customer code (debtor code):
// new customers are added, existing ones get their details updated. Order history is never touched.
// Portal logins are only created for customers marked with "demo_login" (test accounts); Admin creates
// the real ones per customer when ready.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { outletByCode } from './outlets.js';
import { TERMS } from './terms.js';
import { todayMYT } from './schedule.js';
import { hashPassword } from './passwords.js';

// Test portal logins for a few real customers (marked with "demo_login" in customers.json).
// They only let you see the portal as that customer — no orders or invoices are invented.
export const DEMO_LOGIN_PASSWORD = 'customer123';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'customers.json');
export const hasRealCustomers = () => fs.existsSync(FILE);

export function importCustomers() {
  const result = { inserted: [], updated: [], flagged: [], skipped: [], logins: [] };
  if (!hasRealCustomers()) return result;
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const find = db.prepare('SELECT id FROM customers WHERE code = ?');
  const fields = ['name', 'outlet_id', 'reg_no', 'contact', 'email', 'phone', 'phone2', 'address', 'billing_address', 'payment_term', 'credit_limit'];
  db.transaction(() => {
    for (const c of data.customers) {
      const outlet = outletByCode(c.outlet);
      if (!outlet || !TERMS[c.term]) { result.skipped.push(`${c.code}: unknown outlet or term`); continue; }
      const row = {
        name: c.name, outlet_id: outlet.id, reg_no: c.reg_no, contact: c.contact, email: c.email, phone: c.phone, phone2: c.phone2,
        address: c.delivery_address, billing_address: c.billing_address, payment_term: c.term, credit_limit: c.credit_limit,
      };
      const existing = find.get(c.code);
      if (existing) {
        db.prepare(`UPDATE customers SET ${fields.map((f) => `${f} = ?`).join(', ')}, is_demo = 0 WHERE id = ?`).run(...fields.map((f) => row[f] ?? null), existing.id);
        result.updated.push(c.code);
      } else {
        db.prepare(`INSERT INTO customers (code, ${fields.join(', ')}, is_demo, account_start_date) VALUES (?, ${fields.map(() => '?').join(', ')}, 0, ?)`)
          .run(c.code, ...fields.map((f) => row[f] ?? null), todayMYT());
        result.inserted.push(c.code);
      }
      if (c.demo_login) {
        const id = existing?.id ?? find.get(c.code).id;
        const hasLogin = db.prepare('SELECT 1 FROM users WHERE customer_id = ? OR email = ?').get(id, c.demo_login);
        if (!hasLogin) {
          db.prepare("INSERT INTO users (email, password_hash, name, role, customer_id, outlet_id) VALUES (?,?,?, 'customer', ?, NULL)")
            .run(c.demo_login, hashPassword(DEMO_LOGIN_PASSWORD), c.contact || c.name, id);
          result.logins.push(`${c.code} → ${c.demo_login}`);
        }
      }
      if (c._flags) result.flagged.push({ code: c.code, name: c.name, outlet: c.outlet, flags: c._flags });
    }
  })();
  return result;
}
