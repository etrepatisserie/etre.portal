# ERP Portal (prototype)

React + Vite frontend, Express + SQLite backend. Two portals behind one login:

- **Admin portal** (`/admin`): dashboard, sales orders, customers, stock tracking / adjustment / holds, statistics, purchasing, notifications
- **Customer portal** (`/portal`): stock purchase (catalog + cart), purchase history, delivery status, notifications

## Run
```bash
npm install     # first time only
npm run dev     # API on :3001 + web on :5173
```
Open http://localhost:5173

| Demo login | Password | Portal |
|---|---|---|
| admin@demo.test | admin123 | Admin |
| staff@demo.test | staff123 | Admin |
| harbor@demo.test, maple@demo.test, cafe@demo.test, littleoven@demo.test | customer123 | Customer |

## Product catalog
Products come from `catalog/Wholesale CATALOG.pdf`, transcribed into **`server/data/catalog.json`** (44 items).
That JSON file is the source of truth. To change prices or add items:

1. Edit `server/data/catalog.json`
2. Run `npm run import:catalog` (or Admin → Inventory → Products → **Re-import catalog**)

Import matches on SKU: existing products are updated, new ones added, stock levels are never touched.
Items marked `_flags` contain values that were **not in the PDF** and were assumed (generated SKUs, MOQ = 1, category codes SDG/BRD) — confirm and edit them.

Prices are wholesale, in RM, **before SST** (no tax is calculated yet).
Ingredients and packaging (`ING-*`, `PKG-*`) are mock data, are not sold to customers, and are bought via purchase orders.

## Stock rules
- **Available = on hand − on hold.** Customers can only order available stock, and at least the product's MOQ.
- Placing an order puts stock **on hold**; shipping deducts it from **on hand**; cancelling releases it.
- Admins can add manual holds (e.g. reserve for an event, quality check) and adjustments (with a reason). Every change is logged in Stock Movements.
- Receiving a purchase order adds stock. Low-stock alerts go to admins when available ≤ reorder level.

## Structure
```
server/
  db.js              schema + column migrations
  seed.js            mock customers, orders, stock history (runs on an empty database)
  catalog.js         catalog importer;  data/catalog.json  the catalog data
  sales.js stock.js notify.js auth.js
  routes/admin.js  routes/customer.js  routes/purchasing.js
src/
  menus.js           both menu bars — add ERP modules here
  pages/admin  pages/portal  pages/shared  components/
```

`npm run reset-db` deletes the database; it is rebuilt with fresh mock data on the next start.
