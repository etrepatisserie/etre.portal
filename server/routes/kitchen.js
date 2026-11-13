// Central Kitchen API — one kitchen per outlet. NEVER return prices, totals, costs, invoices or payment
// data from here: every response is built from an explicit list of allowed fields.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import db from '../db.js';
import { HttpError } from '../errors.js';
import { getOrder, kitchenView, markPrinted, markProcessing, KITCHEN_STATUSES } from '../sales.js';
import { moveStock, stockRows } from '../stock.js';
import { todayMYT, addDays } from '../schedule.js';
import { renderKitchenReport } from '../pdf.js';
import { outletSql, assertOutlet, requireOutlet, getOutlet } from '../outlets.js';
import { productImageUrl } from './customer.js';

const r = Router();
const IN = `(${KITCHEN_STATUSES.map((s) => `'${s}'`).join(',')})`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const range = (q, days = 7) => {
  const from = DATE.test(q.from || '') ? q.from : todayMYT();
  const to = DATE.test(q.to || '') ? q.to : addDays(from, days);
  if (to < from) throw new HttpError(400, '"To" date must be on or after "From"');
  return { from, to };
};

r.get('/dashboard', (req, res) => {
  const today = todayMYT();
  const O = outletSql(req, 'so');
  const one = (sql, ...p) => db.prepare(sql).get(...p).n;
  res.json({
    today,
    outlet: req.outletId ? getOutlet(req.outletId).name : null,
    to_print: one(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ('Confirmed','Invoiced') AND so.printed_at IS NULL${O}`),
    to_start: one(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status IN ('Confirmed','Invoiced') AND so.printed_at IS NOT NULL${O}`),
    in_production: one(`SELECT COUNT(*) AS n FROM sales_orders so WHERE so.status = 'Processing'${O}`),
    produce_today: one(`SELECT COALESCE(SUM(l.quantity),0) AS n FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id WHERE so.status IN ${IN} AND so.production_date = ?${O}`, today),
    produce_tomorrow: one(`SELECT COALESCE(SUM(l.quantity),0) AS n FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id WHERE so.status IN ${IN} AND so.production_date = ?${O}`, addDays(today, 1)),
  });
});

// Orders: placed (Confirmed) and later, this outlet only
r.get('/orders', (req, res) => {
  const { status, production_date } = req.query;
  let sql = `SELECT so.id FROM sales_orders so WHERE so.status IN ${IN}${outletSql(req, 'so')}`;
  const p = [];
  if (status === 'Open') sql += " AND so.status IN ('Confirmed','Invoiced','Processing')";
  else if (status === 'New') sql += " AND so.status IN ('Confirmed','Invoiced')";
  else if (status && KITCHEN_STATUSES.includes(status)) { sql += ' AND so.status = ?'; p.push(status); }
  if (DATE.test(production_date || '')) { sql += ' AND so.production_date = ?'; p.push(production_date); }
  const ids = db.prepare(`${sql} ORDER BY so.production_date ${status ? 'ASC' : 'DESC'}, so.fulfil_date, so.id LIMIT 300`).all(...p);
  res.json(ids.map(({ id }) => kitchenView(getOrder(id))));
});

const kitchenOrder = (req, id) => {
  const so = getOrder(id);
  if (!so || !KITCHEN_STATUSES.includes(so.status)) throw new HttpError(404, 'Order not found');
  assertOutlet(req, so.outlet_id);
  return so;
};
r.get('/orders/:id', (req, res) => res.json(kitchenView(kitchenOrder(req, req.params.id))));
r.post('/orders/:id/printed', (req, res) => { kitchenOrder(req, req.params.id); markPrinted(Number(req.params.id)); res.json(kitchenView(getOrder(req.params.id))); });
r.post('/orders/:id/processing', (req, res) => { kitchenOrder(req, req.params.id); markProcessing(Number(req.params.id)); res.json(kitchenView(getOrder(req.params.id))); });

// ---------- production plan: total qty per product per production date ----------
function productionPlan(req, from, to) {
  const rows = db.prepare(`
    SELECT so.production_date, p.id AS product_id, p.sku, p.name, p.uom, p.size, p.category, p.image_file_id,
           SUM(l.quantity) AS qty, COUNT(DISTINCT so.id) AS orders, GROUP_CONCAT(DISTINCT so.fulfil_date) AS fulfil_dates
    FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id JOIN products p ON p.id = l.product_id
    WHERE so.status IN ${IN} AND l.quantity > 0 AND so.production_date BETWEEN ? AND ?${outletSql(req, 'so')}
    GROUP BY so.production_date, p.id ORDER BY so.production_date, p.category, p.name`).all(from, to);
  const produced = db.prepare(`SELECT product_id, SUM(qty) AS n FROM stock_movements m WHERE m.type = 'receipt' AND m.ref = ?${outletSql(req, 'm')} GROUP BY product_id`);
  const cache = {};
  return rows.map((r2) => {
    cache[r2.production_date] ??= Object.fromEntries(produced.all(`PROD-${r2.production_date}`).map((x) => [x.product_id, x.n]));
    return {
      production_date: r2.production_date, product_id: r2.product_id, sku: r2.sku, name: r2.name, uom: r2.uom, size: r2.size, category: r2.category,
      image_url: productImageUrl(r2.image_file_id), qty: r2.qty, orders: r2.orders,
      fulfil_dates: (r2.fulfil_dates || '').split(',').filter(Boolean).sort(), produced: cache[r2.production_date][r2.product_id] || 0,
    };
  });
}
r.get('/production', (req, res) => { const { from, to } = range(req.query, 6); res.json({ from, to, rows: productionPlan(req, from, to) }); });

