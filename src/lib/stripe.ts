/**
 * Mocked payment provider. Mirrors Stripe's surface area for the slice we use
 * (checkout sessions, subscription objects, signed webhooks) so the swap to the
 * real SDK is mechanical. The signature scheme is Stripe-compatible:
 *   t=<unix>,v1=<hex(hmac_sha256(secret, `${t}.${rawBody}`))>
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export type Tier = 'reader' | 'patron';

export interface CheckoutSession {
  id: string;
  url: string;
  customer_email: string;
  client_reference_id: string; // our user id
  price_id: string;
}

export interface ProviderSubscription {
  id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
  current_period_end: number; // unix seconds
  cancel_at_period_end: boolean;
  price_id: string;
}

export interface WebhookEvent {
  id: string;
  type:
    | 'checkout.session.completed'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted'
    | 'invoice.payment_failed';
  data: { object: ProviderSubscription & { client_reference_id?: string; customer_email?: string } };
}

export function priceIdFor(tier: Tier): string {
  return tier === 'reader' ? env.STRIPE_PRICE_READER : env.STRIPE_PRICE_PATRON;
}

export function tierForPriceId(priceId: string): Tier | null {
  if (priceId === env.STRIPE_PRICE_READER) return 'reader';
  if (priceId === env.STRIPE_PRICE_PATRON) return 'patron';
  return null;
}

export async function createCheckoutSession(input: {
  userId: string;
  email: string;
  tier: Tier;
}): Promise<CheckoutSession> {
  // In real Stripe: const session = await stripe.checkout.sessions.create(...)
  return {
    id: `cs_test_${randomUUID()}`,
    url: `https://checkout.example/${randomUUID()}`,
    customer_email: input.email,
    client_reference_id: input.userId,
    price_id: priceIdFor(input.tier),
  };
}

export function signWebhookPayload(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

export function verifyWebhookSignature(rawBody: string, header: string, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
