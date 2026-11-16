import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
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

export const clientBuildFound = () => fs.existsSync(path.join(config.clientBuildDir, 'index.html'));

// The page is same-origin when its Origin host is the host the request was sent to
// (the API serves the built client itself, so the portal always calls back to the address it was loaded from).
function isSameOrigin(req, origin) {
  try {
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    return new URL(origin).host === host;
  } catch { return false; }
}
// Outside production any local Vite port is fine (Vite moves to 5174, 5175… when 5173 is taken)
function isLocalDevOrigin(origin) {
  if (config.nodeEnv === 'production') return false;
  try { return ['localhost', '127.0.0.1'].includes(new URL(origin).hostname); } catch { return false; }
}

export function createApp() {
  const app = express();
  // Only the portal itself may call the API from a browser: the page served by this API, APP_URL,
  // plus any extra in CORS_ORIGINS (comma separated). Requests without an Origin header are unaffected.
  const allowed = new Set([config.appUrl, ...String(process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)].map((u) => u.replace(/\/+$/, '')));
  app.use(cors((req, cb) => {
    const origin = req.get('origin');
    cb(null, { origin: !origin || allowed.has(origin) || isSameOrigin(req, origin) || isLocalDevOrigin(origin) });
  }));
  app.use(express.json({ limit: '1mb' }));

  // ---------- public ----------
  app.post('/api/auth/login', async (req, res) => {
    const wait = loginBlockedFor(req.body?.email, req.ip);
    if (wait) return res.status(429).json({ error: `Too many sign-in attempts. Please wait ${wait} minute${wait === 1 ? '' : 's'} and try again.` });
    const result = await login(req.body?.email, req.body?.password);
    if (!result) { recordLoginFailure(req.body?.email, req.ip); return res.status(401).json({ error: 'Incorrect email or password' }); }
    clearLoginFailures(req.body?.email);
    res.json(result);
  });
  // Product photos are not sensitive and must load in <img> tags without a token
  app.get('/api/public/product-images/:id', async (req, res) => {
    const f = await getFile(req.params.id);
    if (!f || f.kind !== 'product_image') throw new HttpError(404, 'Not found');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    sendFile(res, f);
  });

  // ---------- everything below requires a signed-in user ----------
  app.use('/api', authenticate);
  // which outlet this request is limited to (see outlets.js → scopeOf)
  app.use('/api', async (req, res, next) => { req.outletId = await scopeOf(req); next(); });
  app.get('/api/outlets', async (req, res) => res.json((await listOutlets()).map((o) => ({ id: o.id, code: o.code, name: o.name }))));
  app.get('/api/auth/me', async (req, res) => res.json(await publicUser(req.user)));
  app.post('/api/auth/logout', async (req, res) => { await logout(req.token); res.json({ ok: true }); });

  app.get('/api/notifications', async (req, res) => {
    const items = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').all(req.user.id);
    const unread = (await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id)).n;
    res.json({ unread, items });
  });
  app.post('/api/notifications/read-all', async (req, res) => {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/notifications/:id/read', async (req, res) => {
    await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  // Uploaded files (slips, invoices, DOs, discrepancy photos) — owner / finance / admin only
  app.get('/api/files/:id', async (req, res) => {
    const f = await getFile(req.params.id);
    if (!f) throw new HttpError(404, 'File not found');
    if (!canAccess(req.user, f)) throw new HttpError(403, 'You do not have access to this file');
    // outlet staff only see files of their own outlet's customers
    if (req.user.role !== 'customer' && req.user.outlet_id && f.customer_id) {
      const c = await db.prepare('SELECT outlet_id FROM customers WHERE id = ?').get(f.customer_id);
      if (c && c.outlet_id !== req.user.outlet_id) throw new HttpError(403, 'You do not have access to this file');
    }
    sendFile(res, f, req.query.download === '1');
  });

  // Invoice / DO documents (PDF generated on first request when not uploaded)
  app.get('/api/documents/invoices/:id/:type', async (req, res) => {
    if (!['invoice', 'do'].includes(req.params.type)) throw new HttpError(404, 'Not found');
    if (!['customer', 'finance', 'admin'].includes(req.user.role)) throw new HttpError(403, 'You do not have access to invoices');
    const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv || (req.user.role === 'customer' && inv.customer_id !== req.user.customer_id)) throw new HttpError(404, 'Invoice not found');
    if (req.user.role !== 'customer' && req.user.outlet_id && inv.outlet_id !== req.user.outlet_id) throw new HttpError(404, 'Invoice not found');
    const f = await ensureDocument(inv, req.params.type);
    sendFile(res, f, req.query.download === '1');
  });

  // Credit note PDF (issued only): the customer it belongs to, Finance, Admin
  app.get('/api/documents/credit-notes/:id', async (req, res) => {
    if (!['customer', 'finance', 'admin'].includes(req.user.role)) throw new HttpError(403, 'You do not have access to credit notes');
    const cn = await getCreditNote(Number(req.params.id));
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

  // ---------- the portal itself (React build in client/build) ----------
  // Static files first; every other path gets index.html so the browser router can take over.
  app.use(express.static(config.clientBuildDir, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (req, res) => {
    if (!clientBuildFound()) return res.status(503).type('text').send('Client build not found. Run `npm run build:prod`, or open the Vite dev server (npm run client:dev).');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.clientBuildDir, 'index.html'));
  });

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
