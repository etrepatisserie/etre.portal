-- ============================================================
-- Être Patisserie ERP Portal — MySQL schema
-- Compatible with MySQL 8.0+ and MariaDB 10.4+
--
-- Usage — run each file against YOUR database (the one in DB_NAME), in this order:
--   mysql -u DB_USER -p DB_NAME < server/sql/schema.sql      (every table, empty — drops existing ones first!)
--   mysql -u DB_USER -p DB_NAME < server/sql/seed.sql        (starting data: outlets, settings, staff, catalog, stock;
--                                                             the last block adds fictional "(demo)" customers — delete it if unwanted)
-- phpMyAdmin: open the database, then Import each file. The database itself must already exist
-- (hosting panels create it for you); this script does not create or select one.
--
-- Time zone: Kuala Lumpur (UTC+8, no daylight saving). Timestamps ("YYYY-MM-DD HH:MM:SS") and dates
-- are Malaysia time; CURRENT_TIMESTAMP / CURRENT_DATE defaults follow the session time zone set below.
-- Prices and amounts are in RM with 2 decimals; rates (SST) with 4 decimals.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+08:00';   -- Kuala Lumpur

-- ────────────────────────────────────────────────────────────
-- DROP ALL TABLES IF THEY EXIST (everything in them is lost!)
-- Child tables first, parents last; foreign-key checks are off
-- so the order never matters. Safe on an empty database.
-- ────────────────────────────────────────────────────────────
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS mock_records;
DROP TABLE IF EXISTS production_results;
DROP TABLE IF EXISTS integration_log;
DROP TABLE IF EXISTS collection_notes;
DROP TABLE IF EXISTS document_versions;
DROP TABLE IF EXISTS block_overrides;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS supplier_bills;
DROP TABLE IF EXISTS credit_notes;
DROP TABLE IF EXISTS email_outbox;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS stock_holds;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS credit_term_requests;
DROP TABLE IF EXISTS payment_slip_invoices;
DROP TABLE IF EXISTS payment_slips;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS discrepancies;
DROP TABLE IF EXISTS delivery_events;
DROP TABLE IF EXISTS order_adjustments;
DROP TABLE IF EXISTS sales_order_lines;
DROP TABLE IF EXISTS sales_orders;
DROP TABLE IF EXISTS purchase_order_lines;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS product_stock;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS outlets;
SET FOREIGN_KEY_CHECKS = 1;

