import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/async.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { pool } from '../../config/db.js';
import { errors } from '../../lib/errors.js';
import { publishDueChapters } from '../catalog/catalog.service.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

const grantAuthorSchema = z.object({
  user_id: z.string().uuid(),
  pen_name: z.string().min(1).max(80),
  bio: z.string().max(2000).optional(),
});

adminRouter.post(
  '/authors',
  validate(grantAuthorSchema),
  ah(async (req, res) => {
    const b = req.body as z.infer<typeof grantAuthorSchema>;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET role = CASE WHEN role = 'admin' THEN role ELSE 'author' END,
                          updated_at = now()
         WHERE id = $1`,
        [b.user_id],
      );
      const { rows } = await client.query(
        `INSERT INTO authors (user_id, pen_name, bio) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET pen_name = EXCLUDED.pen_name, bio = EXCLUDED.bio
         RETURNING *`,
        [b.user_id, b.pen_name, b.bio ?? null],
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, action, resource_type, resource_id, metadata, ip_addr)
         VALUES ($1, 'grant_author', 'user', $2, $3, $4)`,
        [req.user!.sub, b.user_id, { pen_name: b.pen_name }, req.ip ?? null],
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }),
);

adminRouter.get(
  '/payment-events/unprocessed',
  ah(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, provider, provider_event_id, type, received_at, processing_error
       FROM payment_events
       WHERE processed_at IS NULL
       ORDER BY received_at DESC
       LIMIT 100`,
    );
    res.json({ items: rows });
  }),
);

adminRouter.post(
  '/jobs/publish-due-chapters',
  ah(async (req, res) => {
    const n = await publishDueChapters();
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, resource_type, metadata, ip_addr)
       VALUES ($1, 'run_publish_due_chapters', 'job', $2, $3)`,
      [req.user!.sub, { published: n }, req.ip ?? null],
    );
    res.json({ published: n });
  }),
);

adminRouter.get(
  '/users/:id',
  ah<{ id: string }>(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, role, email_verified_at, created_at FROM users WHERE id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) throw errors.notFound('user');
    res.json(rows[0]);
  }),
);
