# ERP Portal (prototype) — Être Patisserie wholesale

React + Vite client (`client/`), Express API (`server/`) that also serves the built client. Database: MySQL (schema and seed scripts in `server/sql/`; the query code is still on SQLite — see **Database**). Four portals behind one sign-in page:

| Portal | URL | Who | What |
|---|---|---|---|
| Customer | `/portal` | B2B customers | Checkout (pickup/delivery, dates, fees, SST, COD slip), purchase history with one invoice summary, delivery tracking, payments, credit-term request, Info (ordering, suggested selling prices, storage, heating) |
| Admin | `/admin` | Admin | Adjust short items, dispatch, delivery links, discrepancies, customers, stock, purchasing, statistics, announcements, product images, email outbox |
| Finance | `/finance` | Finance | Invoice every new order, verify payment slips, payment terms & requests, aging report (Excel/CSV) — all filterable by customer |
| Central Kitchen | `/kitchen` | Kitchen | Confirmed orders (no prices), print PO / production sheet, production plan, production & ingredient records, summary report (Excel/PDF) |

## Run
```bash
npm run install-all        # first time only: server + client dependencies
cp .env.example .env.dev   # first time only: ports, database, seed passwords, email
npm run dev                # API on :3001 + Vite dev server on :5173 (proxies /api to the API)
npm test                   # API + rules tests (uses a temporary database)
```
Open http://localhost:5173 while developing.

**Serving the portal from the backend** (how it runs in production):
```bash
npm run build:prod         # builds the React client into client/build
npm run server:prod        # Express serves client/build + the API on one port (:3001)
```
Open http://localhost:3001. Static files come from `client/build`; every other non-API path returns `index.html` so the browser router works. `npm run build-and-serve` does both steps.

Environment files are picked by `NODE_ENV`: `.env.dev` (server:dev), `.env.uat`, `.env.production` (server:prod); `.env` is a fallback. The client reads `client/.env.dev` / `.env.uat` / `.env.prod` by Vite mode (see `client/.env.example`). All of them are git-ignored.

A fresh database has the 16 real customers, the catalog, ingredients with opening stock and the staff logins. It also has **mock finance data** on the 4 customer test logins (see below).

| Staff login | Sees |
|---|---|
| admin@demo.test | Admin — head office (KL + Ipoh) |
| staff@demo.test / admin.ipoh@demo.test | Admin — KL only / Ipoh only |
| finance@demo.test | Finance — both companies (KL / Ipoh / Both tabs at the top of every page) |
| kitchen@demo.test / kitchen.ipoh@demo.test | Kitchen — KL / Ipoh (never sees prices) |

Initial passwords are in one place, `INITIAL_PASSWORDS` in `server/seed-data.js`, and are stored hashed in the `users` table (never shown on the sign-in page). Change them there before seeding, or change the hash in the database afterwards.

**Customer test logins (real customers):** 4 real customers have a test login (initial password `INITIAL_PASSWORDS.customer`): one KL COD, one Ipoh COD, one Ipoh 15-day and one Ipoh 30-day.
- They let you see the portal as that customer. No orders or invoices are invented, and anything you order with them is a real order in the system.
- To choose which customers get one, add `"demo_login": "name@demo.test"` to them in the git-ignored `server/data/customers.json`, then run `npm run import:customers`.

Every other customer has no login until Admin → Customers → **Create login**.

**Mock finance data:** these 4 test-login customers come with about 3 months of mock orders, invoices and payment slips. This includes paid invoices, slips waiting to be checked, a rejected slip, overdue credit-term invoices and orders still to invoice.
- Every mock document is numbered `MOCK-SO-…`, `MOCK-INV-…` or `MOCK-DO-…`, so the real numbering still starts at 0001.
- `npm run mock:clear` removes all of it (including anything staff did with mock orders). `npm run mock:finance` creates it again.
- `SEED_MOCK=0` skips it on a fresh database.

