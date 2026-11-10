import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'erp.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- ---------- Master data ----------
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    contact TEXT, email TEXT, phone TEXT, address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    uom TEXT DEFAULT 'EA',
    unit_cost REAL DEFAULT 0,          -- purchase cost
    sell_price REAL DEFAULT 0,         -- price shown to customers
    stock_on_hand INTEGER DEFAULT 0,   -- physical quantity in warehouse
    reorder_level INTEGER DEFAULT 0,   -- low-stock alert threshold (on available qty)
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    contact TEXT, email TEXT, phone TEXT, address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Auth ----------
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','customer')),
    customer_id INTEGER REFERENCES customers(id),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Purchasing ----------
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number TEXT UNIQUE NOT NULL,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    order_date TEXT NOT NULL, expected_date TEXT,
    status TEXT NOT NULL DEFAULT 'Draft'
      CHECK (status IN ('Draft','Submitted','Approved','Received','Cancelled')),
    notes TEXT,
    tax_rate REAL DEFAULT 0, subtotal REAL DEFAULT 0, tax_amount REAL DEFAULT 0, total REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    product_id INTEGER REFERENCES products(id),
    description TEXT NOT NULL,
    quantity REAL NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL
  );

  -- ---------- Sales ----------
  CREATE TABLE IF NOT EXISTS sales_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_number TEXT UNIQUE NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    order_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending'
      CHECK (status IN ('Pending','Confirmed','Packed','Shipped','Delivered','Cancelled')),
    delivery_address TEXT,
    notes TEXT,
    carrier TEXT, tracking_no TEXT,
    total REAL NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL, unit_price REAL NOT NULL, line_total REAL NOT NULL
  );

  -- Delivery / status timeline shown to customers
  CREATE TABLE IF NOT EXISTS delivery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL, note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Inventory ----------
  -- Reserved quantity: open sales orders hold stock automatically; admins can add manual holds
  CREATE TABLE IF NOT EXISTS stock_holds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    reason TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    so_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Released','Fulfilled')),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    released_at TEXT
  );

  -- Every change to stock_on_hand is logged here
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK (type IN ('receipt','sale','adjustment')),
    qty INTEGER NOT NULL,              -- signed: + in, - out
    balance_after INTEGER NOT NULL,
    reason TEXT, ref TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Notifications ----------
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, message TEXT, link TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_so_customer ON sales_orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_holds_product ON stock_holds(product_id, status);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`);

// ---------- Migrations: add columns to existing databases without losing data ----------
function ensureColumn(table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
// Catalog fields (see server/data/catalog.json)
ensureColumn('products', 'category_code', 'category_code TEXT');
ensureColumn('products', 'size', 'size TEXT');
ensureColumn('products', 'moq', 'moq INTEGER NOT NULL DEFAULT 1');           // minimum order quantity
ensureColumn('products', 'recommended_rsp', 'recommended_rsp TEXT');       // suggested retail price, e.g. "RM 19–22 per slice"
ensureColumn('products', 'shelf_life', 'shelf_life TEXT');
ensureColumn('products', 'notes', 'notes TEXT');
ensureColumn('products', 'is_sellable', 'is_sellable INTEGER NOT NULL DEFAULT 1'); // 0 = ingredient / packaging, hidden from customers

export default db;
