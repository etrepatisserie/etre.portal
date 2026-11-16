import crypto from 'node:crypto';
import db from './db.js';
import { verifyPassword } from './passwords.js';

export async function publicUser(u) {
  const c = u.customer_id ? await db.prepare('SELECT name, code, outlet_id FROM customers WHERE id = ?').get(u.customer_id) : null;
  const outletId = c ? c.outlet_id : u.outlet_id;
  const o = outletId ? await db.prepare('SELECT id, code, name FROM outlets WHERE id = ?').get(outletId) : null;
  // staff with no outlet = head office (sees both outlets)
  return { id: u.id, email: u.email, name: u.name, role: u.role, customer_id: u.customer_id, customer_name: c?.name,
    outlet_id: o?.id || null, outlet_code: o?.code || null, outlet_name: o?.name || null, head_office: u.role !== 'customer' && !u.outlet_id };
}

export async function login(email, password) {
  const u = await db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').toLowerCase().trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare("INSERT INTO sessions (token, user_id, last_seen) VALUES (?, ?, NOW())").run(token, u.id);
  await db.prepare("DELETE FROM sessions WHERE user_id = ? AND TIMESTAMPDIFF(SECOND, created_at, NOW()) / 86400 > ?").run(u.id, SESSION_MAX_DAYS); // tidy old ones
  return { token, user: await publicUser(u) };
}

export async function logout(token) {
  await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Sessions end 30 days after sign-in, or after 7 days without use
export const SESSION_MAX_DAYS = 30;
export const SESSION_IDLE_DAYS = 7;

// Express middleware: reads "Authorization: Bearer <token>"
export async function authenticate(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const row = token && await db.prepare(`SELECT u.*, s.created_at AS session_created, COALESCE(s.last_seen, s.created_at) AS session_seen,
      TIMESTAMPDIFF(SECOND, s.created_at, NOW()) / 86400 AS age_days, TIMESTAMPDIFF(SECOND, COALESCE(s.last_seen, s.created_at), NOW()) / 86400 AS idle_days
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1`).get(token);
  if (!row) return res.status(401).json({ error: 'Please sign in' });
  if (row.age_days > SESSION_MAX_DAYS || row.idle_days > SESSION_IDLE_DAYS) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Your session has expired — please sign in again' });
  }
  if (row.idle_days > 5 / 1440) await db.prepare("UPDATE sessions SET last_seen = NOW() WHERE token = ?").run(token); // at most every 5 minutes
  const { session_created, session_seen, age_days, idle_days, ...user } = row; // eslint-disable-line no-unused-vars
  req.user = user;
  req.token = token;
  next();
}

// Failed sign-ins: 5 per email or 20 per network address within 15 minutes → wait before trying again
const WINDOW_MS = 15 * 60e3;
const failures = new Map(); // key → [timestamps]
const recent = (key, now) => (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
export function loginBlockedFor(email, ip, now = Date.now()) {
  const e = recent(`e:${String(email || '').toLowerCase().trim()}`, now), i = recent(`i:${ip}`, now);
  if (e.length >= 5 || i.length >= 20) {
    const oldest = Math.min(...(e.length >= 5 ? e : i));
    return Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 60e3));
  }
  return 0;
}
export function recordLoginFailure(email, ip, now = Date.now()) {
  for (const key of [`e:${String(email || '').toLowerCase().trim()}`, `i:${ip}`]) failures.set(key, [...recent(key, now), now]);
}
export function clearLoginFailures(email) { failures.delete(`e:${String(email || '').toLowerCase().trim()}`); }

export const requireRole = (role) => (req, res, next) =>
  req.user.role === role ? next() : res.status(403).json({ error: 'You do not have access to this area' });