// Record finished goods produced (adds to this outlet's stock)
r.post('/production', (req, res) => {
  const { product_id, qty, production_date } = req.body;
  const outletId = requireOutlet(req, req.body.outlet_id);
  const n = parseInt(qty, 10);
  if (!(n > 0)) throw new HttpError(400, 'Quantity must be greater than 0');
  if (!DATE.test(production_date || '')) throw new HttpError(400, 'Production date is required');
  const p = db.prepare('SELECT id, is_sellable FROM products WHERE id = ?').get(product_id);
  if (!p || !p.is_sellable) throw new HttpError(400, 'Choose a finished product');
  const balance = db.transaction(() => moveStock(p.id, outletId, 'receipt', n, { reason: 'Production', ref: `PROD-${production_date}`, userId: req.user.id }))();
  res.status(201).json({ on_hand: balance });
});

// Ingredients & finished goods of this outlet (no cost / price fields)
const kitchenStock = (req, sellable) => stockRows(req.outletId, 'p.is_sellable = ?', [sellable ? 1 : 0])
  .map((s) => ({ id: s.id, sku: s.sku, name: s.name, category: s.category, uom: s.uom, size: s.size, outlet_code: s.outlet_code,
    stock_on_hand: s.stock_on_hand, reorder_level: s.reorder_level, level: s.stock_on_hand <= s.reorder_level ? 'Low' : 'OK' }));
r.get('/ingredients', (req, res) => res.json(kitchenStock(req, false)));
r.get('/products', (req, res) => res.json(kitchenStock(req, true)));

r.post('/ingredient-usage', (req, res) => {
  const { product_id, qty, note } = req.body;
  const outletId = requireOutlet(req, req.body.outlet_id);
  const n = parseInt(qty, 10);
  if (!(n > 0)) throw new HttpError(400, 'Quantity used must be greater than 0');
  const p = db.prepare('SELECT id, is_sellable FROM products WHERE id = ?').get(product_id);
  if (!p || p.is_sellable) throw new HttpError(400, 'Choose an ingredient or packaging item');
  const balance = db.transaction(() => moveStock(p.id, outletId, 'adjustment', -n, { reason: `Used in production${note ? ` — ${String(note).slice(0, 200)}` : ''}`, userId: req.user.id }))();
  res.status(201).json({ on_hand: balance });
});

// Production & usage log (no prices)
r.get('/movements', (req, res) => {
  res.json(db.prepare(`SELECT m.id, m.created_at, m.qty, m.balance_after, m.reason, m.ref, p.sku, p.name AS product_name, p.uom, p.is_sellable, u.name AS user_name
                       FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
                       WHERE ((m.type = 'receipt' AND m.reason = 'Production') OR m.reason LIKE 'Used in production%')${outletSql(req, 'm')}
                       ORDER BY m.created_at DESC, m.id DESC LIMIT 200`).all());
});

// ---------- summary report ----------
r.get('/report', async (req, res) => {
  const { from, to } = range(req.query, 6);
  const byProduct = new Map();
  for (const row of productionPlan(req, from, to)) {
    const x = byProduct.get(row.product_id) || { sku: row.sku, name: row.name, uom: row.uom, units: 0, fulfil_dates: new Set() };
    x.units += row.qty;
    row.fulfil_dates.forEach((d) => x.fulfil_dates.add(d));
    byProduct.set(row.product_id, x);
  }
  const orderCounts = db.prepare(`SELECT l.product_id, COUNT(DISTINCT so.id) AS n FROM sales_order_lines l JOIN sales_orders so ON so.id = l.so_id
                                  WHERE so.status IN ${IN} AND l.quantity > 0 AND so.production_date BETWEEN ? AND ?${outletSql(req, 'so')} GROUP BY l.product_id`).all(from, to);
  const rows = [...byProduct.entries()].map(([pid, x]) => ({
    sku: x.sku, name: x.name, uom: x.uom, units: x.units,
    orders: orderCounts.find((o) => o.product_id === pid)?.n || 0, fulfil_dates: [...x.fulfil_dates].sort(),
  })).sort((a, b) => b.units - a.units);

  const outletName = req.outletId ? getOutlet(req.outletId).name : '';
  const format = req.query.format;
  const name = `production-summary${outletName ? `-${outletName.toLowerCase().replace(/\s+/g, '-')}` : ''}-${from}-to-${to}`;
  if (format === 'pdf') {
    const pdf = await renderKitchenReport({ from, to, rows, outletName, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    return res.send(pdf);
  }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Production summary');
    ws.addRow([`Production summary${outletName ? ` — ${outletName}` : ''} ${from} to ${to}`]).font = { bold: true, size: 13 };
    ws.addRow([]);
    ws.addRow(['SKU', 'Product', 'Unit', 'Total qty', 'Orders', 'Pickup / delivery dates']).font = { bold: true };
    rows.forEach((x) => ws.addRow([x.sku, x.name, x.uom, x.units, x.orders, x.fulfil_dates.join(', ')]));
    ws.columns.forEach((c, i) => { c.width = [12, 36, 8, 10, 9, 40][i]; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    return res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }
  res.json({ from, to, rows });
});

export default r;
