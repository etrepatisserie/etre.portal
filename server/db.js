import { AsyncLocalStorage } from 'node:async_hooks';
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
  decimalNumbers: true,
  timezone: '+08:00',
});
pool.on('connection', (conn) => conn.query("SET time_zone = '+08:00'"));

const txConn = new AsyncLocalStorage();
const runner = () => txConn.getStore() || pool;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v);

function bind(sql, args) {
  if (args.length === 1 && isPlainObject(args[0])) {
    const named = args[0];
    const params = [];
    const text = sql.replace(/@([A-Za-z_]\w*)/g, (_, name) => { params.push(named[name] ?? null); return '?'; });
    return [text, params];
  }
  return [sql, args.flat().map((v) => (v === undefined ? null : v))];
}

async function query(sql, args) {
  const [text, params] = bind(sql, args);
  const [rows] = await runner().query(text, params);
  return rows;
}

const db = {
  pool,
  prepare(sql) {
    return {
      all: (...args) => query(sql, args),
      get: async (...args) => (await query(sql, args))[0],
      run: async (...args) => {
        const r = await query(sql, args);
        return { changes: r.affectedRows, lastInsertRowid: r.insertId };
      },
    };
  },
  transaction(fn) {
    return async (...args) => {
      if (txConn.getStore()) return fn(...args);
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const out = await txConn.run(conn, () => fn(...args));
        await conn.commit();
        return out;
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    };
  },
  async check() {
    const [[{ version }]] = await pool.query('SELECT VERSION() AS version');
    const [tables] = await pool.query('SHOW TABLES');
    return { version, tables: tables.map((t) => Object.values(t)[0]) };
  },
  close: () => pool.end(),
};

export default db;
