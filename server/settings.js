// Business settings stored in the `settings` table (defaults below are written on first start).
import db from './db.js';
import { DEFAULT_SETTINGS } from './seed-data.js';
export { DEFAULT_SETTINGS };

const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertDefault.run(k, JSON.stringify(v));

export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[key] = JSON.parse(value); } catch { out[key] = value; }
  }
  return out;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

