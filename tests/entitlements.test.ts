import { describe, it, expect } from 'vitest';
import { isEntitled, tierMeets } from '../src/lib/entitlements.js';

describe('entitlements', () => {
  it('tier ordering: free < reader < patron', () => {
    expect(tierMeets('free', 'free')).toBe(true);
    expect(tierMeets('free', 'reader')).toBe(false);
    expect(tierMeets('reader', 'free')).toBe(true);
    expect(tierMeets('reader', 'reader')).toBe(true);
    expect(tierMeets('reader', 'patron')).toBe(false);
    expect(tierMeets('patron', 'patron')).toBe(true);
  });

  it('anonymous can read free content only', () => {
    expect(isEntitled(undefined, 'free')).toBe(true);
    expect(isEntitled(undefined, 'reader')).toBe(false);
    expect(isEntitled(undefined, 'patron')).toBe(false);
  });

  it('admin bypasses tier checks', () => {
    const admin = { sub: 'a', role: 'admin' as const, tier: 'free' as const, sid: 's' };
    expect(isEntitled(admin, 'patron')).toBe(true);
  });

  it('reader entitlement does not unlock patron content', () => {
    const reader = { sub: 'r', role: 'reader' as const, tier: 'reader' as const, sid: 's' };
    expect(isEntitled(reader, 'reader')).toBe(true);
    expect(isEntitled(reader, 'patron')).toBe(false);
  });
});
