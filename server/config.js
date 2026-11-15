// Central configuration, read from the environment file for the current NODE_ENV:
//   development → .env.dev · uat → .env.uat · production → .env.production  (then .env as a fallback)
// See .env.example for every setting.
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const NODE_ENV = process.env.NODE_ENV || 'development';
const ENV_FILES = { development: '.env.dev', uat: '.env.uat', production: '.env.production' };
for (const f of [ENV_FILES[NODE_ENV] || `.env.${NODE_ENV}`, '.env']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) dotenv.config({ path: p, quiet: true });
}

export const config = {
  nodeEnv: NODE_ENV,
  port: Number(process.env.PORT || 3001),
  dbFile: process.env.DB_FILE || path.join(here, 'erp.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(here, 'uploads'),
  // the built React client (client/build) is served by the API when it exists
  clientBuildDir: process.env.CLIENT_BUILD_PATH || path.join(root, 'client', 'build'),
  // MySQL (server/mysql.js, server/sql/*.sql)
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'etre_portal',
  },
  // 'log'  = development: emails are only saved to the Email Outbox and printed to the console
  // 'smtp' = really send through the SMTP server below
  emailMode: process.env.EMAIL_MODE || 'log',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  // each company can send through its own mailbox: SMTP_KL_USER / SMTP_KL_PASS, SMTP_IPH_USER / SMTP_IPH_PASS
  // (falls back to SMTP_USER / SMTP_PASS)
  smtpLogin: (code) => ({ user: process.env[`SMTP_${code}_USER`] || process.env.SMTP_USER || '', pass: process.env[`SMTP_${code}_PASS`] || process.env.SMTP_PASS || '' }),
  emailFrom: process.env.EMAIL_FROM || 'Être Patisserie <orders@example.com>',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  quiet: process.env.QUIET === '1',
};
