// Loads server/data/catalog.json (extracted from catalog/Wholesale CATALOG.pdf)
// and upserts it into the products table by SKU. Safe to run repeatedly:
// existing products get updated details/prices, stock levels are never touched.
// Product photos: put the file in server/data/product-images/ and set "image" to its file name.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { saveBuffer } from './files.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = path.join(DATA, 'catalog.json');
const IMAGE_DIR = path.join(DATA, 'product-images');
const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export function loadCatalog() {
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function importImage(productId, fileName, result) {
  const abs = path.join(IMAGE_DIR, path.basename(fileName));
  const mime = IMAGE_MIME[path.extname(abs).toLowerCase()];
  if (!mime || !fs.existsSync(abs)) { result.missing_images.push(fileName); return; }
  const current = db.prepare('SELECT f.original_name FROM products p JOIN files f ON f.id = p.image_file_id WHERE p.id = ?').get(productId);
  if (current?.original_name === path.basename(abs)) return; // already imported
  const fileId = saveBuffer(fs.readFileSync(abs), { kind: 'product_image', name: path.basename(abs), mime });
  db.prepare('UPDATE products SET image_file_id = ? WHERE id = ?').run(fileId, productId);
  result.images += 1;
}

export function importCatalog() {
  const catalog = loadCatalog();
  const find = db.prepare('SELECT id FROM products WHERE sku = ?');
  const update = db.prepare(`UPDATE products SET name=?, category=?, category_code=?, size=?, uom=?, sell_price=?, moq=?,
                               recommended_rsp=?, shelf_life=?, storage_notes=?, heating_notes=?, notes=?, is_sellable=1 WHERE id=?`);
  const insert = db.prepare(`INSERT INTO products (sku, name, category, category_code, size, uom, sell_price, moq,
                               recommended_rsp, shelf_life, storage_notes, heating_notes, notes, is_sellable, unit_cost)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,0)`);
  const result = { inserted: [], updated: [], flagged: [], images: 0, missing_images: [] };

  db.transaction(() => {
    for (const p of catalog.products) {
      const cat = catalog.categories[p.category];
      if (!cat) throw new Error(`Unknown category ${p.category} for ${p.sku}`);
      const values = [p.name, cat.name, p.category, p.size, p.uom, p.price, p.moq, p.rsp, p.shelf_life, p.storage_notes || null, p.heating_notes || null, cat.note || null];
      const existing = find.get(p.sku);
      let id;
      if (existing) { update.run(...values, existing.id); id = existing.id; result.updated.push(p.sku); }
      else { id = insert.run(p.sku, ...values).lastInsertRowid; result.inserted.push(p.sku); }
      if (p.image) importImage(id, p.image, result);
      if (p._flags) result.flagged.push({ sku: p.sku, name: p.name, flags: p._flags });
    }
    db.prepare('INSERT OR IGNORE INTO product_stock (product_id, outlet_id) SELECT p.id, o.id FROM products p, outlets o').run();
  })();
  return result;
}
