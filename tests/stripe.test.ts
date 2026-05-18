import { describe, it, expect } from 'vitest';
import { signWebhookPayload, verifyWebhookSignature, tierForPriceId, priceIdFor } from '../src/lib/stripe.js';

describe('stripe webhook signing', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });

  it('round-trips a valid signature', () => {
    const sig = signWebhookPayload(body);
    expect(verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = signWebhookPayload(body);
    expect(verifyWebhookSignature(body + 'x', sig)).toBe(false);
  });

  it('rejects an old timestamp outside tolerance', () => {
    const oldT = Math.floor(Date.now() / 1000) - 10_000;
    const sig = signWebhookPayload(body, oldT);
    expect(verifyWebhookSignature(body, sig, 300)).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(verifyWebhookSignature(body, 'garbage')).toBe(false);
  });
});

describe('price <-> tier mapping', () => {
  it('round-trips configured price ids', () => {
    expect(tierForPriceId(priceIdFor('reader'))).toBe('reader');
    expect(tierForPriceId(priceIdFor('patron'))).toBe('patron');
  });

  it('returns null for unknown price ids', () => {
    expect(tierForPriceId('price_unknown')).toBeNull();
  });
});
