import type { AccessClaims } from '../lib/jwt.js';

export type AccessTier = 'free' | 'reader' | 'patron';

const RANK: Record<AccessTier, number> = { free: 0, reader: 1, patron: 2 };

export function tierMeets(userTier: AccessTier, required: AccessTier): boolean {
  return RANK[userTier] >= RANK[required];
}

export function isEntitled(user: AccessClaims | undefined, required: AccessTier): boolean {
  if (required === 'free') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  return tierMeets(user.tier, required);
}
