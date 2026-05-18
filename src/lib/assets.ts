/**
 * Signed asset URLs. Production swap is a CloudFront signed URL or S3 presigned
 * GET; here we generate an HMAC-signed URL that an edge worker would verify.
 * The asset_key column on chapters references the immutable object key.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export function signAssetUrl(assetKey: string, opts?: { ttlSeconds?: number }): { url: string; expiresAt: number } {
  if (assetKey.includes('..') || assetKey.startsWith('/')) {
    throw new Error('invalid asset key');
  }
  const ttl = opts?.ttlSeconds ?? env.ASSET_SIGNED_URL_TTL_SECONDS;
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${env.ASSET_BUCKET}|${assetKey}|${expiresAt}`;
  const sig = createHmac('sha256', env.ASSET_SIGN_SECRET).update(payload).digest('hex');
  const url = `${env.ASSET_PUBLIC_BASE_URL}/${encodeURIComponent(assetKey)}?exp=${expiresAt}&sig=${sig}`;
  return { url, expiresAt };
}

export function verifySignedAssetUrl(assetKey: string, exp: number, sig: string): boolean {
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const payload = `${env.ASSET_BUCKET}|${assetKey}|${exp}`;
  const expected = createHmac('sha256', env.ASSET_SIGN_SECRET).update(payload).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
