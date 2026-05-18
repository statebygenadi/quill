import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/async.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { pool } from '../../config/db.js';
import { errors } from '../../lib/errors.js';
import { getActiveSubscription } from '../subscriptions/subscriptions.service.js';

export const usersRouter = Router();

usersRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const { rows } = await pool.query<{
      id: string;
      email: string;
      display_name: string;
      role: 'reader' | 'author' | 'admin';
      created_at: Date;
    }>(`SELECT id, email, display_name, role, created_at FROM users WHERE id = $1`, [req.user!.sub]);
    const user = rows[0];
    if (!user) throw errors.notFound('user');
    const sub = await getActiveSubscription(req.user!.sub);
    res.json({ user, subscription: sub });
  }),
);

const updateMeSchema = z.object({
  display_name: z.string().min(1).max(80).optional(),
});

usersRouter.patch(
  '/me',
  requireAuth,
  validate(updateMeSchema),
  ah(async (req, res) => {
    const body = req.body as z.infer<typeof updateMeSchema>;
    if (!body.display_name) {
      res.status(204).send();
      return;
    }
    await pool.query(`UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2`, [
      body.display_name,
      req.user!.sub,
    ]);
    res.status(204).send();
  }),
);
