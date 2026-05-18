import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, type AccessClaims, type Role } from '../lib/jwt.js';
import { errors } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessClaims;
    }
  }
}

function extract(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const [scheme, token] = h.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extract(req);
  if (!token) return next(errors.unauthorized());
  try {
    req.user = await verifyAccessToken(token);
    next();
  } catch {
    next(errors.unauthorized('invalid or expired token'));
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extract(req);
  if (!token) return next();
  try {
    req.user = await verifyAccessToken(token);
  } catch {
    // ignore — anonymous
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(errors.unauthorized());
    if (!roles.includes(req.user.role)) return next(errors.forbidden(`requires role: ${roles.join('|')}`));
    next();
  };
}
