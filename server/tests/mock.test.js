// Default seed: MOCK finance data on the real customers' test logins — clearly numbered, removable.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolatedEnv } from './helpers.js';

const dir = isolatedEnv();
delete process.env.SEED_DEMO;
delete process.env.SEED_MOCK;
const { seedIfEmpty } = await import('../seed.js');
const { default: db } = await import('../db.js');
const { createMock, clearMock, mockCustomers } = await import('../mock-finance.js');
await seedIfEmpty();
after(() => db.close());
const n = (sql) => db.prepare(sql).get().n;
const hasTestLogins = mockCustomers().length > 0;
const uploads = () => (fs.existsSync(path.join(dir, 'uploads')) ? fs.readdirSync(path.join(dir, 'uploads')).length : 0);

test('mock data only on real customers with a test login, every number starts with MOCK-', { skip: !hasTestLogins && 'no test logins on this machine' }, () => {
  assert.ok(n('SELECT COUNT(*) n FROM sales_orders') > 10);
  assert.equal(n("SELECT COUNT(*) n FROM sales_orders WHERE so_number NOT LIKE 'MOCK-SO-%'"), 0);
  assert.equal(n("SELECT COUNT(*) n FROM invoices WHERE inv_number NOT LIKE 'MOCK-INV-%' OR do_number NOT LIKE 'MOCK-DO-%'"), 0);
  assert.equal(n(`SELECT COUNT(*) n FROM sales_orders so WHERE so.customer_id NOT IN
                  (SELECT customer_id FROM users WHERE role = 'customer' AND email LIKE '%@demo.test')`), 0, 'customers without a test login stay clean');
  assert.equal(n('SELECT COUNT(*) n FROM invoices i JOIN sales_orders so ON so.id = i.so_id WHERE i.outlet_id <> so.outlet_id'), 0);
  // finance has a bit of everything to work with
  for (const st of ['Paid', 'Unpaid', 'Slip Uploaded']) assert.ok(n(`SELECT COUNT(*) n FROM invoices WHERE payment_status = '${st}'`) > 0, st);
  assert.ok(n("SELECT COUNT(*) n FROM payment_slips WHERE status = 'Pending'") > 0);
  assert.ok(n("SELECT COUNT(*) n FROM payment_slips WHERE status = 'Rejected'") > 0);
  assert.ok(n("SELECT COUNT(*) n FROM invoices WHERE payment_status <> 'Paid' AND due_date < date('now')") > 0, 'some overdue');
  assert.ok(n("SELECT COUNT(*) n FROM sales_orders so WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.so_id = so.id)") > 0, 'orders to invoice');
});

test('real numbering starts at 0001 despite mock documents', { skip: !hasTestLogins && 'no test logins' }, async () => {
  const { nextNumber } = await import('../sales.js');
  assert.match(nextNumber('sales_orders', 'so_number', 'SO-KL-2026-'), /-0001$/);
  assert.match(nextNumber('invoices', 'inv_number', 'INV-IPH-2026-'), /-0001$/);
});

test('mock:clear removes every mock record and file; mock:finance recreates the same set', { skip: !hasTestLogins && 'no test logins' }, () => {
  const before = { so: n('SELECT COUNT(*) n FROM sales_orders'), inv: n('SELECT COUNT(*) n FROM invoices'), files: uploads() };
  assert.ok(before.files > 0);
  clearMock();
  for (const t of ['sales_orders', 'sales_order_lines', 'delivery_events', 'invoices', 'payment_slips', 'payment_slip_invoices', 'mock_records'])
    assert.equal(n(`SELECT COUNT(*) n FROM ${t}`), 0, `${t} empty`);
  assert.equal(n("SELECT COUNT(*) n FROM notifications WHERE title LIKE '%MOCK-%'"), 0);
  assert.equal(n("SELECT COUNT(*) n FROM files WHERE kind = 'slip'"), 0);
  assert.equal(uploads(), 0, 'slip files deleted from disk');
  assert.ok(n('SELECT COUNT(*) n FROM customers') > 0, 'customers kept');
  createMock();
  assert.equal(n('SELECT COUNT(*) n FROM sales_orders'), before.so);
  assert.equal(n('SELECT COUNT(*) n FROM invoices'), before.inv);
});

test('mock purchasing: MOCK POs, supplier bills and ingredient usage — stock levels unchanged, all removable', { skip: !hasTestLogins && 'no test logins' }, async () => {
  const stock = () => JSON.stringify(db.prepare('SELECT product_id, outlet_id, stock_on_hand FROM product_stock ORDER BY 1, 2').all());
  assert.ok(n('SELECT COUNT(*) n FROM purchase_orders') > 0);
  assert.equal(n("SELECT COUNT(*) n FROM purchase_orders WHERE po_number NOT LIKE 'MOCK-PO-%'"), 0);
  assert.ok(n("SELECT COUNT(*) n FROM supplier_bills WHERE status = 'Paid'") > 0);
  assert.ok(n("SELECT COUNT(*) n FROM supplier_bills WHERE status = 'Unpaid'") > 0);
  assert.ok(n("SELECT COUNT(*) n FROM purchase_orders po WHERE NOT EXISTS (SELECT 1 FROM supplier_bills b WHERE b.po_id = po.id)") > 0, 'a bill to record');
  // the cycle can be worked out for both companies from the mock history
  const { cashCycle } = await import('../payables.js');
  for (const o of db.prepare('SELECT DISTINCT c.outlet_id FROM customers c JOIN users u ON u.customer_id = c.id').all()) {
    const c = cashCycle(o.outlet_id, 3).overall;
    assert.ok(c.dio > 0 && c.dpo > 0 && c.dso != null && c.ccc != null, JSON.stringify(c));
    assert.equal(c.ccc, Math.round((c.dio + c.dso - c.dpo) * 100) / 100);
  }
  const withMock = stock();
  clearMock();
  assert.equal(stock(), withMock, 'mock usage and restocks net to zero: stock levels never change');
  for (const t of ['purchase_orders', 'purchase_order_lines', 'supplier_bills']) assert.equal(n(`SELECT COUNT(*) n FROM ${t}`), 0, `${t} empty`);
  assert.equal(n("SELECT COUNT(*) n FROM stock_movements WHERE ref LIKE 'MOCK%' OR reason LIKE 'MOCK%'"), 0);
  createMock();
});
