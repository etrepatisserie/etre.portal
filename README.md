# ERP Portal (prototype) — Être Patisserie wholesale

React + Vite frontend, Express + SQLite backend. Four portals behind one sign-in page:

| Portal | URL | Who | What |
|---|---|---|---|
| Customer | `/portal` | B2B customers | Checkout (pickup/delivery, dates, fees, SST, COD slip), purchase history with one invoice summary, delivery tracking, payments, credit-term request, Info (ordering, suggested selling prices, storage, heating) |
| Admin | `/admin` | Admin | Adjust short items, dispatch, delivery links, discrepancies, customers, stock, purchasing, statistics, announcements, product images, email outbox |
| Finance | `/finance` | Finance | Invoice every new order, verify payment slips, payment terms & requests, aging report (Excel/CSV) — all filterable by customer |
| Central Kitchen | `/kitchen` | Kitchen | Confirmed orders (no prices), print PO / production sheet, production plan, production & ingredient records, summary report (Excel/PDF) |

## Run
```bash
npm install          # first time only
cp .env.example .env # first time only (email settings)
npm run dev          # API on :3001 + web on :5173
npm test             # API + rules tests (uses a temporary database)
```
Open http://localhost:5173

A fresh database has the 16 real customers, the catalog, ingredients with opening stock and the staff logins. It also has **mock finance data** on the 4 customer test logins (see below).

| Staff login | Password | Sees |
|---|---|---|
| admin@demo.test | admin123 | Admin — head office (KL + Ipoh) |
| staff@demo.test / admin.ipoh@demo.test | staff123 / admin123 | Admin — KL only / Ipoh only |
| finance@demo.test | finance123 | Finance — both companies (KL / Ipoh / Both tabs at the top of every page) |
| kitchen@demo.test / kitchen.ipoh@demo.test | kitchen123 | Kitchen — KL / Ipoh (never sees prices) |

**Customer test logins (real customers, password `customer123`):** 4 real customers have a test login: one KL COD, one Ipoh COD, one Ipoh 15-day and one Ipoh 30-day. They are shown on the sign-in page.
- They let you see the portal as that customer. No orders or invoices are invented, and anything you order with them is a real order in the system.
- To choose which customers get one, add `"demo_login": "name@demo.test"` to them in the git-ignored `server/data/customers.json`, then run `npm run import:customers`.
- The sign-in page list is switched off when `NODE_ENV=production`.

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

**Demo data (optional):** `npm run reset-db && SEED_DEMO=1 npm run dev` adds 7 fictional "(demo)" customers (`cafe@`, `maple@`, `harbor@`, `littleoven@`, `beanbloom@`, `kinta@`, `perakhotel@` · password customer123), plus 6 months of orders, invoices and slips. The tests always use it.

- **Statistics (graphs):** Finance → Reports → Statistics shows each company's invoiced vs collected, aging, who owes the most, days to pay, on-time %, top customers, sales by term and credit notes (3 / 6 / 12 months). Each chart has a table view.

- **Payables:** Finance → Payables. When a purchase order is received, Finance records the supplier's bill (number, date, term, amount) and later marks it paid. Totals are per company.
- **Cash conversion cycle:** Finance → Reports → Cash Conversion Cycle. CCC = DIO + DSO − DPO per company, by month, with the inputs behind each part. DIO needs ingredient stock movements (receipts plus usage via stock adjustments); DPO needs supplier bills.
- Mock purchasing (MOCK-PO, MOCK-BILL, ingredient usage that nets to zero) is part of the mock data. `npm run mock:purchasing` adds just that part.

## Outlets: KL and Ipoh (separate companies)
| | KL | Ipoh |
|---|---|---|
| Company | ETRE PATISSERIE KL SDN BHD (202301018733 / 1512655-A) | ETRE PATISSERIE SDN BHD (1375339-U) |
| Numbers | SO-KL-…, INV-KL-…, DO-KL-…, PO-KL-… | SO-IPH-…, INV-IPH-…, DO-IPH-…, PO-IPH-… |
| Kitchen, stock, ingredients, POs, closures | KL only | Ipoh only |

