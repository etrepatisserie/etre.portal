// CLI: npm run import:catalog
import { importCatalog } from './catalog.js';

const r = importCatalog();
console.log(`Catalog import done: ${r.inserted.length} added, ${r.updated.length} updated.`);
if (r.inserted.length) console.log('Added:', r.inserted.join(', '));
if (r.images) console.log(`Images imported: ${r.images}`);
if (r.missing_images.length) console.log(`Images not found in server/data/product-images: ${r.missing_images.join(", ")}`);
if (r.flagged.length) {
  console.log(`\n${r.flagged.length} products have values that were assumed (not in the PDF) — please review:`);
  for (const f of r.flagged) console.log(`  ${f.sku.padEnd(11)} ${f.name.padEnd(38)} ${f.flags.join('; ')}`);
}
