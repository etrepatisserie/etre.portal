// Finance override: lets a blocked customer place orders, with a reason and an expiry
// (a last date — at most 14 days ahead — or "for one order"). Shown on the customer's record; recorded in the audit log.
// Without an override the block lifts only when Finance verifies enough payment.
import db from './db.js';
import { HttpError } from './errors.js';
import { addDays, todayMYT } from './schedule.js';
import { audit } from './audit.js';

export const MAX_OVERRIDE_DAYS = 14;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// the override in force today, if any (a single-order one stays in force until an order uses it)
export async function activeOverride(customerId, now = new Date()) {
  const today = todayMYT(now);
  return await db.prepare(`SELECT o.*, u.name AS granted_by_name FROM block_overrides o LEFT JOIN users u ON u.id = o.granted_by
                     WHERE o.customer_id = ? AND o.revoked_at IS NULL
                       AND ((o.single_order = 1 AND o.used_so_id IS NULL) OR (o.single_order = 0 AND o.expires_on >= ?))
                     ORDER BY o.id DESC LIMIT 1`).get(customerId, today) || null;
}

export async function listOverrides(customerId) {
  return await db.prepare(`SELECT o.*, g.name AS granted_by_name, r.name AS revoked_by_name, so.so_number AS used_so_number
                     FROM block_overrides o LEFT JOIN users g ON g.id = o.granted_by LEFT JOIN users r ON r.id = o.revoked_by
                     LEFT JOIN sales_orders so ON so.id = o.used_so_id WHERE o.customer_id = ? ORDER BY o.id DESC`).all(customerId);
}

export async function grantOverride(customerId, { reason, expiresOn = null, singleOrder = false, userId, now = new Date() }) {
  const c = await db.prepare('SELECT id, name, outlet_id FROM customers WHERE id = ?').get(customerId);
  if (!c) throw new HttpError(404, 'Customer not found');
  const why = String(reason || '').trim();
  if (!why) throw new HttpError(400, 'Give the reason for the override');
  const today = todayMYT(now);
  if (!singleOrder) {
    if (!DATE.test(expiresOn || '')) throw new HttpError(400, 'Choose the last day the override applies, or "for one order"');
    if (expiresOn < today) throw new HttpError(400, 'The expiry date has already passed');
    if (expiresOn > addDays(today, MAX_OVERRIDE_DAYS)) throw new HttpError(400, `An override can last at most ${MAX_OVERRIDE_DAYS} days`);
  }
  // one override at a time: a new one replaces the current one
  const current = await activeOverride(customerId, now);
  if (current) await db.prepare("UPDATE block_overrides SET revoked_at = NOW(), revoked_by = ? WHERE id = ?").run(userId, current.id);
  const id = (await db.prepare('INSERT INTO block_overrides (customer_id, reason, expires_on, single_order, granted_by) VALUES (?,?,?,?,?)')
    .run(customerId, why.slice(0, 300), singleOrder ? null : expiresOn, singleOrder ? 1 : 0, userId)).lastInsertRowid;
  await audit({ entity: 'customer', entityId: customerId, action: 'override_granted', userId, outletId: c.outlet_id,
    after: { reason: why, expires_on: singleOrder ? null : expiresOn, single_order: !!singleOrder }, note: current ? `replaces override #${current.id}` : null });
  return await db.prepare('SELECT * FROM block_overrides WHERE id = ?').get(id);
}

export async function revokeOverride(overrideId, { userId }) {
  const o = await db.prepare('SELECT o.*, c.outlet_id FROM block_overrides o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(overrideId);
  if (!o) throw new HttpError(404, 'Override not found');
  if (o.revoked_at) throw new HttpError(400, 'Already revoked');
  await db.prepare("UPDATE block_overrides SET revoked_at = NOW(), revoked_by = ? WHERE id = ?").run(userId, overrideId);
  await audit({ entity: 'customer', entityId: o.customer_id, action: 'override_revoked', userId, outletId: o.outlet_id,
    before: { reason: o.reason, expires_on: o.expires_on, single_order: !!o.single_order } });
  return o;
}

// a single-order override is used up by the order it allowed
export async function useOverride(override, soId) {
  if (override?.single_order) await db.prepare('UPDATE block_overrides SET used_so_id = ? WHERE id = ? AND used_so_id IS NULL').run(soId, override.id);
}
