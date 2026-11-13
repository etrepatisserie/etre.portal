import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// A database created before Task 4 has the old order statuses baked into a CHECK rule.
const oldOrders = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sales_orders'").get();
if (oldOrders && !oldOrders.sql.includes('Invoiced')) {
  throw new Error('This database was created before Task 4 (old order statuses). Run `npm run reset-db` to rebuild it with mock data — a backup of the old one is in backups/.');
}

// A database from before the KL / Ipoh split has no outlet columns.
const oldCustomers = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'customers'").get();
if (oldCustomers && !oldCustomers.sql.includes('outlet_id')) {
  throw new Error('This database was created before the KL / Ipoh outlets were added. Run `npm run reset-db` to rebuild it with mock data.');
}

const ORDER_STATUSES = "'Pending','Confirmed','Invoiced','Processing','Ready for Pickup','Out for Delivery','Received','Cancelled'";

db.exec(`
  -- ---------- Master data ----------
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    contact TEXT, email TEXT, phone TEXT, address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('slip','invoice','do','product_image','discrepancy')),
    customer_id INTEGER,                 -- owner; NULL for product images
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,           -- random name inside UPLOAD_DIR
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    category TEXT DEFAULT 'General', category_code TEXT,
    size TEXT, uom TEXT DEFAULT 'PC',
    unit_cost REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,           -- wholesale price before SST
    moq INTEGER NOT NULL DEFAULT 1,
    recommended_rsp TEXT, shelf_life TEXT,
    storage_notes TEXT, heating_notes TEXT,
    notes TEXT,                          -- category note, e.g. Lescure butter
    is_sellable INTEGER NOT NULL DEFAULT 1,  -- 0 = ingredient / packaging
    is_available INTEGER NOT NULL DEFAULT 1, -- admin switch: 0 hides "order" for this product
    image_file_id INTEGER REFERENCES files(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),   -- home outlet: pickup, delivery, kitchen, company that invoices
    reg_no TEXT,                          -- company registration no. (shown on invoices)
    contact TEXT, email TEXT, phone TEXT, phone2 TEXT,
    address TEXT,                         -- delivery address
    billing_address TEXT,                 -- "Bill to" on invoices (falls back to address)
    payment_term TEXT NOT NULL DEFAULT 'COD' CHECK (payment_term IN ('COD','NET14','NET15','NET30')),
    credit_limit REAL,
    is_demo INTEGER NOT NULL DEFAULT 0,   -- 1 = mock customer for trying the system
    account_start_date TEXT NOT NULL DEFAULT (date('now')),
    term_updated_at TEXT, term_updated_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Auth ----------
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','finance','kitchen','customer')),
    customer_id INTEGER REFERENCES customers(id),
    outlet_id INTEGER REFERENCES outlets(id),           -- staff: their outlet; NULL = head office (both outlets)
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

  -- ---------- Outlets (separate companies: KL, Ipoh) ----------
  CREATE TABLE IF NOT EXISTS outlets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,            -- KL, IPH — used in SO / INV / DO numbers
    name TEXT NOT NULL,                   -- "Kuala Lumpur", "Ipoh"
    company_name TEXT NOT NULL, company_address TEXT, company_reg_no TEXT, sst_reg_no TEXT,
    bank_name TEXT, bank_account_name TEXT, bank_account_no TEXT,
    pickup_address TEXT, pickup_slots TEXT, delivery_slots TEXT,   -- slots are JSON arrays
    delivery_area TEXT
  );

  -- Stock is kept per outlet (each outlet has its own kitchen and ingredients)
  CREATE TABLE IF NOT EXISTS product_stock (
    product_id INTEGER NOT NULL REFERENCES products(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    stock_on_hand INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, outlet_id)
  );

  -- ---------- Purchasing ----------
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number TEXT UNIQUE NOT NULL,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),   -- which outlet receives the goods
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
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    order_date TEXT NOT NULL,            -- UTC timestamp the order was placed
    processing_day TEXT,                 -- working day (MYT) the order counts as, after cutoff rules
    production_date TEXT,                -- fulfil_date - 1
    fulfil_date TEXT,                    -- pickup / delivery date chosen by the customer
    method TEXT NOT NULL DEFAULT 'delivery' CHECK (method IN ('pickup','delivery')),
    time_slot TEXT,
    delivery_address TEXT,
    area_confirmed INTEGER NOT NULL DEFAULT 0,  -- customer confirmed KL / Klang Valley
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN (${ORDER_STATUSES})),
    subtotal REAL NOT NULL DEFAULT 0,
    delivery_fee REAL NOT NULL DEFAULT 0,
    sst_rate REAL NOT NULL DEFAULT 0,
    sst_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,       -- incl. SST
    delivery_provider TEXT, delivery_link TEXT,
    printed_at TEXT,                     -- kitchen printed the PO / production sheet
    confirmed_at TEXT, confirmed_by INTEGER REFERENCES users(id),
    received_at TEXT, matches_do INTEGER,
    cancel_reason TEXT,
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sales_order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    description TEXT NOT NULL,
    original_quantity INTEGER NOT NULL,  -- as ordered by the customer
    quantity INTEGER NOT NULL,           -- after admin adjustments (0 = removed)
    unit_price REAL NOT NULL, line_total REAL NOT NULL
  );

  -- Quantity changes made by admin before confirmation
  CREATE TABLE IF NOT EXISTS order_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    batch TEXT NOT NULL,                 -- groups the lines changed in one save
    line_id INTEGER NOT NULL, product_name TEXT NOT NULL,
    old_qty INTEGER NOT NULL, new_qty INTEGER NOT NULL,
    reason TEXT NOT NULL,
    totals_before TEXT, totals_after TEXT,  -- JSON
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS delivery_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL, note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS discrepancies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    line_id INTEGER, product_name TEXT NOT NULL,
    qty INTEGER, note TEXT,
    file_id INTEGER REFERENCES files(id),
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
    resolution TEXT, resolved_by INTEGER, resolved_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Finance ----------
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inv_number TEXT UNIQUE NOT NULL,     -- INV-YYYY-0001
    do_number TEXT UNIQUE NOT NULL,      -- DO-YYYY-0001
    so_id INTEGER NOT NULL UNIQUE REFERENCES sales_orders(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),   -- the company that issues the invoice
    issue_date TEXT NOT NULL, due_date TEXT NOT NULL,
    subtotal REAL NOT NULL, delivery_fee REAL NOT NULL, sst_rate REAL NOT NULL, sst_amount REAL NOT NULL, total REAL NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid','Slip Uploaded','Paid','Rejected')),
    source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','uploaded')),
    invoice_file_id INTEGER REFERENCES files(id),
    do_file_id INTEGER REFERENCES files(id),
    paid_at TEXT,
    void INTEGER NOT NULL DEFAULT 0,
    issued_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payment_slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    so_id INTEGER REFERENCES sales_orders(id),  -- COD slip sent with the order, before the invoice exists
    file_id INTEGER NOT NULL REFERENCES files(id),
    reference TEXT, amount REAL,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Verified','Rejected')),
    reject_reason TEXT,
    uploaded_by INTEGER REFERENCES users(id),
    reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payment_slip_invoices (
    slip_id INTEGER NOT NULL REFERENCES payment_slips(id) ON DELETE CASCADE,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    PRIMARY KEY (slip_id, invoice_id)
  );

  CREATE TABLE IF NOT EXISTS credit_term_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
    note TEXT,
    decided_by INTEGER REFERENCES users(id), decided_at TEXT, decision_note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Content ----------
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, body TEXT,
    outlet_id INTEGER REFERENCES outlets(id),            -- NULL = both outlets
    type TEXT NOT NULL DEFAULT 'notice' CHECK (type IN ('notice','closure','price_change')),
    starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,     -- banner shown between these dates (inclusive)
    closure_from TEXT, closure_to TEXT,                 -- for type 'closure': dates with no pickup/delivery or processing
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Inventory ----------
  CREATE TABLE IF NOT EXISTS stock_holds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    reason TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    so_id INTEGER REFERENCES sales_orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Released','Fulfilled')),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    released_at TEXT
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    type TEXT NOT NULL CHECK (type IN ('receipt','sale','adjustment')),
    qty INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT, ref TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ---------- Notifications & email ----------
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, message TEXT, link TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL, subject TEXT NOT NULL,
    html TEXT NOT NULL, text TEXT,
    template TEXT NOT NULL,
    related_type TEXT, related_id INTEGER,
    outlet_id INTEGER REFERENCES outlets(id),
    status TEXT NOT NULL DEFAULT 'logged' CHECK (status IN ('logged','sent','failed')),
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_so_customer ON sales_orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_so_outlet ON sales_orders(outlet_id, status);
  CREATE INDEX IF NOT EXISTS idx_inv_outlet ON invoices(outlet_id);
  CREATE INDEX IF NOT EXISTS idx_so_status ON sales_orders(status);
  CREATE INDEX IF NOT EXISTS idx_so_production ON sales_orders(production_date);
  CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id, payment_status);
  CREATE INDEX IF NOT EXISTS idx_holds_product ON stock_holds(product_id, outlet_id, status);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
`);

