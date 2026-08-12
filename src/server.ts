import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🚀 VCMS API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Graceful shutdown so container restarts don't drop in-flight requests hard.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received, shutting down...`);
    server.close(() => process.exit(0));
  });
}
