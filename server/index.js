import { config } from './config.js';
import db from './db.js';
import { ensureOutlets } from './outlets.js';
import { createApp, clientBuildFound } from './app.js';

const { version } = await db.check();
console.log(`MySQL ${version} — database ${config.db.database} on ${config.db.host}:${config.db.port}`);
await ensureOutlets();
createApp().listen(config.port, () => {
  console.log(`ERP API running in ${config.nodeEnv} mode on http://localhost:${config.port}`);
  if (clientBuildFound()) console.log(`Serving the portal from ${config.clientBuildDir}`);
  else console.log('No client build found — use the Vite dev server (npm run client:dev) or run npm run build:prod');
});
