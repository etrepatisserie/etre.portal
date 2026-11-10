import db from './db.js';

const insert = db.prepare('INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (?,?,?,?,?, COALESCE(?, datetime(\'now\')))');

export function notifyUser(userId, type, title, message, link, at = null) {
  insert.run(userId, type, title, message, link, at);
}

export function notifyAdmins(type, title, message, link, at = null) {
  for (const { id } of db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all()) {
    notifyUser(id, type, title, message, link, at);
  }
}

export function notifyCustomer(customerId, type, title, message, link, at = null) {
  for (const { id } of db.prepare("SELECT id FROM users WHERE customer_id = ? AND active = 1").all(customerId)) {
    notifyUser(id, type, title, message, link, at);
  }
}
