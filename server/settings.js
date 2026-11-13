// Business settings stored in the `settings` table (defaults below are written on first start).
import db from './db.js';

export const DEFAULT_SETTINGS = {
  sst_rate: 0.06,                      // 6% — applies to products AND delivery fee
  delivery_fee: 25,                    // RM, flat
  free_delivery_threshold: 500,        // RM, product subtotal before SST
  cutoff_time: '13:00',                // MYT
  max_days_ahead: 30,                  // furthest pickup/delivery date a customer can pick
  credit_term_min_months: 2,           // account age before a customer may request 14-day terms
  // company, bank, pickup address/slots and delivery area are per outlet → see outlets.js
};

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