- Every customer has a **home outlet**: it decides pickup address, slots, delivery area, closures, bank account, the kitchen that bakes and the company that invoices.
- Staff with an outlet see **only that outlet**. Head office logins (`admin@`, `finance@`) see both and can switch KL / Ipoh / Both in the menu bar.
- Company, bank, pickup and delivery-area details live in the `outlets` table. Bank: KL — Maybank 514012480012; Ipoh — RHB Bank 20809800044129 (ETRE PATISSERIE SDN BHD).

## Real customers
`Real customer data/` (the accounting system's debtor reports) is **git-ignored**, as is the extracted `server/data/customers.json`.
`npm run import:customers` adds / updates them by debtor code (also done automatically on a fresh database). They get **no invented orders and no portal login** —
use Admin → Customers → **Create login** when a customer is ready to order online.

## Order workflow
```
Customer places order (COD: attaches payment slip)
  ├─▶ goes straight to the Central Kitchen ─▶ Kitchen prints sheet & starts (In production)
  │                                           ─▶ Admin: Ready for pickup / Out for delivery ─▶ Customer checks items & marks Received
  └─▶ Finance is alerted to issue the invoice (COD slip is attached to it, then verified)
```
- No admin confirmation. Admin only reduces quantities if something is short (before the kitchen starts), dispatches, sends tracking links and resolves problems.
- The invoice is a separate track, not an order stage. Customers can cancel until the kitchen starts (any invoice is voided); Admin until dispatch.
- Payment status per invoice: **Unpaid → Slip Uploaded → Paid**, or **Rejected** (counts as unpaid).
- **Order block:** COD customers can't order while any invoice is not Paid (Slip Uploaded still counts). 14-day customers are blocked only by an *overdue* invoice.
- Colours: New order = blue · In production = teal · Ready / Out = rose · Received = green · Cancelled = grey (`src/status.js`).

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
- **Delivery** only within KL / Klang Valley, flat RM25, free when product subtotal (before SST) ≥ RM500.
- **Delivery address** defaults to the customer's registered business address (delivery address on file, else billing address). The customer doesn't type it or tick the area box. Only when they choose *Deliver to a different address* for an order do they enter one and confirm it's in the outlet's delivery area.
- **SST 6%** on products + delivery fee, 2 decimals. See `server/pricing.js`.
- **Payment terms:** new customers COD; can request 14 days 2 months after account start; Finance can change any time.
- **Bank transfer only:** KL — Maybank · ETRE PATISSERIE KL SDN BHD · 514012480012. Ipoh — RHB Bank · ETRE PATISSERIE SDN BHD · 20809800044129.

## Email
`EMAIL_MODE=log` (default): emails are saved to **Admin → Content → Email Outbox** and printed to the console.
Set `EMAIL_MODE=smtp` and the `SMTP_*` values in `.env` to really send (Nodemailer).

## Files & uploads
Slips, invoices, DOs, product images and discrepancy photos go to `server/uploads/` (git-ignored) under random names.
JPG / PNG / WEBP / PDF only, max 10 MB, content is checked. Customers can only open their own files; the kitchen can only open product images.

## Product catalog
`server/data/catalog.json` is the source of truth (44 products from `catalog/Wholesale CATALOG.pdf`).
Edit it, then `npm run import:catalog` (or Admin → Inventory → Products → Re-import catalog). Matching is by SKU; stock is never touched.
- `image`: file name in `server/data/product-images/` (or upload in Admin → Inventory → Product Images)
- `storage_notes`, `heating_notes`: shown per product — currently `[PLACEHOLDER]`
- `_flags`: values assumed because they were not in the PDF — please confirm

## Structure
```
server/
  app.js index.js config.js     express app, start-up, .env
  db.js seed.js                 schema; mock data (runs on an empty database)
  sales.js billing.js           order workflow; invoices, slips, terms, aging
  schedule.js pricing.js        cutoff/date rules; delivery fee + SST
  stock.js notify.js email.js   stock movements; notifications; email + outbox
  files.js pdf.js catalog.js    uploads; invoice/DO/report PDFs; catalog import
  routes/  admin.js finance.js kitchen.js customer.js purchasing.js
  tests/   api.test.js rules.test.js
src/
  menus.js                      menu bars for all portals
  pages/admin pages/finance pages/kitchen pages/portal pages/shared
  components/
```
`npm run reset-db` deletes the database; it is rebuilt with fresh mock data on the next start.
