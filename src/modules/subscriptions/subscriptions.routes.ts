import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/async.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { verifyWebhookSignature } from '../../lib/stripe.js';
import { errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { pool } from '../../config/db.js';
import * as svc from './subscriptions.service.js';

export const subscriptionsRouter = Router();

const checkoutSchema = z.object({
  tier: z.enum(['reader', 'patron']),
});

subscriptionsRouter.post(
  '/checkout',
  requireAuth,
  validate(checkoutSchema),
  ah(async (req, res) => {
    const { tier } = req.body as z.infer<typeof checkoutSchema>;
    const { rows } = await pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [req.user!.sub]);
    const email = rows[0]?.email;
    if (!email) throw errors.notFound('user');
    const session = await svc.createCheckout(req.user!.sub, email, tier);
    res.json(session);
  }),
);

subscriptionsRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const sub = await svc.getActiveSubscription(req.user!.sub);
    res.json({ subscription: sub });
  }),
);

subscriptionsRouter.post(
  '/cancel',
  requireAuth,
  ah(async (req, res) => {
    const updated = await svc.cancelAtPeriodEnd(req.user!.sub);
    res.json(updated);
  }),
);

// IMPORTANT: webhook needs the raw body for signature verification.
// In app.ts we mount this route BEFORE express.json() with a raw body parser.
export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  '/stripe',
  ah(async (req, res) => {
    const sig = req.header('stripe-signature');
    if (!sig) throw errors.badRequest('missing stripe-signature');
    const raw = (req.body as Buffer).toString('utf8');
    if (!verifyWebhookSignature(raw, sig)) throw errors.unauthorized('invalid signature');
    let event: { id: string; type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse(raw);
    } catch {
      throw errors.badRequest('invalid json');
    }
    const result = await svc.handleWebhookEvent(event as never);
    if (result.duplicate) {
      logger.info({ id: event.id }, 'duplicate webhook ignored');
    }
    // Stripe expects 2xx fast or it will retry.
    res.json({ received: true, duplicate: result.duplicate });
  }),
);
