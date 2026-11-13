// CLI: npm run import:customers
import { importCustomers, hasRealCustomers } from './customers-import.js';

if (!hasRealCustomers()) { console.log('server/data/customers.json not found — nothing to import.'); process.exit(0); }
const r = importCustomers();
console.log(`Customers imported: ${r.inserted.length} added, ${r.updated.length} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`);
for (const s of r.skipped) console.log('  skipped', s);
for (const l of r.logins) console.log('  test login created:', l, '(password customer123)');
if (r.flagged.length) {
  console.log(`\n${r.flagged.length} customers need checking:`);
  for (const f of r.flagged) console.log(`  ${f.outlet.padEnd(3)} ${f.code}  ${f.name} — ${f.flags.join('; ')}`);
}
