export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  badRequest: (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details),
  unauthorized: (msg = 'unauthorized') => new AppError(401, 'unauthorized', msg),
  forbidden: (msg = 'forbidden') => new AppError(403, 'forbidden', msg),
  notFound: (msg = 'not found') => new AppError(404, 'not_found', msg),
  conflict: (msg: string) => new AppError(409, 'conflict', msg),
  gone: (msg: string) => new AppError(410, 'gone', msg),
  unprocessable: (msg: string, details?: unknown) => new AppError(422, 'unprocessable', msg, details),
  tooMany: (msg = 'too many requests') => new AppError(429, 'too_many_requests', msg),
  paymentRequired: (msg = 'subscription required') => new AppError(402, 'subscription_required', msg),
};