## Finance: one login, two companies
- `finance@` works on both companies. The **KL / Ipoh / Both companies** tabs at the top of every finance page choose which company's books are shown. Lists, customer filters, reports and downloads all follow the tab.
- **Both companies** shows the two side by side, never added together.
- **Reports → Monthly Report:** for each company, the month's invoiced amount, SST charged, amount collected, outstanding and overdue, a by-customer table and a 6-month trend. The Excel download has its own sheets per company, for separate SST returns.
- **Reports → Aging Report:** split per company, with an Excel download that has its own sheets per company.

**Demo data (optional):** `npm run reset-db && SEED_DEMO=1 npm run dev` adds 7 fictional "(demo)" customers (`cafe@`, `maple@`, `harbor@`, `littleoven@`, `beanbloom@`, `kinta@`, `perakhotel@`; initial password `INITIAL_PASSWORDS.customer`), plus 6 months of orders, invoices and slips. The tests always use it.

- **Statistics (graphs):** Finance → Reports → Statistics shows each company's invoiced vs collected, aging, who owes the most, days to pay, on-time %, top customers, sales by term and credit notes (3 / 6 / 12 months). Each chart has a table view.

- **Payables:** Finance → Payables. When a purchase order is received, Finance records the supplier's bill (number, date, term, amount) and later marks it paid. Totals are per company.
- **Cash conversion cycle:** Finance → Reports → Cash Conversion Cycle. CCC = DIO + DSO − DPO per company, by month, with the inputs behind each part. DIO needs ingredient stock movements (receipts plus usage via stock adjustments); DPO needs supplier bills.
- Mock purchasing (MOCK-PO, MOCK-BILL, ingredient usage that nets to zero) is part of the mock data. `npm run mock:purchasing` adds just that part.

## Database
The target database is **MySQL** (driver `mysql2`, pool in `server/mysql.js`; settings `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` in `.env`).
The database itself must already exist (your hosting panel or `CREATE DATABASE`); the scripts never create or select one, so they work with any database name. Run them against the database in `DB_NAME`, in this order (or import each file in phpMyAdmin with that database open):
```bash
mysql -u DB_USER -p DB_NAME < server/sql/schema.sql      # all 34 tables, empty (drops existing ones first)
mysql -u DB_USER -p DB_NAME < server/sql/seed.sql        # starting data: outlets, settings, staff logins, catalog, ingredients, opening stock,
                                                         # plus (last block, delete it for a live database) 7 fictional "(demo)" customers with logins
npm run db:check                                         # confirms the connection and lists the tables
```
`npm run sql:seed` regenerates `seed.sql` from `server/seed-data.js` (outlets, settings, staff, suppliers, ingredients, initial passwords) and `server/data/catalog.json`. Edit those and run it again if the starting data changes.

**Where the switch stands:** the schema, seed scripts, driver and connection are in place, but every query in `server/*.js` still runs on the SQLite file through `better-sqlite3` (`server/db.js`). Porting those calls to the async `mysql2` API is the remaining step; until then `npm run backup` / `restore` / `reset-db` still refer to the SQLite file.

## Outlets: KL and Ipoh (separate companies)
| | KL | Ipoh |
|---|---|---|
| Company | ETRE PATISSERIE KL SDN BHD | ETRE PATISSERIE SDN BHD |
| Numbers | SO-KL-…, INV-KL-…, DO-KL-…, PO-KL-… | SO-IPH-…, INV-IPH-…, DO-IPH-…, PO-IPH-… |
| Kitchen, stock, ingredients, POs, closures | KL only | Ipoh only |

- Every customer has a **home outlet**: it decides pickup address, slots, delivery area, closures, bank account, the kitchen that bakes and the company that invoices.
- Staff with an outlet see **only that outlet**. Head office logins (`admin@`, `finance@`) see both and can switch KL / Ipoh / Both in the menu bar.
- Company registration numbers, bank accounts, pickup and delivery-area details live in the `outlets` table (defaults in `server/seed-data.js`). **Bank account numbers are not in the code**: enter them in Admin › Settings, or in the `outlets` section of the git-ignored `server/data/customers.json`.

