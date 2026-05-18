import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/async.js';
import { validate } from '../../middleware/validate.js';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as svc from './catalog.service.js';

export const catalogRouter = Router();

// --- public/reader routes --------------------------------------------------

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
  tier: z.enum(['free', 'reader', 'patron']).optional(),
});

catalogRouter.get(
  '/series',
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const result = await svc.listPublishedSeries(q);
    res.json(result);
  }),
);

catalogRouter.get(
  '/series/:slug',
  ah<{ slug: string }>(async (req, res) => {
    const series = await svc.getSeriesBySlug(req.params.slug);
    if (!series || series.status !== 'published') {
      res.status(404).json({ error: { code: 'not_found', message: 'series' } });
      return;
    }
    const chapters = await svc.listChapters(series.id);
    res.json({ series, chapters });
  }),
);

catalogRouter.get(
  '/series/:slug/chapters/:number',
  optionalAuth,
  ah<{ slug: string; number: string }>(async (req, res) => {
    const number = Number.parseInt(req.params.number, 10);
    if (!Number.isFinite(number) || number <= 0) {
      res.status(400).json({ error: { code: 'bad_request', message: 'invalid chapter number' } });
      return;
    }
    const result = await svc.getChapterForReader(req.params.slug, number, req.user);
    res.json(result);
  }),
);

// --- author routes ---------------------------------------------------------

const createSeriesSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'lowercase alphanumeric and hyphens only'),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  access_tier: z.enum(['free', 'reader', 'patron']),
  cover_asset_key: z.string().max(512).optional(),
});

catalogRouter.post(
  '/author/series',
  requireAuth,
  requireRole('author', 'admin'),
  validate(createSeriesSchema),
  ah(async (req, res) => {
    const created = await svc.createSeries(req.user!.sub, req.body as never);
    res.status(201).json(created);
  }),
);

catalogRouter.post(
  '/author/series/:id/publish',
  requireAuth,
  requireRole('author', 'admin'),
  ah<{ id: string }>(async (req, res) => {
    const published = await svc.publishSeries(req.params.id, req.user!.sub);
    res.json(published);
  }),
);

const createChapterSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(200),
  asset_key: z.string().min(1).max(512),
  word_count: z.number().int().nonnegative(),
  publish_at: z.string().datetime().optional(),
});

catalogRouter.post(
  '/author/series/:id/chapters',
  requireAuth,
  requireRole('author', 'admin'),
  validate(createChapterSchema),
  ah<{ id: string }>(async (req, res) => {
    const body = req.body as z.infer<typeof createChapterSchema>;
    const created = await svc.createChapter(req.params.id, req.user!.sub, {
      ...body,
      publish_at: body.publish_at ? new Date(body.publish_at) : null,
    });
    res.status(201).json(created);
  }),
);

catalogRouter.post(
  '/author/chapters/:id/publish',
  requireAuth,
  requireRole('author', 'admin'),
  ah<{ id: string }>(async (req, res) => {
    const published = await svc.publishChapter(req.params.id, req.user!.sub);
    res.json(published);
  }),
);
