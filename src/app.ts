import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './lib/logger.js';
import { rateLimitGeneral } from './middleware/rate-limit.js';
import { errorHandler, notFound } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { readingRouter } from './modules/reading/reading.routes.js';
import { subscriptionsRouter, stripeWebhookRouter } from './modules/subscriptions/subscriptions.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { assetsRouter } from './modules/assets/assets.routes.js';

export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(pinoHttp({ logger, customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info') }));

  // Stripe webhook MUST receive the raw body for signature verification.
  // Mount it BEFORE the JSON body parser.
  app.use('/v1/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhookRouter);

  // JSON body parsing for the rest of the API.
  app.use(express.json({ limit: '100kb' }));
  app.use(rateLimitGeneral);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', (_req, res) => res.json({ ok: true }));

  app.use('/v1/auth', authRouter);
  app.use('/v1/users', usersRouter);
  app.use('/v1/catalog', catalogRouter);
  app.use('/v1/reading', readingRouter);
  app.use('/v1/subscriptions', subscriptionsRouter);
  app.use('/v1/assets', assetsRouter);
  app.use('/v1/admin', adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