-- ────────────────────────────────────────────────────────────
-- Outlets (separate companies: KL, Ipoh)
-- ────────────────────────────────────────────────────────────
CREATE TABLE outlets (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  code                    VARCHAR(10)  NOT NULL UNIQUE,        -- KL, IPH — used in SO / INV / DO numbers
  name                    VARCHAR(100) NOT NULL,               -- "Kuala Lumpur", "Ipoh"
  company_name            VARCHAR(255) NOT NULL,
  company_address         TEXT,
  company_reg_no          VARCHAR(100),
  sst_reg_no              VARCHAR(100),
  bank_name               VARCHAR(100),
  bank_account_name       VARCHAR(255),
  bank_account_no         VARCHAR(100),
  pickup_address          TEXT,
  pickup_slots            TEXT,                                -- JSON array
  delivery_slots          TEXT,                                -- JSON array
  delivery_area           VARCHAR(255),
  email                   VARCHAR(255),                        -- company email: sender of its emails, shown on invoices
  invoice_method          VARCHAR(20)  NOT NULL DEFAULT 'generated',  -- generated | uploaded | bukku
  do_method               VARCHAR(20)  NOT NULL DEFAULT 'generated',  -- generated | uploaded
  delivery_fee            DECIMAL(12,2),                       -- RM, flat — each company sets its own
  free_delivery_threshold DECIMAL(12,2)                        -- RM, subtotal before SST
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Master data
-- ────────────────────────────────────────────────────────────
CREATE TABLE files (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  kind          VARCHAR(20)  NOT NULL CHECK (kind IN ('slip','invoice','do','product_image','discrepancy')),
  customer_id   INT,                                           -- owner; NULL for product images
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(255) NOT NULL,                         -- random name inside UPLOAD_DIR
  mime          VARCHAR(100) NOT NULL,
  size          INT          NOT NULL,
  uploaded_by   INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE suppliers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(50)  NOT NULL UNIQUE,
  name       VARCHAR(255) NOT NULL,
  contact    VARCHAR(255),
  email      VARCHAR(255),
  phone      VARCHAR(50),
  address    TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE products (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  sku             VARCHAR(50)  NOT NULL UNIQUE,
  name            VARCHAR(255) NOT NULL,
  category        VARCHAR(100) DEFAULT 'General',
  category_code   VARCHAR(20),
  size            VARCHAR(100),
  uom             VARCHAR(20)  DEFAULT 'PC',
  unit_cost       DECIMAL(12,2) DEFAULT 0,
  sell_price      DECIMAL(12,2) DEFAULT 0,                     -- wholesale price before SST
  moq             INT NOT NULL DEFAULT 1,
  recommended_rsp VARCHAR(100),
  shelf_life      VARCHAR(100),
  storage_notes   TEXT,
  heating_notes   TEXT,
  notes           TEXT,                                        -- category note, e.g. Lescure butter
  is_sellable     TINYINT(1) NOT NULL DEFAULT 1,               -- 0 = ingredient / packaging
  is_available    TINYINT(1) NOT NULL DEFAULT 1,               -- admin switch: 0 hides "order" for this product
  image_file_id   INT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_image FOREIGN KEY (image_file_id) REFERENCES files(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE customers (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  code               VARCHAR(50)  NOT NULL UNIQUE,
  name               VARCHAR(255) NOT NULL,
  outlet_id          INT NOT NULL,                             -- home outlet: pickup, delivery, kitchen, company that invoices
  reg_no             VARCHAR(100),                             -- company registration no. (shown on invoices)
  contact            VARCHAR(255),
  email              VARCHAR(255),
  phone              VARCHAR(50),
  phone2             VARCHAR(50),
  address            TEXT,                                     -- delivery address
  billing_address    TEXT,                                     -- "Bill to" on invoices (falls back to address)
  payment_term       VARCHAR(10) NOT NULL DEFAULT 'COD' CHECK (payment_term IN ('COD','NET14','NET15','NET30')),
  credit_limit       DECIMAL(12,2),
  is_demo            TINYINT(1) NOT NULL DEFAULT 0,            -- 1 = mock customer for trying the system
  account_start_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  term_updated_at    DATETIME,
  term_updated_by    INT,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customers_outlet FOREIGN KEY (outlet_id) REFERENCES outlets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Auth
-- ────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,                         -- scrypt: "<salt hex>:<hash hex>" (server/passwords.js)
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('admin','finance','kitchen','customer')),
  customer_id   INT,
  outlet_id     INT,                                           -- staff: their outlet; NULL = head office (both outlets)
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_users_outlet   FOREIGN KEY (outlet_id)   REFERENCES outlets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sessions (
  token      VARCHAR(64) PRIMARY KEY,
  user_id    INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen  DATETIME,                                         -- sessions expire after 30 days, or 7 days unused
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE settings (
  `key`   VARCHAR(100) PRIMARY KEY,
  `value` TEXT                                                 -- JSON-encoded value
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Stock is kept per outlet (each outlet has its own kitchen and ingredients)
CREATE TABLE product_stock (
  product_id    INT NOT NULL,
  outlet_id     INT NOT NULL,
  stock_on_hand INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, outlet_id),
  CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_stock_outlet  FOREIGN KEY (outlet_id)  REFERENCES outlets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Purchasing
-- ────────────────────────────────────────────────────────────
CREATE TABLE purchase_orders (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  po_number     VARCHAR(50) NOT NULL UNIQUE,
  supplier_id   INT NOT NULL,
  outlet_id     INT NOT NULL,                                  -- which outlet receives the goods
  order_date    DATE NOT NULL,
  expected_date DATE,
  status        VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Approved','Received','Cancelled')),
  notes         TEXT,
  tax_rate      DECIMAL(6,4)  DEFAULT 0,
  subtotal      DECIMAL(12,2) DEFAULT 0,
  tax_amount    DECIMAL(12,2) DEFAULT 0,
  total         DECIMAL(12,2) DEFAULT 0,
  received_at   DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_po_outlet   FOREIGN KEY (outlet_id)   REFERENCES outlets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE purchase_order_lines (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  po_id       INT NOT NULL,
  line_no     INT NOT NULL,
  product_id  INT,
  description VARCHAR(255) NOT NULL,
  quantity    DECIMAL(12,3) NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL,
  line_total  DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_pol_po      FOREIGN KEY (po_id)      REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_pol_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Sales
-- ────────────────────────────────────────────────────────────
CREATE TABLE sales_orders (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  so_number         VARCHAR(50) NOT NULL UNIQUE,
  customer_id       INT NOT NULL,
  outlet_id         INT NOT NULL,
  order_date        DATETIME NOT NULL,                         -- UTC timestamp the order was placed
  processing_day    DATE,                                      -- working day (MYT) the order counts as, after cutoff rules
  production_date   DATE,                                      -- fulfil_date - 1
  fulfil_date       DATE,                                      -- pickup / delivery date chosen by the customer
  method            VARCHAR(20) NOT NULL DEFAULT 'delivery' CHECK (method IN ('pickup','delivery')),
  time_slot         VARCHAR(100),
  delivery_address  TEXT,
  area_confirmed    TINYINT(1) NOT NULL DEFAULT 0,             -- customer confirmed the delivery area
  notes             TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending','Confirmed','Invoiced','Processing','Ready for Pickup','Out for Delivery','Received','Cancelled')),
  subtotal          DECIMAL(12,2) NOT NULL DEFAULT 0,
  delivery_fee      DECIMAL(12,2) NOT NULL DEFAULT 0,
  sst_rate          DECIMAL(6,4)  NOT NULL DEFAULT 0,
  sst_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total             DECIMAL(12,2) NOT NULL DEFAULT 0,          -- incl. SST
  delivery_provider VARCHAR(100),
  delivery_link     TEXT,
  printed_at        DATETIME,                                  -- kitchen printed the PO / production sheet
  confirmed_at      DATETIME,
  confirmed_by      INT,
  received_at       DATETIME,
  matches_do        TINYINT(1),
  cancel_reason     TEXT,
  created_by        INT,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  replacement_for   INT,                                       -- no charge, never invoiced (complaint replacement)
  rejected_at       DATETIME,
  rejected_by       INT,
  reject_reason     TEXT,
  addon_of          INT,                                       -- add-on to an earlier open order
  completed_at      DATETIME,                                  -- kitchen finished production
  completed_by      INT,
  failed_at         DATETIME,                                  -- last failed delivery
  failed_reason     TEXT,
  failed_count      INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_so_customer     FOREIGN KEY (customer_id)     REFERENCES customers(id),
  CONSTRAINT fk_so_outlet       FOREIGN KEY (outlet_id)       REFERENCES outlets(id),
  CONSTRAINT fk_so_confirmed_by FOREIGN KEY (confirmed_by)    REFERENCES users(id),
  CONSTRAINT fk_so_created_by   FOREIGN KEY (created_by)      REFERENCES users(id),
  CONSTRAINT fk_so_rejected_by  FOREIGN KEY (rejected_by)     REFERENCES users(id),
  CONSTRAINT fk_so_completed_by FOREIGN KEY (completed_by)    REFERENCES users(id),
  CONSTRAINT fk_so_replacement  FOREIGN KEY (replacement_for) REFERENCES sales_orders(id),
  CONSTRAINT fk_so_addon        FOREIGN KEY (addon_of)        REFERENCES sales_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sales_order_lines (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  so_id             INT NOT NULL,
  product_id        INT NOT NULL,
  description       VARCHAR(255) NOT NULL,
  original_quantity INT NOT NULL,                              -- as ordered by the customer
  quantity          INT NOT NULL,                              -- after admin adjustments (0 = removed)
  unit_price        DECIMAL(12,2) NOT NULL,
  line_total        DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_sol_so      FOREIGN KEY (so_id)      REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_sol_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Quantity changes made by admin before confirmation
CREATE TABLE order_adjustments (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  so_id         INT NOT NULL,
  batch         VARCHAR(50) NOT NULL,                          -- groups the lines changed in one save
  line_id       INT NOT NULL,
  product_name  VARCHAR(255) NOT NULL,
  old_qty       INT NOT NULL,
  new_qty       INT NOT NULL,
  reason        TEXT NOT NULL,
  totals_before TEXT,                                          -- JSON
  totals_after  TEXT,                                          -- JSON
  user_id       INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_adj_so   FOREIGN KEY (so_id)   REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_adj_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE delivery_events (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  so_id      INT NOT NULL,
  status     VARCHAR(50) NOT NULL,
  note       TEXT,
  user_id    INT,                                              -- who did it
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dev_so   FOREIGN KEY (so_id)   REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_dev_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE discrepancies (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  so_id             INT NOT NULL,
  line_id           INT,
  product_name      VARCHAR(255) NOT NULL,
  qty               INT,
  note              TEXT,
  file_id           INT,
  status            VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
  resolution        TEXT,
  resolved_by       INT,
  resolved_at       DATETIME,
  created_by        INT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  action            VARCHAR(20),                               -- credit_note | replacement
  replacement_so_id INT,
  CONSTRAINT fk_disc_so          FOREIGN KEY (so_id)             REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_disc_file        FOREIGN KEY (file_id)           REFERENCES files(id),
  CONSTRAINT fk_disc_created_by  FOREIGN KEY (created_by)        REFERENCES users(id),
  CONSTRAINT fk_disc_replacement FOREIGN KEY (replacement_so_id) REFERENCES sales_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Finance
-- ────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  inv_number      VARCHAR(50) NOT NULL UNIQUE,                 -- INV-KL-YYYY-0001
  do_number       VARCHAR(50) NOT NULL UNIQUE,                 -- DO-KL-YYYY-0001
  so_id           INT NOT NULL UNIQUE,
  customer_id     INT NOT NULL,
  outlet_id       INT NOT NULL,                                -- the company that issues the invoice
  issue_date      DATE NOT NULL,
  due_date        DATE NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL,
  delivery_fee    DECIMAL(12,2) NOT NULL,
  sst_rate        DECIMAL(6,4)  NOT NULL,
  sst_amount      DECIMAL(12,2) NOT NULL,
  total           DECIMAL(12,2) NOT NULL,
  payment_status  VARCHAR(20) NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid','Slip Uploaded','Paid','Rejected')),
  source          VARCHAR(20) NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','uploaded')),
  invoice_file_id INT,
  do_file_id      INT,
  paid_at         DATETIME,
  void            TINYINT(1) NOT NULL DEFAULT 0,
  issued_by       INT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  issue_method    VARCHAR(20),                                 -- generated | uploaded | bukku (NULL = from source)
  external_number VARCHAR(100),                                -- number printed on an uploaded / Bukku invoice
  bukku_status    VARCHAR(20),                                 -- pending | sent | failed
  bukku_id        VARCHAR(100),
  bukku_error     TEXT,
  bukku_attempts  INT NOT NULL DEFAULT 0,
  do_source       VARCHAR(20),                                 -- generated | uploaded (NULL = generated)
  do_date         DATE,
  uploaded_amount DECIMAL(12,2),                               -- total printed on an uploaded invoice
  uploaded_by     INT,
  uploaded_at     DATETIME,
  do_uploaded_by  INT,
  do_uploaded_at  DATETIME,
  CONSTRAINT fk_inv_so          FOREIGN KEY (so_id)           REFERENCES sales_orders(id),
  CONSTRAINT fk_inv_customer    FOREIGN KEY (customer_id)     REFERENCES customers(id),
  CONSTRAINT fk_inv_outlet      FOREIGN KEY (outlet_id)       REFERENCES outlets(id),
  CONSTRAINT fk_inv_file        FOREIGN KEY (invoice_file_id) REFERENCES files(id),
  CONSTRAINT fk_inv_do_file     FOREIGN KEY (do_file_id)      REFERENCES files(id),
  CONSTRAINT fk_inv_issued_by   FOREIGN KEY (issued_by)       REFERENCES users(id),
  CONSTRAINT fk_inv_uploaded_by FOREIGN KEY (uploaded_by)     REFERENCES users(id),
  CONSTRAINT fk_inv_do_upl_by   FOREIGN KEY (do_uploaded_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payment_slips (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  customer_id     INT NOT NULL,
  so_id           INT,                                         -- COD slip sent with the order, before the invoice exists
  file_id         INT NOT NULL,
  reference       VARCHAR(255),
  amount          DECIMAL(12,2),
  status          VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Verified','Rejected')),
  reject_reason   TEXT,
  uploaded_by     INT,
  reviewed_by     INT,
  reviewed_at     DATETIME,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  amount_received DECIMAL(12,2),                               -- what actually arrived
  payment_date    DATE,
  kind            VARCHAR(20),                                 -- full (NULL) | deposit: a verified part payment on one invoice
  CONSTRAINT fk_slip_customer    FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_slip_so          FOREIGN KEY (so_id)       REFERENCES sales_orders(id),
  CONSTRAINT fk_slip_file        FOREIGN KEY (file_id)     REFERENCES files(id),
  CONSTRAINT fk_slip_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id),
  CONSTRAINT fk_slip_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payment_slip_invoices (
  slip_id    INT NOT NULL,
  invoice_id INT NOT NULL,
  PRIMARY KEY (slip_id, invoice_id),
  CONSTRAINT fk_psi_slip    FOREIGN KEY (slip_id)    REFERENCES payment_slips(id) ON DELETE CASCADE,
  CONSTRAINT fk_psi_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE credit_term_requests (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  customer_id   INT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  note          TEXT,
  decided_by    INT,
  decided_at    DATETIME,
  decision_note TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ctr_customer   FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_ctr_decided_by FOREIGN KEY (decided_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Content
-- ────────────────────────────────────────────────────────────
CREATE TABLE announcements (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  body          TEXT,
  outlet_id     INT,                                           -- NULL = both outlets
  type          VARCHAR(20) NOT NULL DEFAULT 'notice' CHECK (type IN ('notice','closure','price_change')),
  starts_on     DATE NOT NULL,                                 -- banner shown between these dates (inclusive)
  ends_on       DATE NOT NULL,
  closure_from  DATE,                                          -- for type 'closure'
  closure_to    DATE,
  created_by    INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  blocks        VARCHAR(100),                                  -- comma list of production, delivery, collection
  reason        TEXT,
  repeat_yearly TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_ann_outlet     FOREIGN KEY (outlet_id)  REFERENCES outlets(id),
  CONSTRAINT fk_ann_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Inventory
-- ────────────────────────────────────────────────────────────
CREATE TABLE stock_holds (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  product_id  INT NOT NULL,
  outlet_id   INT NOT NULL,
  qty         INT NOT NULL CHECK (qty > 0),
  reason      TEXT NOT NULL,
  customer_id INT,
  so_id       INT,
  status      VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Released','Fulfilled')),
  created_by  INT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  released_at DATETIME,
  CONSTRAINT fk_hold_product    FOREIGN KEY (product_id)  REFERENCES products(id),
  CONSTRAINT fk_hold_outlet     FOREIGN KEY (outlet_id)   REFERENCES outlets(id),
  CONSTRAINT fk_hold_customer   FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_hold_so         FOREIGN KEY (so_id)       REFERENCES sales_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_hold_created_by FOREIGN KEY (created_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE stock_movements (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  product_id    INT NOT NULL,
  outlet_id     INT NOT NULL,
  type          VARCHAR(20) NOT NULL CHECK (type IN ('receipt','sale','adjustment')),
  qty           INT NOT NULL,
  balance_after INT NOT NULL,
  reason        TEXT,
  ref           VARCHAR(100),
  user_id       INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_move_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_move_outlet  FOREIGN KEY (outlet_id)  REFERENCES outlets(id),
  CONSTRAINT fk_move_user    FOREIGN KEY (user_id)    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Notifications & email
-- ────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  type       VARCHAR(50)  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT,
  link       VARCHAR(255),
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE email_outbox (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  to_email     VARCHAR(255) NOT NULL,
  subject      VARCHAR(255) NOT NULL,
  html         MEDIUMTEXT NOT NULL,
  `text`       MEDIUMTEXT,
  template     VARCHAR(100) NOT NULL,
  related_type VARCHAR(50),
  related_id   INT,
  outlet_id    INT,
  status       VARCHAR(20) NOT NULL DEFAULT 'logged' CHECK (status IN ('logged','sent','failed')),
  error        TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_email_outlet FOREIGN KEY (outlet_id) REFERENCES outlets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Complaints → credit notes; payables; audit; overrides; documents; collection; integration; production
-- ────────────────────────────────────────────────────────────
CREATE TABLE credit_notes (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  cn_number      VARCHAR(50) UNIQUE,                           -- CN-KL-2026-0001, given when Finance issues it
  customer_id    INT NOT NULL,
  outlet_id      INT NOT NULL,                                 -- the company that issues it (same as the invoice)
  so_id          INT NOT NULL,
  invoice_id     INT,                                          -- set when issued
  discrepancy_id INT,                                          -- the complaint it settles (NULL = raised by Finance)
  reason         TEXT NOT NULL,
  `lines`        TEXT NOT NULL,                                -- JSON [{line_id, sku, description, quantity, unit_price, amount}]
  subtotal       DECIMAL(12,2) NOT NULL,
  sst_rate       DECIMAL(6,4)  NOT NULL,
  sst_amount     DECIMAL(12,2) NOT NULL,
  total          DECIMAL(12,2) NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested','Issued','Rejected')),
  settlement     VARCHAR(100),                                 -- 'Reduces amount due' | 'Refund or offset (invoice already paid)'
  reject_reason  TEXT,
  requested_by   INT,
  requested_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  issued_by      INT,
  issued_at      DATETIME,
  issue_date     DATE,
  file_id        INT,
  CONSTRAINT fk_cn_customer     FOREIGN KEY (customer_id)    REFERENCES customers(id),
  CONSTRAINT fk_cn_outlet       FOREIGN KEY (outlet_id)      REFERENCES outlets(id),
  CONSTRAINT fk_cn_so           FOREIGN KEY (so_id)          REFERENCES sales_orders(id),
  CONSTRAINT fk_cn_invoice      FOREIGN KEY (invoice_id)     REFERENCES invoices(id),
  CONSTRAINT fk_cn_discrepancy  FOREIGN KEY (discrepancy_id) REFERENCES discrepancies(id),
  CONSTRAINT fk_cn_requested_by FOREIGN KEY (requested_by)   REFERENCES users(id),
  CONSTRAINT fk_cn_issued_by    FOREIGN KEY (issued_by)      REFERENCES users(id),
  CONSTRAINT fk_cn_file         FOREIGN KEY (file_id)        REFERENCES files(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The supplier's bill for a received purchase order, and when Finance paid it (→ DPO, cash conversion cycle)
CREATE TABLE supplier_bills (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  po_id          INT NOT NULL UNIQUE,
  supplier_id    INT NOT NULL,
  outlet_id      INT NOT NULL,                                 -- the company that owes it
  bill_number    VARCHAR(100) NOT NULL,                        -- the supplier's invoice number
  bill_date      DATE NOT NULL,
  term_days      INT NOT NULL DEFAULT 30,
  due_date       DATE NOT NULL,
  amount         DECIMAL(12,2) NOT NULL,                       -- incl. tax, as on the supplier's invoice
  status         VARCHAR(20) NOT NULL DEFAULT 'Unpaid' CHECK (status IN ('Unpaid','Paid')),
  paid_date      DATE,
  paid_reference VARCHAR(255),
  recorded_by    INT,
  paid_by        INT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bill_po          FOREIGN KEY (po_id)       REFERENCES purchase_orders(id),
  CONSTRAINT fk_bill_supplier    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_bill_outlet      FOREIGN KEY (outlet_id)   REFERENCES outlets(id),
  CONSTRAINT fk_bill_recorded_by FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT fk_bill_paid_by     FOREIGN KEY (paid_by)     REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Who did what, when, with the old and new values (orders, overrides, documents, settings)
CREATE TABLE audit_log (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  entity     VARCHAR(50) NOT NULL,
  entity_id  INT,
  action     VARCHAR(50) NOT NULL,
  outlet_id  INT,
  user_id    INT,
  `before`   TEXT,                                             -- JSON snapshot
  `after`    TEXT,                                             -- JSON snapshot
  note       TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_outlet FOREIGN KEY (outlet_id) REFERENCES outlets(id),
  CONSTRAINT fk_audit_user   FOREIGN KEY (user_id)   REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Finance lets a blocked customer order: until a date, or for one order
CREATE TABLE block_overrides (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT NOT NULL,
  reason       TEXT NOT NULL,
  expires_on   DATE,                                           -- last day it applies (MYT); NULL when single_order
  single_order TINYINT(1) NOT NULL DEFAULT 0,
  used_so_id   INT,
  granted_by   INT,
  granted_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_by   INT,
  revoked_at   DATETIME,
  CONSTRAINT fk_ovr_customer   FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_ovr_used_so    FOREIGN KEY (used_so_id)  REFERENCES sales_orders(id),
  CONSTRAINT fk_ovr_granted_by FOREIGN KEY (granted_by)  REFERENCES users(id),
  CONSTRAINT fk_ovr_revoked_by FOREIGN KEY (revoked_by)  REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Replacement history for uploaded invoices and DOs
CREATE TABLE document_versions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id       INT NOT NULL,
  kind             VARCHAR(20) NOT NULL CHECK (kind IN ('invoice','do')),
  file_id          INT,
  replaced_file_id INT,
  reason           TEXT,
  user_id          INT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_docv_invoice  FOREIGN KEY (invoice_id)       REFERENCES invoices(id),
  CONSTRAINT fk_docv_file     FOREIGN KEY (file_id)          REFERENCES files(id),
  CONSTRAINT fk_docv_replaced FOREIGN KEY (replaced_file_id) REFERENCES files(id),
  CONSTRAINT fk_docv_user     FOREIGN KEY (user_id)          REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Collection follow-up per customer
CREATE TABLE collection_notes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  customer_id   INT NOT NULL,
  outlet_id     INT NOT NULL,
  contact_date  DATE NOT NULL,
  contact       VARCHAR(255),
  promised_date DATE,
  remarks       TEXT,
  user_id       INT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_coll_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_coll_outlet   FOREIGN KEY (outlet_id)   REFERENCES outlets(id),
  CONSTRAINT fk_coll_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Accounting integration (Bukku) activity, viewable by Finance
CREATE TABLE integration_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  outlet_id   INT,
  invoice_id  INT,
  action      VARCHAR(50) NOT NULL,
  status      VARCHAR(20) NOT NULL,                            -- ok | error | skipped
  http_status INT,
  message     TEXT,
  user_id     INT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ilog_outlet  FOREIGN KEY (outlet_id)  REFERENCES outlets(id),
  CONSTRAINT fk_ilog_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_ilog_user    FOREIGN KEY (user_id)    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Kitchen: what was actually produced for each order line
CREATE TABLE production_results (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  so_id       INT NOT NULL,
  line_id     INT NOT NULL,
  planned_qty INT NOT NULL,
  actual_qty  INT NOT NULL,
  shortage    INT NOT NULL DEFAULT 0,
  wastage     INT NOT NULL DEFAULT 0,
  remarks     TEXT,
  user_id     INT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_production_line (so_id, line_id),
  CONSTRAINT fk_prod_so   FOREIGN KEY (so_id)   REFERENCES sales_orders(id),
  CONSTRAINT fk_prod_line FOREIGN KEY (line_id) REFERENCES sales_order_lines(id),
  CONSTRAINT fk_prod_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Rows created by the mock-data generator (server/mock-finance.js) — `npm run mock:clear` deletes them
CREATE TABLE mock_records (
  table_name VARCHAR(64) NOT NULL,
  row_id     INT NOT NULL,
  PRIMARY KEY (table_name, row_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ────────────────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────────────────
CREATE INDEX idx_so_customer     ON sales_orders (customer_id);
CREATE INDEX idx_so_outlet       ON sales_orders (outlet_id, status);
CREATE INDEX idx_so_status       ON sales_orders (status);
CREATE INDEX idx_so_production   ON sales_orders (production_date);
CREATE INDEX idx_inv_outlet      ON invoices (outlet_id);
CREATE INDEX idx_inv_customer    ON invoices (customer_id, payment_status);
CREATE INDEX idx_holds_product   ON stock_holds (product_id, outlet_id, status);
CREATE INDEX idx_notif_user      ON notifications (user_id, is_read);
CREATE INDEX idx_cn_invoice      ON credit_notes (invoice_id, status);
CREATE INDEX idx_cn_status       ON credit_notes (status, outlet_id);
CREATE INDEX idx_bills_outlet    ON supplier_bills (outlet_id, status);
CREATE INDEX idx_audit_entity    ON audit_log (entity, entity_id);
CREATE INDEX idx_override_customer ON block_overrides (customer_id);
