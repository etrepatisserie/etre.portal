// CLI: npm run mock:finance  → (re)create mock finance data on the real customers' test logins
//      npm run mock:clear    → remove every mock record
//      npm run mock:purchasing → add only mock purchasing (POs, supplier bills, usage) to existing mock data
import { createMock, clearMock, createMockPurchasing } from './mock-finance.js';

if (process.argv[2] === 'purchasing') {
  // add only the mock purchasing history (POs, supplier bills, ingredient usage) to existing mock data
  const r = createMockPurchasing();
  console.log(r.skipped ? `Mock purchasing already there (${r.purchase_orders} POs) — nothing added.` : `Mock purchasing added: ${r.purchase_orders} purchase orders, ${r.supplier_bills} supplier bills (all MOCK-…).`);
} else if (process.argv[2] === 'clear') {
  const r = clearMock();
  console.log(`Mock data removed: ${r.sales_orders} orders, ${r.invoices} invoices, ${r.payment_slips} slips, ${r.files} files, ${r.notifications} notifications.`);
} else {
  const r = createMock();
  if (!r.customers.length) console.log('No real customers with a @demo.test login — add "demo_login" in server/data/customers.json and run npm run import:customers first.');
  else {
    console.log(`Mock data created: ${r.orders} orders, ${r.invoices} invoices, ${r.slips} payment slips (all numbered MOCK-…).`);
    for (const c of r.customers) console.log(`  ${c.outlet.padEnd(3)} ${c.code}  ${c.name} (${c.term}) — ${c.role}`);
  }
}
