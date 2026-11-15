// MySQL connection pool (mysql2) — the target database for the portal.
// Settings: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME in the .env file.
// Create the tables with `mysql -u DB_USER -p DB_NAME < server/sql/schema.sql`, then the starting data with
// `... < server/sql/seed.sql`; `npm run db:check` confirms the connection.
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
  timezone: '+08:00',   // Kuala Lumpur, same as the SQL scripts
});

// Same shape as the better-sqlite3 calls the server uses today, so the port is one-to-one:
//   all(sql, params) → rows · get(sql, params) → first row or null · run(sql, params) → { lastInsertRowid, changes }
export async function all(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
export async function get(sql, params = []) {
  return (await all(sql, params))[0] ?? null;
}
export async function run(sql, params = []) {
  const [r] = await pool.execute(sql, params);
  return { lastInsertRowid: r.insertId, changes: r.affectedRows };
}

// Run several statements in one transaction: await transaction(async (conn) => { await conn.execute(...) })
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function checkConnection() {
  const conn = await pool.getConnection();
  try {
    const [[{ version }]] = await conn.query('SELECT VERSION() AS version');
    const [tables] = await conn.query('SHOW TABLES');
    return { version, tables: tables.map((t) => Object.values(t)[0]) };
  } finally {
    conn.release();
  }
}
