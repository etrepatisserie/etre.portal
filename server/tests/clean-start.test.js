// Seed without demo or mock data (SEED_MOCK=0): only real customers, no invented orders, invoices, slips or emails.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolatedEnv } from './helpers.js';

isolatedEnv();
delete process.env.SEED_DEMO;
process.env.SEED_MOCK = '0';
const { seedIfEmpty } = await import('../seed.js');
const { default: db } = await import('../db.js');
const { hasRealCustomers } = await import('../customers-import.js');
await seedIfEmpty();
after(() => db.close());

const n = (sql) => db.prepare(sql).get().n;

test('clean start: no demo customers and no transactional history', () => {
  assert.equal(n('SELECT COUNT(*) AS n FROM customers WHERE is_demo = 1'), 0);
  for (const t of ['sales_orders', 'invoices', 'payment_slips', 'email_outbox', 'discrepancies', 'credit_term_requests', 'purchase_orders', 'announcements'])
    assert.equal(n(`SELECT COUNT(*) AS n FROM ${t}`), 0, `${t} should be empty`);
  // only the test logins marked "demo_login" in customers.json — never for demo customers
  assert.equal(n("SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND email NOT LIKE '%@demo.test'"), 0);
  assert.equal(n("SELECT COUNT(*) AS n FROM users u JOIN customers c ON c.id = u.customer_id WHERE c.is_demo = 1"), 0);
});

test('clean start: staff logins, real customers (if the local file exists) and ingredient opening stock', () => {
  assert.equal(n("SELECT COUNT(*) AS n FROM users WHERE role <> 'customer'"), 6);
  if (hasRealCustomers()) assert.ok(n('SELECT COUNT(*) AS n FROM customers') > 0);
  assert.ok(n("SELECT COUNT(*) AS n FROM stock_movements WHERE reason = 'Opening stock'") > 0);
  assert.equal(n("SELECT COUNT(*) AS n FROM stock_movements WHERE reason <> 'Opening stock'"), 0);
});
