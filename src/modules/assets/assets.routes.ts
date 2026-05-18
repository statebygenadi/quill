import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ah } from '../../lib/async.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { signAssetUrl } from '../../lib/assets.js';

export const assetsRouter = Router();

const uploadIntent = z.object({
  kind: z.enum(['chapter', 'cover']),
  content_type: z.enum(['text/markdown', 'text/html', 'image/png', 'image/jpeg', 'image/webp']),
  byte_size: z.number().int().positive().max(50 * 1024 * 1024),
});

/**
 * Issue an upload intent: returns a stable asset_key plus a (mocked) signed PUT URL.
 * Authors use this before creating a chapter — the asset_key is what gets persisted.
 */
assetsRouter.post(
  '/upload-intent',
  requireAuth,
  requireRole('author', 'admin'),
  validate(uploadIntent),
  ah(async (req, res) => {
    const b = req.body as z.infer<typeof uploadIntent>;
    const ext =
      b.content_type === 'text/markdown'
        ? 'md'
        : b.content_type === 'text/html'
          ? 'html'
          : b.content_type.split('/')[1];
    const key = `${b.kind}/${req.user!.sub}/${randomUUID()}.${ext}`;
    // In real S3: presigned PUT URL with content-type/length constraints.
    const signed = signAssetUrl(key, { ttlSeconds: 900 });
    res.json({
      asset_key: key,
      upload_url: signed.url.replace('/sig=', '/method=PUT&sig=').replace(/^https?:\/\//, 'https://'),
      expires_at: signed.expiresAt,
      max_bytes: b.byte_size,
      required_content_type: b.content_type,
    });
  }),
);

const resignSchema = z.object({
  asset_key: z.string().min(1).max(512),
});

assetsRouter.post(
  '/resign',
  requireAuth,
  validate(resignSchema),
  ah(async (req, res) => {
    const b = req.body as z.infer<typeof resignSchema>;
    const signed = signAssetUrl(b.asset_key);
    res.json({ url: signed.url, expires_at: signed.expiresAt });
  }),
);
