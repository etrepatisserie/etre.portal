// Loads server/data/catalog.json (extracted from catalog/Wholesale CATALOG.pdf)
// and upserts it into the products table by SKU. Safe to run repeatedly:
// existing products get updated details/prices, stock levels are never touched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'catalog.json');

export function loadCatalog() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

export function importCatalog() {
  const catalog = loadCatalog();
  const find = db.prepare('SELECT id FROM products WHERE sku = ?');
  const update = db.prepare(`UPDATE products SET name=?, category=?, category_code=?, size=?, uom=?, sell_price=?, moq=?,
                               recommended_rsp=?, shelf_life=?, notes=?, is_sellable=1 WHERE id=?`);
  const insert = db.prepare(`INSERT INTO products (sku, name, category, category_code, size, uom, sell_price, moq,
                               recommended_rsp, shelf_life, notes, is_sellable, unit_cost, stock_on_hand, reorder_level)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,1,0,0,?)`);
  const result = { inserted: [], updated: [], flagged: [] };

  db.transaction(() => {
    for (const p of catalog.products) {
      const cat = catalog.categories[p.category];
      if (!cat) throw new Error(`Unknown category ${p.category} for ${p.sku}`);
      const values = [p.name, cat.name, p.category, p.size, p.uom, p.price, p.moq, p.rsp, p.shelf_life, cat.note || null];
      const existing = find.get(p.sku);
      if (existing) { update.run(...values, existing.id); result.updated.push(p.sku); }
      else { insert.run(p.sku, ...values, defaultReorderLevel(p)); result.inserted.push(p.sku); }
      if (p._flags) result.flagged.push({ sku: p.sku, name: p.name, flags: p._flags });
    }
  })();
  return result;
}

// Starting reorder level until the bakery sets real ones: ~4 minimum orders for pieces, 3 for cakes/loaves
export const defaultReorderLevel = (p) => (p.uom === 'PC' ? Math.max(p.moq * 4, 10) : 3);
