// ecocontext — entry point
// Starts the web server and initializes the knowledge store

import { createServer } from './server.js';
import { getDb } from './store/knowledge.js';
import { queueBackfillEmbeddings } from './engine/embedder.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Initialize database on startup
getDb();
queueBackfillEmbeddings();

const app = createServer();

app.listen(PORT, () => {
  console.log(`\n  EcoContext running at http://localhost:${PORT}\n`);
});
