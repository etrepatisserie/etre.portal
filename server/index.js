import express from 'express';
import cors from 'cors';
import db from './db.js';
import { seedIfEmpty } from './seed.js';
import { authenticate, requireRole, login, logout, publicUser } from './auth.js';
import purchasing from './routes/purchasing.js';
import admin from './routes/admin.js';
import customer from './routes/customer.js';

seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Auth (public) ----------
app.post('/api/auth/login', (req, res) => {
  const result = login(req.body.email, req.body.password);
  if (!result) return res.status(401).json({ error: 'Incorrect email or password' });
  res.json(result);
});

// everything below requires a signed-in user
app.use('/api', authenticate);

app.get('/api/auth/me', (req, res) => res.json(publicUser(req.user)));
app.post('/api/auth/logout', (req, res) => { logout(req.token); res.json({ ok: true }); });

// ---------- Notifications (both portals) ----------
app.get('/api/notifications', (req, res) => {
  const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
  res.json({ unread, items });
});
app.post('/api/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});
app.post('/api/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- Portals ----------
app.use('/api/admin', requireRole('admin'), purchasing, admin);
app.use('/api/customer', requireRole('customer'), customer);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Errors thrown in routes (HttpError or unexpected) become JSON responses
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ERP API running on http://localhost:${PORT}`));
