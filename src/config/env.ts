import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_READER: z.string().min(1),
  STRIPE_PRICE_PATRON: z.string().min(1),

  ASSET_BUCKET: z.string().min(1),
  ASSET_REGION: z.string().min(1),
  ASSET_SIGN_SECRET: z.string().min(32),
  ASSET_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  ASSET_PUBLIC_BASE_URL: z.string().url(),

  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_GENERAL_PER_MINUTE: z.coerce.number().int().positive().default(120),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = JSON.stringify(parsed.error.flatten().fieldErrors, null, 2);
  throw new Error(`Invalid environment configuration:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;
