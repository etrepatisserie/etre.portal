import express from 'express';
import cors from 'cors';
import multer from 'multer';
import db from './db.js';
import { authenticate, requireRole, login, logout, publicUser, loginBlockedFor, recordLoginFailure, clearLoginFailures } from './auth.js';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { getFile, canAccess, sendFile } from './files.js';
import { ensureDocument } from './billing.js';
import { getCreditNote, ensureCreditNotePdf } from './complaints.js';
import { scopeOf, listOutlets } from './outlets.js';
import purchasing from './routes/purchasing.js';
import admin from './routes/admin.js';
import customer from './routes/customer.js';
import finance from './routes/finance.js';
import kitchen from './routes/kitchen.js';

export function createApp() {
  const app = express();
  // Only the portal itself may call the API from a browser (APP_URL, plus any extra in CORS_ORIGINS, comma separated).
  // Requests without an Origin header (same-origin pages, server-to-server, tests) are unaffected.
  const allowed = new Set([config.appUrl, ...String(process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)].map((u) => u.replace(/\/+$/, '')));
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.has(origin)) }));
  app.use(express.json({ limit: '1mb' }));

  // ---------- public ----------
  app.post('/api/auth/login', (req, res) => {
    const wait = loginBlockedFor(req.body?.email, req.ip);
    if (wait) return res.status(429).json({ error: `Too many sign-in attempts. Please wait ${wait} minute${wait === 1 ? '' : 's'} and try again.` });
    const result = login(req.body?.email, req.body?.password);
    if (!result) { recordLoginFailure(req.body?.email, req.ip); return res.status(401).json({ error: 'Incorrect email or password' }); }
    clearLoginFailures(req.body?.email);
    res.json(result);
  });
  // Test accounts for the sign-in page (local prototype only — switched off when NODE_ENV=production)
  app.get('/api/public/demo-accounts', (req, res) => {
    if (process.env.NODE_ENV === 'production') return res.json([]);
    res.json(db.prepare(`SELECT u.email, c.name, c.payment_term, c.is_demo, o.code AS outlet_code FROM users u
                         JOIN customers c ON c.id = u.customer_id JOIN outlets o ON o.id = c.outlet_id
                         WHERE u.role = 'customer' AND u.email LIKE '%@demo.test' ORDER BY c.is_demo, o.code DESC, c.name`).all());
  });
  // Product photos are not sensitive and must load in <img> tags without a token
  app.get('/api/public/product-images/:id', (req, res) => {
    const f = getFile(req.params.id);
    if (!f || f.kind !== 'product_image') throw new HttpError(404, 'Not found');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    sendFile(res, f);
  });

  // ---------- everything below requires a signed-in user ----------
  app.use('/api', authenticate);
  // which outlet this request is limited to (see outlets.js → scopeOf)
  app.use('/api', (req, res, next) => { req.outletId = scopeOf(req); next(); });
  app.get('/api/outlets', (req, res) => res.json(listOutlets().map((o) => ({ id: o.id, code: o.code, name: o.name }))));
  app.get('/api/auth/me', (req, res) => res.json(publicUser(req.user)));
  app.post('/api/auth/logout', (req, res) => { logout(req.token); res.json({ ok: true }); });

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

  // Uploaded files (slips, invoices, DOs, discrepancy photos) — owner / finance / admin only
  app.get('/api/files/:id', (req, res) => {
    const f = getFile(req.params.id);
    if (!f) throw new HttpError(404, 'File not found');
    if (!canAccess(req.user, f)) throw new HttpError(403, 'You do not have access to this file');
    // outlet staff only see files of their own outlet's customers
    if (req.user.role !== 'customer' && req.user.outlet_id && f.customer_id) {
      const c = db.prepare('SELECT outlet_id FROM customers WHERE id = ?').get(f.customer_id);
      if (c && c.outlet_id !== req.user.outlet_id) throw new HttpError(403, 'You do not have access to this file');
    }
    sendFile(res, f, req.query.download === '1');
  });

  // Invoice / DO documents (PDF generated on first request when not uploaded)
  app.get('/api/documents/invoices/:id/:type', async (req, res) => {
    if (!['invoice', 'do'].includes(req.params.type)) throw new HttpError(404, 'Not found');
    if (!['customer', 'finance', 'admin'].includes(req.user.role)) throw new HttpError(403, 'You do not have access to invoices');
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv || (req.user.role === 'customer' && inv.customer_id !== req.user.customer_id)) throw new HttpError(404, 'Invoice not found');
    if (req.user.role !== 'customer' && req.user.outlet_id && inv.outlet_id !== req.user.outlet_id) throw new HttpError(404, 'Invoice not found');
    const f = await ensureDocument(inv, req.params.type);
    sendFile(res, f, req.query.download === '1');
  });

  // Credit note PDF (issued only): the customer it belongs to, Finance, Admin
  app.get('/api/documents/credit-notes/:id', async (req, res) => {
    if (!['customer', 'finance', 'admin'].includes(req.user.role)) throw new HttpError(403, 'You do not have access to credit notes');
    const cn = getCreditNote(Number(req.params.id));
    if (!cn || cn.status !== 'Issued' || (req.user.role === 'customer' && cn.customer_id !== req.user.customer_id)) throw new HttpError(404, 'Credit note not found');
    if (req.user.role !== 'customer' && req.user.outlet_id && cn.outlet_id !== req.user.outlet_id) throw new HttpError(404, 'Credit note not found');
    sendFile(res, await ensureCreditNotePdf(cn), req.query.download === '1');
  });

  // ---------- portals ----------
  app.use('/api/admin', requireRole('admin'), purchasing, admin);
  app.use('/api/finance', requireRole('finance'), finance);
  app.use('/api/kitchen', requireRole('kitchen'), kitchen);
  app.use('/api/customer', requireRole('customer'), customer);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Errors become JSON: HttpError (expected), upload limits, or unexpected (logged, generic message)
  app.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB' : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong', ...(err.details || {}) });
  });
  return app;
}
