import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/async.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './reading.service.js';

export const readingRouter = Router();

const progressSchema = z.object({
  chapter_id: z.string().uuid(),
  position: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
});

readingRouter.post(
  '/progress',
  requireAuth,
  validate(progressSchema),
  ah(async (req, res) => {
    const body = req.body as z.infer<typeof progressSchema>;
    const row = await svc.upsertProgress(req.user!.sub, body.chapter_id, body.position, body.percent);
    res.json(row);
  }),
);

readingRouter.get(
  '/history',
  requireAuth,
  ah(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? '25'), 10) || 25));
    const items = await svc.listHistory(req.user!.sub, limit);
    res.json({ items });
  }),
);

const bookmarkSchema = z.object({
  chapter_id: z.string().uuid(),
  position: z.number().int().nonnegative(),
  note: z.string().max(500).optional(),
});

readingRouter.post(
  '/bookmarks',
  requireAuth,
  validate(bookmarkSchema),
  ah(async (req, res) => {
    const b = req.body as z.infer<typeof bookmarkSchema>;
    const created = await svc.addBookmark(req.user!.sub, b.chapter_id, b.position, b.note);
    res.status(201).json(created);
  }),
);

readingRouter.get(
  '/bookmarks',
  requireAuth,
  ah(async (req, res) => {
    const chapterId = typeof req.query.chapter_id === 'string' ? req.query.chapter_id : undefined;
    const items = await svc.listBookmarks(req.user!.sub, chapterId);
    res.json({ items });
  }),
);

readingRouter.delete(
  '/bookmarks/:id',
  requireAuth,
  ah<{ id: string }>(async (req, res) => {
    await svc.deleteBookmark(req.user!.sub, req.params.id);
    res.status(204).send();
  }),
);
