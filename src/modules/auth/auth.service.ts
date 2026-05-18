import { randomUUID } from 'node:crypto';
import { pool, withTx } from '../../config/db.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  type Role,
} from '../../lib/jwt.js';
import { env } from '../../config/env.js';
import { errors } from '../../lib/errors.js';
import { getActiveSubscription } from '../subscriptions/subscriptions.service.js';
import type { LoginInput, RegisterInput } from './auth.schema.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: Role;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  access_expires_in: number;
  refresh_expires_in: number;
}

async function tierFor(userId: string): Promise<'free' | 'reader' | 'patron'> {
  const sub = await getActiveSubscription(userId);
  return sub?.tier ?? 'free';
}

async function issuePair(user: { id: string; role: Role }, ctx: { userAgent?: string; ip?: string }): Promise<TokenPair> {
  const tier = await tierFor(user.id);
  const sid = randomUUID();
  const access = await issueAccessToken({ sub: user.id, role: user.role, tier, sid });
  const { token: refresh } = await issueRefreshToken({ sub: user.id, sid });
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, session_id, token_hash, expires_at, user_agent, ip_addr)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, sid, hashRefreshToken(refresh), expiresAt, ctx.userAgent ?? null, ctx.ip ?? null],
  );

  return {
    access_token: access,
    refresh_token: refresh,
    access_expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
    refresh_expires_in: env.REFRESH_TOKEN_TTL_SECONDS,
  };
}

export async function register(input: RegisterInput, ctx: { userAgent?: string; ip?: string }): Promise<TokenPair> {
  const passwordHash = await hashPassword(input.password);
  try {
    const { rows } = await pool.query<{ id: string; role: Role }>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, role`,
      [input.email, passwordHash, input.display_name],
    );
    const user = rows[0]!;
    return issuePair(user, ctx);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw errors.conflict('email already registered');
    }
    throw err;
  }
}

export async function login(input: LoginInput, ctx: { userAgent?: string; ip?: string }): Promise<TokenPair> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, email, password_hash, display_name, role FROM users WHERE email = $1`,
    [input.email],
  );
  const user = rows[0];
  // Always run password verify to keep timing roughly constant.
  const ok = user
    ? await verifyPassword(user.password_hash, input.password)
    : await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$abc$def', input.password);
  if (!user || !ok) throw errors.unauthorized('invalid credentials');
  return issuePair(user, ctx);
}

/**
 * Refresh-token rotation:
 *  - The presented refresh token must be the current head of its session.
 *  - On success: revoke it, issue a new pair within the same session.
 *  - On replay (an already-revoked token used again): revoke the entire session
 *    (treat as compromise).
 */
export async function refresh(token: string, ctx: { userAgent?: string; ip?: string }): Promise<TokenPair> {
  const claims = await verifyRefreshToken(token).catch(() => null);
  if (!claims) throw errors.unauthorized('invalid refresh token');

  return withTx(async (client) => {
    const tokenHash = hashRefreshToken(token);
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      session_id: string;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT id, user_id, session_id, revoked_at, expires_at
       FROM refresh_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) throw errors.unauthorized('unknown refresh token');
    if (row.expires_at.getTime() < Date.now()) throw errors.unauthorized('refresh token expired');

    if (row.revoked_at) {
      // Replay detected — revoke entire session family.
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE session_id = $1 AND revoked_at IS NULL`,
        [row.session_id],
      );
      throw errors.unauthorized('refresh token reuse detected; session revoked');
    }

    const { rows: userRows } = await client.query<{ id: string; role: Role }>(
      `SELECT id, role FROM users WHERE id = $1`,
      [row.user_id],
    );
    const user = userRows[0];
    if (!user) throw errors.unauthorized('user not found');

    // Issue new pair within same session.
    const tier = await tierFor(user.id);
    const access = await issueAccessToken({ sub: user.id, role: user.role, tier, sid: row.session_id });
    const { token: newRefresh } = await issueRefreshToken({ sub: user.id, sid: row.session_id });
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000);

    const { rows: insertRows } = await client.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, session_id, token_hash, expires_at, user_agent, ip_addr)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user.id, row.session_id, hashRefreshToken(newRefresh), expiresAt, ctx.userAgent ?? null, ctx.ip ?? null],
    );

    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $1 WHERE id = $2`,
      [insertRows[0]!.id, row.id],
    );

    return {
      access_token: access,
      refresh_token: newRefresh,
      access_expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
      refresh_expires_in: env.REFRESH_TOKEN_TTL_SECONDS,
    };
  });
}

export async function logout(token: string): Promise<void> {
  const claims = await verifyRefreshToken(token).catch(() => null);
  if (!claims) return; // best-effort
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE session_id = $1 AND revoked_at IS NULL`,
    [claims.sid],
  );
}