## Real customers
`Real customer data/` (the accounting system's debtor reports) is **git-ignored**, as is the extracted `server/data/customers.json`.
`npm run import:customers` adds / updates them by debtor code (also done automatically on a fresh database). They get **no invented orders and no portal login** —
use Admin → Customers → **Create login** when a customer is ready to order online.

## Order workflow (order-to-cash)
```
Customer places order (COD: attaches payment slip) → "Awaiting approval"
  └─▶ Admin approves (or adjusts / rejects with a reason)
        ├─▶ outlet's Central Kitchen: 1. Print sheet → 2. Start production → 3. Mark completed (actual, shortage, wastage)
        │     ─▶ Admin: Ready for pickup / Out for delivery (or Delivery failed → rebook) ─▶ Customer marks Received
        └─▶ Finance is alerted to issue the invoice (generated PDF, uploaded file, or Bukku)
```
- **Approval:** every customer order waits for Admin (`Pending`, shown as "Awaiting approval"); phone orders and replacements are approved on entry. Kitchen and Finance see an order only after approval. A blocked customer's order can be approved only under a Finance override.
- Customers can cancel only while it awaits approval; Admin until dispatch. **Add-on orders** link to an earlier open order and have their own number, invoice and DO.
- **Payment status:** Unpaid → Slip Uploaded → Paid, or Rejected. Finance records the amount received and payment date; a **deposit** (part payment on one invoice) keeps the invoice open with the balance.
- **Order block:** COD customers can't order while any invoice is not fully paid; credit-term customers only when an invoice is overdue. Finance can grant an **override** (reason; until a date ≤ 14 days, or one order).
- **Closures** (Admin → Closures): what they block (production / delivery / collection), reason, yearly repeat; existing orders on closed dates are flagged, never moved.
- **Audit trail:** `audit_log` records who did what with old and new values.
- Status colours (`src/status.js`): Awaiting approval = amber · New order = amber · In production = blue · Ready / Out = navy · Received = green · Rejected = red · Cancelled = grey.

## Finance & documents
- **Collection** (Reports → Collection): due today / within 7 days / overdue 1–7, 8–14, >14 days, with follow-up notes and payment history per customer.
- **Documents:** uploaded invoices record their own number, dates and amount; invoices and DOs can be replaced (reason + history). Per-company default methods in Settings.
- **Bukku** (`server/bukku.js`): switched off by default; credentials in `.env` (`BUKKU_ENABLED`, `BUKKU_KL_TOKEN`, `BUKKU_KL_SUBDOMAIN`, `BUKKU_IPH_…`). Field mapping to confirm before enabling.

## Backup, restore & security
- `npm run backup` → `backups/erp-…db` + uploads (safe while running; newest 30 kept). `npm run restore -- <file> --yes` (stop the server first). `npm run reset-db` backs up first.
- Sessions expire (30 days / 7 days unused); sign-in is throttled; the API only accepts the portal's own origin (`APP_URL`, `CORS_ORIGINS`). See **SECURITY.md**.

## Dispatch
- Admin sees orders not dispatched yet in two groups by pickup / delivery date: **To dispatch today** (including late ones whose date has passed) and **Yet to dispatch** (later dates). Both are on the dashboard and are tabs in Sales Orders.

## Complaints and credit notes
- A customer reports a problem when marking an order as received. Admin settles **every** complaint in **Sales → Complaints** with one of two options:
  - **Credit note:** Admin sends a request with the quantity and reason. Finance gets an alert and a to-do card and issues it in **Invoices → Credit Notes**, or declines it with a reason, which reopens the complaint for Admin.
  - **Replacement:** a no-charge (RM 0) order goes straight to the outlet's kitchen. Finance never invoices it.
- Finance can also raise its own credit note on any invoice: the **CN** link in All Invoices, or **+ New credit note**.
- Credit notes are numbered per company (`CN-KL-2026-0001`, `CN-IPH-…`). Each has its own PDF and email to the customer and needs an issued invoice.
- **Amount:** quantity × the price on the order, plus SST. It can't be more than was ordered or than the invoice total.
- **Effect on the invoice:** an issued credit note lowers what is owed (balance = invoice total − credit notes), and that balance is used by aging, order blocks, the dashboards and the customer's Payments page. A fully credited invoice is settled. If the invoice was already paid, the credit note is marked *Refund or offset* for Finance to settle.
- The Monthly Report shows credit notes issued in the month and the net SST. The Excel file has a "credit notes" sheet per company.
- Credit notes and replacements made on MOCK orders get `MOCK-` numbers and are removed by `npm run mock:clear`.

## Business rules (server enforces them; settings in the `settings` table)
- **Cutoff 1:00 PM MYT, office Mon–Fri.** Earliest pickup/delivery = working day the order counts as + 2 days
  (Mon→Wed … Fri→Sun; Fri after 1 PM / Sat / Sun → Monday → Wed). Closure announcements block dates. See `server/schedule.js`.
- **Delivery** only within each company's delivery area. **Each company (KL, Ipoh) sets its own** flat delivery fee and free-delivery amount (Admin › Settings › Pickup & delivery); free when the product subtotal (before SST) reaches that amount.
- **Emails** to a customer are sent from their company's own address (Admin › Settings › Company email), each with its own mailbox login in `.env` (`SMTP_KL_USER/PASS`, `SMTP_IPH_USER/PASS`).
- **Delivery address** defaults to the customer's registered business address (delivery address on file, else billing address). The customer doesn't type it or tick the area box. Only when they choose *Deliver to a different address* for an order do they enter one and confirm it's in the outlet's delivery area.
- **SST 6%** on products + delivery fee, 2 decimals. See `server/pricing.js`.
- **Payment terms:** new customers COD; can request 14 days 2 months after account start; Finance can change any time.
- **Bank transfer only:** each company's bank details come from the `outlets` table and are shown to the customer at checkout and on the invoice.

## Email
`EMAIL_MODE=log` (default): emails are saved to **Admin → Content → Email Outbox** and printed to the console.
Set `EMAIL_MODE=smtp` and the `SMTP_*` values in `.env` to really send (Nodemailer).

## Files & uploads
Slips, invoices, DOs, product images and discrepancy photos go to `server/uploads/` (git-ignored) under random names.
JPG / PNG / WEBP / PDF only, max 10 MB, content is checked. Customers can only open their own files; the kitchen can only open product images.

## Product catalog
`server/data/catalog.json` is the source of truth (44 products extracted from the wholesale catalog PDF, which is kept out of git — `*.pdf` is ignored).
Edit it, then `npm run import:catalog` (or Admin → Inventory → Products → Re-import catalog). Matching is by SKU; stock is never touched.
- `image`: file name in `server/data/product-images/` (or upload in Admin → Inventory → Product Images)
- `storage_notes`, `heating_notes`: shown per product — currently `[PLACEHOLDER]`
- `_flags`: values assumed because they were not in the PDF — please confirm

## Structure
```
client/                         React app (Vite). npm run build:prod → client/build, served by the API
  index.html vite.config.js package.json
  src/ menus.js                 menu bars for all portals
       pages/admin pages/finance pages/kitchen pages/portal pages/shared
       components/
server/
  app.js index.js config.js     express app (API + client build), start-up, .env.* loading
  db.js seed.js seed-data.js    SQLite schema (current); starting data (shared with the MySQL seed)
  mysql.js sql/                 MySQL pool; schema.sql, seed.sql, make-seed.js, check.js
  sales.js billing.js           order workflow; invoices, slips, terms, aging
  schedule.js pricing.js        cutoff/date rules; delivery fee + SST
  stock.js notify.js email.js   stock movements; notifications; email + outbox
  files.js pdf.js catalog.js    uploads; invoice/DO/report PDFs; catalog import
  routes/  admin.js finance.js kitchen.js customer.js purchasing.js
  tests/   api.test.js rules.test.js …
```
`npm run reset-db` deletes the database; it is rebuilt with fresh mock data on the next start.
