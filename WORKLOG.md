# Work Log

A record of each completed task — newest first.

---

## 2026-11-10 · Task 3 — Imported the wholesale catalog

**Request:** Study `catalog/Wholesale CATALOG.pdf` and insert its data into the system.

**Result:** All 44 catalog products are in the system. Every product's name, price and MOQ was checked against the catalog data and matches.

| Category | Items | Wholesale price (before SST) |
|---|---|---|
| Viennoiserie (VIN) | 13 | RM 3.00 – 8.00 |
| Sandwiches (SND) | 3 | RM 11.00 – 12.00 |
| Petit Gâteau (PTG) | 7 | RM 11.00 – 110.00 |
| Whole Cakes (FULLC) | 5 | RM 99.00 – 165.00 |
| Sourdough | 4 | RM 9.00 – 10.00 |
| Bagels & Breads | 12 | RM 3.00 – 10.00 |

**What changed**
- New product fields: size, MOQ, recommended RSP, shelf life. They're shown on customer product cards.
- MOQ is enforced when an order is placed (e.g. ordering 2 croissants is refused because the minimum is 5).
- The currency is now RM, labelled "excl. SST".
- The Lescure butter note is shown on the Viennoiserie category.
- Earlier sample items (flour, butter, boxes) became ingredients and packaging: bought via purchase orders, never shown to customers.
- The database was rebuilt so the mock order history uses the real catalog products. Customers and orders are still fictional.
- The catalog's source of truth is `server/data/catalog.json`. To update it, edit the file and run `npm run import:catalog` (or use Admin → Products → **Re-import catalog**). Import matches on SKU and never changes stock levels.

**To confirm: values that were assumed, not taken from the PDF (24 products flagged in catalog.json)**
1. 21 SKUs were generated for whole cakes, sourdough and bagels/breads, e.g. `C-TIR-001`, `S-BWS-001`, `B-OBG-001`.
2. MOQ was set to 1 for 3 sandwiches and 4 sourdoughs (none stated).
3. Page 4 categories were named "Sourdough" (`SDG`) and "Bagels & Breads" (`BRD`).
4. Spelling was corrected: "Matche" → "Matcha", "fozen" → "frozen".
5. SST is not calculated yet. The rate is needed.

**Not imported:** product photos (they aren't labelled in the PDF), and real stock quantities and reorder levels (current numbers are placeholders).

**Checks run:** 44 of 44 products match the catalog data. No stock balance goes negative, no mock order line is below MOQ, and customers can't see or order ingredients. Re-running the import updated all 44 products and added no duplicates.

---

## 2026-11-10 · Task 2 — Customer & admin portals with login

**Request:** A system with a customer portal and an admin portal, each user with their own login, filled with mock data.
- Customer: stock purchase, purchase history, delivery status.
- Admin: dashboard, sales, statistics, add new customer, stock tracking / adjustment / on hold, notifications.

**Result**
- **Login:** one sign-in page sends each user to their own portal. Passwords are stored hashed. Customers can't open admin pages, and each customer sees only their own orders.
- **Customer portal** (`/portal`):
  - **Stock Purchase:** catalog with live available quantities, a cart, and checkout.
  - **Purchase History:** order list and order detail, cancel while Pending, and "Buy again".
  - **Delivery Status:** progress stepper with carrier and tracking number.
- **Admin portal** (`/admin`):
  - **Dashboard:** KPIs, fulfilment pipeline, recent orders, stock alerts.
  - **Sales:** order list, order detail with the Confirm → Packed → Shipped → Delivered steps (shipping records carrier and tracking), New Sale form.
  - **Customers:** customer list, plus **Add New Customer**, which creates the customer record and their portal login in one step.
  - **Stock:** Stock Tracking (on hand / on hold / available), Stock Adjustment (reason required), Stock on Hold (manual holds and release), Stock Movements log.
  - **Statistics:** revenue and orders per month, top products, top customers, orders by status. Each chart has a table view.
  - **Purchasing:** the module from Task 1 is now under Admin. Receiving a PO adds stock.
- **Notifications:** a bell with unread count, a pop-up toast when something new arrives, and a full notifications page. Admins are notified of new orders, low stock and new customers. Customers are notified of each status change on their orders.
- **Stock rules:** available = on hand − on hold. Placing an order puts the stock on hold, shipping deducts it from on hand, and cancelling releases the hold.
- **Mock data:** 2 admins, 4 customers, about 6 months of orders, purchase orders, holds and notifications.

**Demo logins:** `admin@demo.test` / `admin123` · `staff@demo.test` / `staff123` · `harbor@`, `maple@`, `cafe@`, `littleoven@demo.test` / `customer123`

**Checks run:** API smoke tests passed: login and role access, order → hold → ship → stock deducted, customers isolated from each other's orders, validation errors, new customer can log in, and PO receipt adds stock. The production build succeeds. The chart color was checked with the palette validator and passed.
**Not verified:** pages were not checked in a browser (the headless-Chrome screenshot step was declined).

---

## 2026-11-10 · Task 1 — ERP prototype with purchase orders

**Request:** A prototype web portal using SQLite, React and Vite, where users can create purchase orders, with a menu bar, as the base for an ERP. Install Node.js if missing.

**Result**
- Node.js wasn't installed. Installed Node.js v22 LTS (npm 10) via Homebrew.
- Stack: React + Vite frontend, Express API, SQLite database (`server/erp.db`).
- Top menu bar with dropdowns, built from one list so new ERP modules are easy to add. Unbuilt modules show a "soon" placeholder.
- Purchase orders: create with supplier, dates, tax and line items. Totals update live. PO numbers are generated automatically (`PO-YYYY-0001`).
- PO approval steps: Draft → Submitted → Approved → Received, and Cancel is allowed before Received. Only drafts can be edited or deleted.
- PO list with search and status filter, a printable detail page, and supplier and product pages.

**Checks run:** API tested end to end (create, view, status changes, invalid changes rejected, validation). The production build succeeds.

---

**How to run:** `cd ~/Documents/testing-project && npm run dev` → http://localhost:5173
