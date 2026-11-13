import { seedIfEmpty } from './seed.js';
import { createApp } from './app.js';

await seedIfEmpty();
const PORT = process.env.PORT || 3001;
createApp().listen(PORT, () => console.log(`ERP API running on http://localhost:${PORT}`));
