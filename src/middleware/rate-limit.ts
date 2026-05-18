import type { NextFunction, Request, Response } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { env } from '../config/env.js';
import { errors } from '../lib/errors.js';

const authLimiter = new RateLimiterMemory({
  points: env.RATE_LIMIT_AUTH_PER_MINUTE,
  duration: 60,
});

const generalLimiter = new RateLimiterMemory({
  points: env.RATE_LIMIT_GENERAL_PER_MINUTE,
  duration: 60,
});

function clientKey(req: Request): string {
  // honor X-Forwarded-For if behind a trusted proxy (configured in app.ts)
  return req.user?.sub ?? req.ip ?? 'anon';
}

function wrap(limiter: RateLimiterMemory) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const r = await limiter.consume(clientKey(req));
      res.setHeader('X-RateLimit-Remaining', String(r.remainingPoints));
      next();
    } catch {
      next(errors.tooMany());
    }
  };
}

export const rateLimitAuth = wrap(authLimiter);
export const rateLimitGeneral = wrap(generalLimiter);
