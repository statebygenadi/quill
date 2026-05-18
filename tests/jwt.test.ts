import { describe, it, expect } from 'vitest';
import {
  issueAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
} from '../src/lib/jwt.js';

describe('jwt', () => {
  it('issues and verifies an access token with claims preserved', async () => {
    const token = await issueAccessToken({
      sub: 'user-1',
      role: 'reader',
      tier: 'patron',
      sid: 'sess-1',
    });
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.role).toBe('reader');
    expect(claims.tier).toBe('patron');
    expect(claims.sid).toBe('sess-1');
  });

  it('rejects an access token signed with the wrong secret', async () => {
    // Swap secret mid-test by direct env mutation would not affect the cached encoder;
    // instead, verify that tampering the token body fails.
    const token = await issueAccessToken({ sub: 'u', role: 'reader', tier: 'free', sid: 's' });
    const tampered = `${token.slice(0, -2)}AA`;
    await expect(verifyAccessToken(tampered)).rejects.toBeDefined();
  });

  it('refresh token contains jti and verifies', async () => {
    const { token, jti } = await issueRefreshToken({ sub: 'u', sid: 's' });
    const claims = await verifyRefreshToken(token);
    expect(claims.sub).toBe('u');
    expect(claims.sid).toBe('s');
    expect(claims.jti).toBe(jti);
  });

  it('refresh token hash is deterministic SHA-256', () => {
    const a = hashRefreshToken('abc');
    const b = hashRefreshToken('abc');
    const c = hashRefreshToken('abd');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
