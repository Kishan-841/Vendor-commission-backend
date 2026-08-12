import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRouter } from './routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  // In dev, reflect any localhost origin so the frontend port (3000/3002/…)
  // doesn't need to be hard-coded. In prod, use the explicit allowlist.
  const allowlist = env.CORS_ORIGIN.split(',').map((s) => s.trim());
  app.use(
    cors({
      origin: isProd
        ? allowlist
        : (origin, cb) => {
            if (!origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) || allowlist.includes(origin)) {
              cb(null, true);
            } else {
              cb(new Error('Not allowed by CORS'));
            }
          },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (!isProd) app.use(morgan('dev'));

  // Serve generated bill PDFs (static) — download links point here.
  app.use('/files/generated', express.static(env.GENERATED_DIR));

  app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
