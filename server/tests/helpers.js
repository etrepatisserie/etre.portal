// Test harness: fresh temp database + upload folder per test file, real HTTP server on a random port.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function isolatedEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));
  process.env.DB_FILE = path.join(dir, 'test.db');
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.EMAIL_MODE = 'log';
  process.env.QUIET = '1';
  process.env.SEED_DEMO = '1'; // tests use the demo customers and their history
  return dir;
}

export async function startServer() {
  const { seedIfEmpty } = await import('../seed.js');
  const { createApp } = await import('../app.js');
  await seedIfEmpty();
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, url, { token, body, form, headers: extra } = {}) {
    const headers = { ...(extra || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: data, type };
  }
  const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).body.token;
  return { server, call, login, close: () => new Promise((r) => server.close(r)) };
}

// Recursively list every key and every string value in a JSON response
export function walk(obj, out = { keys: [], strings: [] }) {
  if (Array.isArray(obj)) obj.forEach((x) => walk(x, out));
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { out.keys.push(k); walk(v, out); }
  else if (typeof obj === 'string') out.strings.push(obj);
  return out;
}

export const pdfBlob = (text = 'test') => new Blob([`%PDF-1.4\n% ${text}\n%%EOF\n`], { type: 'application/pdf' });
