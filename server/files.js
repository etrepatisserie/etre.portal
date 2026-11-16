// File uploads (slips, invoices, DOs, product images, discrepancy photos).
// Stored in UPLOAD_DIR under random names; served only through access-checked routes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import db from './db.js';
import { config } from './config.js';
import { HttpError } from './errors.js';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};
const EXT_FOR = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

const ensureDir = () => fs.mkdirSync(config.uploadDir, { recursive: true });
const randomName = (mime) => crypto.randomBytes(16).toString('hex') + EXT_FOR[mime];

export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { ensureDir(); cb(null, config.uploadDir); },
    filename: (req, file, cb) => cb(null, randomName(file.mimetype)),
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 3 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (TYPES[file.mimetype]?.includes(ext)) cb(null, true);
    else cb(new HttpError(400, 'Only JPG, PNG, WEBP images or PDF files are allowed'));
  },
});

// Check the file really is what its type claims (magic bytes), not just its name
function sniff(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const b = Buffer.alloc(12);
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  if (b.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  if (b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

// Register an uploaded multer file in the `files` table and return its id
export async function registerUpload(file, { kind, customerId = null, userId = null, imagesOnly = false }) {
  if (!file) throw new HttpError(400, 'Please attach a file');
  const real = sniff(file.path);
  if (!real || real !== file.mimetype || (imagesOnly && real === 'application/pdf')) {
    fs.rmSync(file.path, { force: true });
    throw new HttpError(400, imagesOnly ? 'Please upload a JPG, PNG or WEBP image' : 'The file content does not match an image or PDF');
  }
  return (await db.prepare('INSERT INTO files (kind, customer_id, original_name, stored_name, mime, size, uploaded_by) VALUES (?,?,?,?,?,?,?)')
    .run(kind, customerId, file.originalname.slice(0, 200), path.basename(file.path), file.mimetype, file.size, userId)).lastInsertRowid;
}

// Save a generated file (e.g. invoice PDF) and return its id
export async function saveBuffer(buffer, { kind, customerId = null, userId = null, name, mime = 'application/pdf' }) {
  ensureDir();
  const stored = randomName(mime);
  fs.writeFileSync(path.join(config.uploadDir, stored), buffer);
  return (await db.prepare('INSERT INTO files (kind, customer_id, original_name, stored_name, mime, size, uploaded_by) VALUES (?,?,?,?,?,?,?)')
    .run(kind, customerId, name, stored, mime, buffer.length, userId)).lastInsertRowid;
}

export const removeTempUploads = (req) => {
  for (const f of [req.file, ...Object.values(req.files || {}).flat()].filter(Boolean)) fs.rmSync(f.path, { force: true });
};

// Who may open which file
export function canAccess(user, file) {
  if (file.kind === 'product_image') return true;
  if (user.role === 'kitchen') return false;                      // never invoices, DOs, slips
  if (user.role === 'admin' || user.role === 'finance') return true;
  if (user.role === 'customer') return file.customer_id != null && file.customer_id === user.customer_id;
  return false;
}

export function sendFile(res, file, download = false) {
  const abs = path.join(config.uploadDir, path.basename(file.stored_name));
  if (!fs.existsSync(abs)) throw new HttpError(404, 'File is missing on the server');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${file.original_name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(abs);
}

export const getFile = async (id) => await db.prepare('SELECT * FROM files WHERE id = ?').get(id);
