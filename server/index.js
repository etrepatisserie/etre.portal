import { config } from './config.js';
import { seedIfEmpty } from './seed.js';
import { createApp, clientBuildFound } from './app.js';

await seedIfEmpty();
createApp().listen(config.port, () => {
  console.log(`ERP API running in ${config.nodeEnv} mode on http://localhost:${config.port}`);
  if (clientBuildFound()) console.log(`Serving the portal from ${config.clientBuildDir}`);
  else console.log('No client build found — use the Vite dev server (npm run client:dev) or run npm run build:prod');
});
