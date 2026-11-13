import crypto from 'node:crypto';
import db from './db.js';
import { verifyPassword } from './passwords.js';

export function publicUser(u) {
  const c = u.customer_id ? db.prepare('SELECT name, code, outlet_id FROM customers WHERE id = ?').get(u.customer_id) : null;
  const outletId = c ? c.outlet_id : u.outlet_id;
  const o = outletId ? db.prepare('SELECT id, code, name FROM outlets WHERE id = ?').get(outletId) : null;
  // staff with no outlet = head office (sees both outlets)
  return { id: u.id, email: u.email, name: u.name, role: u.role, customer_id: u.customer_id, customer_name: c?.name,
    outlet_id: o?.id || null, outlet_code: o?.code || null, outlet_name: o?.name || null, head_office: u.role !== 'customer' && !u.outlet_id };
}

export function login(email, password) {
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').toLowerCase().trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, u.id);
  return { token, user: publicUser(u) };
}

export function logout(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Express middleware: reads "Authorization: Bearer <token>"
export function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const user = token && db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1'
  ).get(token);
  if (!user) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  req.token = token;
  next();
}

export const requireRole = (role) => (req, res, next) =>
  req.user.role === role ? next() : res.status(403).json({ error: 'You do not have access to this area' });