// ---------- Future migrations: add columns without losing data ----------
export function ensureColumn(table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn('payment_slips', 'so_id', 'so_id INTEGER REFERENCES sales_orders(id)');

// Complaints: Admin resolves each one with a credit note (issued by Finance) or a free replacement order
ensureColumn('sales_orders', 'replacement_for', 'replacement_for INTEGER REFERENCES sales_orders(id)');   // no charge, never invoiced
ensureColumn('discrepancies', 'action', "action TEXT"); // 'credit_note' | 'replacement'
ensureColumn('discrepancies', 'replacement_so_id', 'replacement_so_id INTEGER REFERENCES sales_orders(id)');
db.exec(`
  CREATE TABLE IF NOT EXISTS credit_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cn_number TEXT UNIQUE,                 -- CN-KL-2026-0001, given when Finance issues it
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),   -- the company that issues it (same as the invoice)
    so_id INTEGER NOT NULL REFERENCES sales_orders(id),
    invoice_id INTEGER REFERENCES invoices(id),          -- set when issued
    discrepancy_id INTEGER REFERENCES discrepancies(id), -- the complaint it settles (null = raised by Finance)
    reason TEXT NOT NULL,
    lines TEXT NOT NULL,                   -- JSON [{line_id, sku, description, quantity, unit_price, amount}]
    subtotal REAL NOT NULL, sst_rate REAL NOT NULL, sst_amount REAL NOT NULL, total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Issued','Rejected')),
    settlement TEXT,                       -- 'Reduces amount due' | 'Refund or offset (invoice already paid)'
    reject_reason TEXT,
    requested_by INTEGER REFERENCES users(id), requested_at TEXT DEFAULT (datetime('now')),
    issued_by INTEGER REFERENCES users(id), issued_at TEXT, issue_date TEXT,
    file_id INTEGER REFERENCES files(id)
  );
  CREATE INDEX IF NOT EXISTS idx_cn_invoice ON credit_notes(invoice_id, status);
  CREATE INDEX IF NOT EXISTS idx_cn_status ON credit_notes(status, outlet_id);
`);

// Payables: the supplier's bill for a received purchase order, and when Finance paid it (→ DPO, cash conversion cycle)
ensureColumn('purchase_orders', 'received_at', 'received_at TEXT');
// Admin approval of customer orders: 'Pending' = awaiting approval; a rejected order is Cancelled with these set
ensureColumn('sales_orders', 'rejected_at', 'rejected_at TEXT');
ensureColumn('sales_orders', 'rejected_by', 'rejected_by INTEGER REFERENCES users(id)');
ensureColumn('sales_orders', 'reject_reason', 'reject_reason TEXT');
ensureColumn('delivery_events', 'user_id', 'user_id INTEGER REFERENCES users(id)'); // who did it (new events)
db.exec(`
  CREATE TABLE IF NOT EXISTS supplier_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL UNIQUE REFERENCES purchase_orders(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),   -- the company that owes it
    bill_number TEXT NOT NULL,             -- the supplier's invoice number
    bill_date TEXT NOT NULL, term_days INTEGER NOT NULL DEFAULT 30, due_date TEXT NOT NULL,
    amount REAL NOT NULL,                  -- incl. tax, as on the supplier's invoice
    status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Paid')),
    paid_date TEXT, paid_reference TEXT,
    recorded_by INTEGER REFERENCES users(id), paid_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bills_outlet ON supplier_bills(outlet_id, status);
`);

// ---------- Order-to-cash (approval, add-ons, closures, payments, documents, Bukku, production) ----------
// Additive only: new nullable columns and new tables. Existing rows keep working unchanged.
ensureColumn('sales_orders', 'addon_of', 'addon_of INTEGER REFERENCES sales_orders(id)');          // add-on to an earlier open order
ensureColumn('sales_orders', 'completed_at', 'completed_at TEXT');                                 // kitchen finished production
ensureColumn('sales_orders', 'completed_by', 'completed_by INTEGER REFERENCES users(id)');
ensureColumn('sales_orders', 'failed_at', 'failed_at TEXT');                                       // last failed delivery
ensureColumn('sales_orders', 'failed_reason', 'failed_reason TEXT');
ensureColumn('sales_orders', 'failed_count', 'failed_count INTEGER NOT NULL DEFAULT 0');
// closures (kept in announcements so customers still see them): what they block, why, yearly repeat
ensureColumn('announcements', 'blocks', 'blocks TEXT');            // comma list of production, delivery, collection
ensureColumn('announcements', 'reason', 'reason TEXT');
ensureColumn('announcements', 'repeat_yearly', 'repeat_yearly INTEGER NOT NULL DEFAULT 0');
// closures made before this existed blocked pickup / delivery dates only — keep exactly that
db.prepare("UPDATE announcements SET blocks = 'delivery,collection' WHERE type = 'closure' AND blocks IS NULL").run();
// payment verification: what actually arrived, and when
ensureColumn('payment_slips', 'amount_received', 'amount_received REAL');
ensureColumn('payment_slips', 'payment_date', 'payment_date TEXT');
// invoices: how they were made, the supplier-side number of an uploaded / Bukku invoice, Bukku sync state, DO upload
ensureColumn('invoices', 'issue_method', "issue_method TEXT");                 // generated | uploaded | bukku (NULL = from source)
ensureColumn('invoices', 'external_number', 'external_number TEXT');           // number printed on an uploaded / Bukku invoice
ensureColumn('invoices', 'bukku_status', 'bukku_status TEXT');                 // pending | sent | failed
ensureColumn('invoices', 'bukku_id', 'bukku_id TEXT');
ensureColumn('invoices', 'bukku_error', 'bukku_error TEXT');
ensureColumn('invoices', 'bukku_attempts', 'bukku_attempts INTEGER NOT NULL DEFAULT 0');
ensureColumn('invoices', 'do_source', "do_source TEXT");                       // generated | uploaded (NULL = generated)
ensureColumn('invoices', 'do_date', 'do_date TEXT');
ensureColumn('invoices', 'uploaded_amount', 'uploaded_amount REAL');           // total printed on an uploaded invoice (checked against the order)
ensureColumn('invoices', 'uploaded_by', 'uploaded_by INTEGER REFERENCES users(id)');
ensureColumn('invoices', 'uploaded_at', 'uploaded_at TEXT');
ensureColumn('invoices', 'do_uploaded_by', 'do_uploaded_by INTEGER REFERENCES users(id)');
ensureColumn('invoices', 'do_uploaded_at', 'do_uploaded_at TEXT');
// per company: how invoices and DOs are made by default (Finance can still choose per invoice)
ensureColumn('outlets', 'invoice_method', "invoice_method TEXT NOT NULL DEFAULT 'generated'");   // generated | uploaded | bukku
ensureColumn('outlets', 'do_method', "do_method TEXT NOT NULL DEFAULT 'generated'");             // generated | uploaded
db.exec(`
  -- Who did what, when, with the old and new values (orders, overrides, documents, settings)
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL,
    outlet_id INTEGER REFERENCES outlets(id),
    user_id INTEGER REFERENCES users(id),
    before TEXT, after TEXT, note TEXT,        -- JSON snapshots / free text
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

  -- Finance lets a blocked customer order: until a date, or for one order
  CREATE TABLE IF NOT EXISTS block_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    reason TEXT NOT NULL,
    expires_on TEXT,                           -- last day it applies (MYT); NULL when single_order
    single_order INTEGER NOT NULL DEFAULT 0,
    used_so_id INTEGER REFERENCES sales_orders(id),
    granted_by INTEGER REFERENCES users(id), granted_at TEXT DEFAULT (datetime('now')),
    revoked_by INTEGER REFERENCES users(id), revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_override_customer ON block_overrides(customer_id);

  -- Replacement history for uploaded invoices and DOs
  CREATE TABLE IF NOT EXISTS document_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    kind TEXT NOT NULL CHECK (kind IN ('invoice','do')),
    file_id INTEGER REFERENCES files(id), replaced_file_id INTEGER REFERENCES files(id),
    reason TEXT, user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Collection follow-up per customer
  CREATE TABLE IF NOT EXISTS collection_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    outlet_id INTEGER NOT NULL REFERENCES outlets(id),
    contact_date TEXT NOT NULL, contact TEXT, promised_date TEXT, remarks TEXT,
    user_id INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now'))
  );

  -- Accounting integration (Bukku) activity, viewable by Finance
  CREATE TABLE IF NOT EXISTS integration_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outlet_id INTEGER REFERENCES outlets(id), invoice_id INTEGER REFERENCES invoices(id),
    action TEXT NOT NULL, status TEXT NOT NULL,      -- ok | error | skipped
    http_status INTEGER, message TEXT, user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Kitchen: what was actually produced for each order line
  CREATE TABLE IF NOT EXISTS production_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    so_id INTEGER NOT NULL REFERENCES sales_orders(id),
    line_id INTEGER NOT NULL REFERENCES sales_order_lines(id),
    planned_qty INTEGER NOT NULL, actual_qty INTEGER NOT NULL,
    shortage INTEGER NOT NULL DEFAULT 0, wastage INTEGER NOT NULL DEFAULT 0, remarks TEXT,
    user_id INTEGER REFERENCES users(id), created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (so_id, line_id)
  );
`);

// Rows created by the mock-data generator (server/mock-finance.js) — `npm run mock:clear` deletes them
db.exec('CREATE TABLE IF NOT EXISTS mock_records (table_name TEXT NOT NULL, row_id INTEGER NOT NULL, PRIMARY KEY (table_name, row_id))');

export default db;
