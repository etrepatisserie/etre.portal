// Central configuration, read from .env (see .env.example)
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  dbFile: process.env.DB_FILE || path.join(here, 'erp.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(here, 'uploads'),
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
  emailFrom: process.env.EMAIL_FROM || 'Être Patisserie <orders@example.com>',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  quiet: process.env.QUIET === '1',
};
