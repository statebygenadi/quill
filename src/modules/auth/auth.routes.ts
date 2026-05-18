import { Router } from 'express';
import { ah } from '../../lib/async.js';
import { validate } from '../../middleware/validate.js';
import { rateLimitAuth } from '../../middleware/rate-limit.js';
import { loginSchema, refreshSchema, registerSchema } from './auth.schema.js';
import * as svc from './auth.service.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  rateLimitAuth,
  validate(registerSchema),
  ah(async (req, res) => {
    const pair = await svc.register(req.body as never, { userAgent: req.get('user-agent'), ip: req.ip });
    res.status(201).json(pair);
  }),
);

authRouter.post(
  '/login',
  rateLimitAuth,
  validate(loginSchema),
  ah(async (req, res) => {
    const pair = await svc.login(req.body as never, { userAgent: req.get('user-agent'), ip: req.ip });
    res.json(pair);
  }),
);

authRouter.post(
  '/refresh',
  rateLimitAuth,
  validate(refreshSchema),
  ah(async (req, res) => {
    const body = req.body as { refresh_token: string };
    const pair = await svc.refresh(body.refresh_token, { userAgent: req.get('user-agent'), ip: req.ip });
    res.json(pair);
  }),
);

authRouter.post(
  '/logout',
  validate(refreshSchema),
  ah(async (req, res) => {
    const body = req.body as { refresh_token: string };
    await svc.logout(body.refresh_token);
    res.status(204).send();
  }),
);
