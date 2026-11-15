// CLI: npm run db:check — connects to MySQL with the .env settings and lists the tables.
import { config } from '../config.js';
import { pool, checkConnection, get } from '../mysql.js';

try {
  const { version, tables } = await checkConnection();
  console.log(`Connected to MySQL ${version} — database "${config.db.database}" on ${config.db.host}:${config.db.port} as ${config.db.user}`);
  if (!tables.length) console.log(`No tables yet. Run: mysql -u ${config.db.user} -p ${config.db.database} < server/sql/schema.sql`);
  else {
    console.log(`${tables.length} tables.`);
    for (const t of ['outlets', 'users', 'customers', 'products', 'sales_orders', 'invoices']) {
      if (!tables.includes(t)) continue;
      const { n } = await get(`SELECT COUNT(*) AS n FROM \`${t}\``);
      console.log(`  ${t.padEnd(14)} ${n} rows`);
    }
  }
} catch (err) {
  console.error('MySQL connection failed:', err.message);
  console.error('Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME in your .env file.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
