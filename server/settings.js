// Business settings stored in the `settings` table (starting values: sql/seed.sql).
import db from './db.js';

export async function getSettings() {
  const out = {};
  for (const { key, value } of await db.prepare('SELECT `key`, `value` FROM settings').all()) {
    try { out[key] = JSON.parse(value); } catch { out[key] = value; }
  }
  return out;
}

export async function setSetting(key, value) {
  await db.prepare('INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)').run(key, JSON.stringify(value));
}
