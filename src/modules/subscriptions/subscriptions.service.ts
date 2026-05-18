import { pool, withTx } from '../../config/db.js';
import { createCheckoutSession, tierForPriceId, type Tier } from '../../lib/stripe.js';
import { errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export interface SubscriptionRow {
  id: string;
  user_id: string;
  tier: Tier;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
  provider: string;
  provider_subscription_id: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

export async function getActiveSubscription(userId: string): Promise<SubscriptionRow | null> {
  const { rows } = await pool.query<SubscriptionRow>(
    `SELECT id, user_id, tier, status, provider, provider_subscription_id,
            current_period_end, cancel_at_period_end
     FROM subscriptions
     WHERE user_id = $1 AND status IN ('trialing', 'active', 'past_due')
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function createCheckout(userId: string, email: string, tier: Tier): Promise<{ url: string; id: string }> {
  const existing = await getActiveSubscription(userId);
  if (existing && existing.status !== 'past_due') {
    throw errors.conflict('user already has an active subscription');
  }
  const session = await createCheckoutSession({ userId, email, tier });
  logger.info({ userId, tier, sessionId: session.id }, 'checkout session created');
  return { url: session.url, id: session.id };
}

interface WebhookEnvelope {
  id: string;
  type: string;
  data: {
    object: {
      id?: string;
      client_reference_id?: string;
      customer_email?: string;
      status?: SubscriptionRow['status'];
      current_period_end?: number;
      cancel_at_period_end?: boolean;
      price_id?: string;
      subscription?: string; // for checkout.session.completed
    };
  };
}

/**
 * Idempotent webhook handler.
 *  - First INSERT INTO payment_events with the provider event id. If conflict,
 *    we've already processed (or are processing) this event — return.
 *  - Then mutate subscriptions in the same transaction; mark processed.
 */
export async function handleWebhookEvent(evt: WebhookEnvelope): Promise<{ duplicate: boolean }> {
  return withTx(async (client) => {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO payment_events (provider, provider_event_id, type, payload)
       VALUES ('stripe', $1, $2, $3)
       ON CONFLICT (provider_event_id) DO NOTHING
       RETURNING id`,
      [evt.id, evt.type, evt],
    );
    if (ins.rows.length === 0) {
      return { duplicate: true };
    }

    const obj = evt.data.object;
    try {
      switch (evt.type) {
        case 'checkout.session.completed': {
          const userId = obj.client_reference_id;
          const priceId = obj.price_id;
          const subId = obj.subscription ?? obj.id;
          if (!userId || !priceId || !subId) throw new Error('missing fields on checkout.session.completed');
          const tier = tierForPriceId(priceId);
          if (!tier) throw new Error(`unknown price_id ${priceId}`);
          await client.query(
            `INSERT INTO subscriptions
              (user_id, tier, status, provider, provider_subscription_id,
               current_period_end, cancel_at_period_end)
             VALUES ($1, $2, 'active', 'stripe', $3, to_timestamp($4), false)
             ON CONFLICT (provider_subscription_id) DO UPDATE
               SET status = EXCLUDED.status,
                   tier = EXCLUDED.tier,
                   current_period_end = EXCLUDED.current_period_end,
                   updated_at = now()`,
            [userId, tier, subId, obj.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 86_400],
          );
          break;
        }
        case 'customer.subscription.updated': {
          if (!obj.id || !obj.status) throw new Error('missing fields on subscription.updated');
          await client.query(
            `UPDATE subscriptions
               SET status = $2,
                   current_period_end = to_timestamp($3),
                   cancel_at_period_end = $4,
                   updated_at = now()
             WHERE provider_subscription_id = $1`,
            [obj.id, obj.status, obj.current_period_end ?? null, obj.cancel_at_period_end ?? false],
          );
          break;
        }
        case 'customer.subscription.deleted': {
          if (!obj.id) throw new Error('missing id on subscription.deleted');
          await client.query(
            `UPDATE subscriptions SET status = 'canceled', updated_at = now()
             WHERE provider_subscription_id = $1`,
            [obj.id],
          );
          break;
        }
        case 'invoice.payment_failed': {
          if (!obj.id) break;
          await client.query(
            `UPDATE subscriptions SET status = 'past_due', updated_at = now()
             WHERE provider_subscription_id = $1`,
            [obj.id],
          );
          break;
        }
        default:
          logger.warn({ type: evt.type }, 'unhandled webhook type');
      }

      await client.query(`UPDATE payment_events SET processed_at = now() WHERE provider_event_id = $1`, [evt.id]);
      return { duplicate: false };
    } catch (err) {
      await client.query(
        `UPDATE payment_events SET processing_error = $2 WHERE provider_event_id = $1`,
        [evt.id, err instanceof Error ? err.message : String(err)],
      );
      throw err;
    }
  });
}

export async function cancelAtPeriodEnd(userId: string): Promise<SubscriptionRow> {
  const sub = await getActiveSubscription(userId);
  if (!sub) throw errors.notFound('no active subscription');
  // In real Stripe: stripe.subscriptions.update(sub.provider_subscription_id, { cancel_at_period_end: true })
  const { rows } = await pool.query<SubscriptionRow>(
    `UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [sub.id],
  );
  return rows[0]!;
}
