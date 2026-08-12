import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env, isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRouter } from './routes.js';
import { requestContext } from './lib/request-context.js';

export function createApp() {
  const app = express();

  // One trusted hop (the local nginx proxy) so req.ip is the real client
  // address from X-Forwarded-For, not 127.0.0.1.
  app.set('trust proxy', 1);

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

  // Files are stored in object storage (R2 / local) and streamed through the
  // authenticated download endpoints — no public static directory.

  app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));

  app.use(requestContext);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
