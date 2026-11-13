// Audit trail: who did what, when, with the old and new values. Read by Admin / Finance on the record's page.
import db from './db.js';

const json = (v) => (v == null ? null : JSON.stringify(v));

export function audit({ entity, entityId = null, action, userId = null, outletId = null, before = null, after = null, note = null }) {
  db.prepare('INSERT INTO audit_log (entity, entity_id, action, outlet_id, user_id, before, after, note) VALUES (?,?,?,?,?,?,?,?)')
    .run(entity, entityId, action, outletId, userId, json(before), json(after), note);
}

export function auditFor(entity, entityId) {
  return db.prepare(`SELECT a.id, a.action, a.note, a.before, a.after, a.created_at, u.name AS user_name, u.role AS user_role
                     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id`)
    .all(entity, entityId).map((r) => ({ ...r, before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null }));
}
