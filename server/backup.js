// Database + uploads backup and restore.
//   npm run backup                      → backups/erp-YYYYMMDD-HHMMSS.db (+ uploads copy), keeps the newest 30
//   npm run restore -- <backup.db> --yes → STOP the server first; the current database is backed up, then replaced
// The backup uses SQLite's online backup, so it is safe while the server is running.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'backups');
const KEEP = 30;
const stamp = () => new Date(Date.now() + 8 * 3600e3).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // Malaysia time

export async function backup(label = '') {
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(config.dbFile)) throw new Error(`No database at ${config.dbFile}`);
  const name = `erp-${stamp()}${label ? `-${label}` : ''}`;
  const db = new Database(config.dbFile, { readonly: true, fileMustExist: true });
  await db.backup(path.join(dir, `${name}.db`));
  db.close();
  if (fs.existsSync(config.uploadDir)) fs.cpSync(config.uploadDir, path.join(dir, `${name}-uploads`), { recursive: true });
  // keep the newest KEEP backups
  const all = fs.readdirSync(dir).filter((f) => /^erp-\d{8}-\d{6}.*\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    fs.rmSync(path.join(dir, old), { force: true });
    fs.rmSync(path.join(dir, old.replace(/\.db$/, '-uploads')), { recursive: true, force: true });
  }
  return path.join(dir, `${name}.db`);
}

export async function restore(file) {
  if (!fs.existsSync(file)) throw new Error(`Backup not found: ${file}`);
  const check = new Database(file, { readonly: true, fileMustExist: true });
  const ok = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('sales_orders','invoices','customers')").get().n === 3;
  check.close();
  if (!ok) throw new Error('That file is not an ERP database backup');
  const safety = fs.existsSync(config.dbFile) ? await backup('before-restore') : null;
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(config.dbFile + ext, { force: true });
  fs.copyFileSync(file, config.dbFile);
  const uploads = file.replace(/\.db$/, '-uploads');
  if (fs.existsSync(uploads)) { fs.rmSync(config.uploadDir, { recursive: true, force: true }); fs.cpSync(uploads, config.uploadDir, { recursive: true }); }
  return safety;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, file, yes] = process.argv.slice(2);
  try {
    if (cmd === 'restore') {
      if (!file || yes !== '--yes') { console.log('Usage: npm run restore -- backups/erp-YYYYMMDD-HHMMSS.db --yes   (stop the server first)'); process.exit(1); }
      const safety = await restore(path.resolve(file));
      console.log(`Restored ${file}.${safety ? ` The previous database was saved as ${safety}.` : ''} Start the server again.`);
    } else {
      console.log(`Backup saved: ${await backup(cmd === 'label' ? file : '')}`);
    }
  } catch (e) { console.error(e.message); process.exit(1); }
}
