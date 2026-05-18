import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { errors } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

export function validate<T>(schema: ZodSchema<T>, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(errors.unprocessable('validation failed', result.error.flatten()));
    }
    // overwrite with parsed (coerced/stripped) value
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}
