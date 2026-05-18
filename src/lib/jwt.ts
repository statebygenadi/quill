import { SignJWT, jwtVerify } from 'jose';
import { randomUUID, createHash } from 'node:crypto';
import { env } from '../config/env.js';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export type Role = 'reader' | 'author' | 'admin';

export interface AccessClaims {
  sub: string;
  role: Role;
  tier: 'free' | 'reader' | 'patron';
  sid: string; // session id linking refresh token family
}

export interface RefreshClaims {
  sub: string;
  sid: string;
  jti: string;
}

export async function issueAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .setIssuer('quill')
    .setAudience('quill-api')
    .setSubject(claims.sub)
    .sign(accessSecret);
}

export async function issueRefreshToken(claims: Omit<RefreshClaims, 'jti'>): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = await new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${env.REFRESH_TOKEN_TTL_SECONDS}s`)
    .setIssuer('quill')
    .setAudience('quill-refresh')
    .setSubject(claims.sub)
    .setJti(jti)
    .sign(refreshSecret);
  return { token, jti };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, accessSecret, { issuer: 'quill', audience: 'quill-api' });
  return payload as unknown as AccessClaims;
}

export async function verifyRefreshToken(token: string): Promise<RefreshClaims> {
  const { payload } = await jwtVerify(token, refreshSecret, { issuer: 'quill', audience: 'quill-refresh' });
  return {
    sub: payload.sub as string,
    sid: (payload as { sid: string }).sid,
    jti: payload.jti as string,
  };
}

/** Refresh tokens are persisted as SHA-256 hashes only. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
