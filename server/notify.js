import db from './db.js';

const insert = db.prepare("INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (?,?,?,?,?, COALESCE(?, NOW()))");

export async function notifyUser(userId, type, title, message, link, at = null) {
  await insert.run(userId, type, title, message, link, at);
}

// role: 'admin' | 'finance' | 'kitchen'. Goes to staff of that outlet + head office (outlet_id NULL).
// outletId null → every user with the role.
// NOTE: messages to 'kitchen' must never include prices, totals or payment details.
export async function notifyRole(role, outletId, type, title, message, link, at = null) {
  const users = outletId
    ? await db.prepare('SELECT id FROM users WHERE role = ? AND active = 1 AND (outlet_id = ? OR outlet_id IS NULL)').all(role, outletId)
    : await db.prepare('SELECT id FROM users WHERE role = ? AND active = 1').all(role);
  for (const { id } of users) await notifyUser(id, type, title, message, link, at);
}

export const notifyAdmins = async (outletId, ...args) => await notifyRole('admin', outletId, ...args);

export async function notifyCustomer(customerId, type, title, message, link, at = null) {
  for (const { id } of await db.prepare('SELECT id FROM users WHERE customer_id = ? AND active = 1').all(customerId)) {
    await notifyUser(id, type, title, message, link, at);
  }
}
