# Quill

A subscription platform backend for serialized longform fiction. Authors
publish series chapter-by-chapter; readers subscribe to tiered access.

## Stack

- Node.js 20+, TypeScript (strict, `noUncheckedIndexedAccess`), ESM
- Express 5, Helmet, CORS, pino structured logging
- PostgreSQL 16 (`pg`), hand-written SQL migrations
- Argon2id passwords, JOSE HS256 JWTs (rotating refresh tokens, reuse detection)
- Zod request validation, `rate-limiter-flexible` memory backend
- Vitest

## Quick start

```bash
cp .env.example .env
# fill in JWT_*_SECRET and ASSET_SIGN_SECRET with 32+ byte values

docker compose up -d              # postgres on :5432
npm install
npm run migrate                   # apply src/db/migrations/*.sql in order
npm run seed                      # optional: admin/author/reader + a series
npm run dev                       # tsx watch on :4000
npm test                          # 18 unit tests
```

## Architecture

```
src/
  app.ts                     express composition (helmet, cors, pino, error handler)
  server.ts                  bootstrap + graceful shutdown
  config/
    env.ts                   zod-validated env (throws on bad config, not exit)
    db.ts                    pg.Pool + withTx helper
  lib/
    jwt.ts                   access + refresh token issuance/verification, hash
    password.ts              argon2id hash/verify
    stripe.ts                MOCKED provider: HMAC-signed webhooks, checkout
    assets.ts                HMAC-signed asset URLs (S3-presigned equivalent)
    entitlements.ts          free < reader < patron tier ordering
    errors.ts                AppError taxonomy with stable codes
    async.ts                 ah() wrapper: hands rejections to next()
  middleware/
    auth.ts                  requireAuth / optionalAuth / requireRole
    validate.ts              zod request validator (body|query|params)
    rate-limit.ts            per-IP / per-user limiters
    error.ts                 unified JSON error envelope
  modules/
    auth/                    register, login, refresh (rotation+replay), logout
    users/                   /me read + patch
    catalog/                 series & chapters; ownership-scoped author writes
    reading/                 forward-only progress upsert, history, bookmarks
    subscriptions/           checkout, webhook handler, cancel-at-period-end
    assets/                  upload-intent, resign
    admin/                   grant author, inspect unprocessed webhooks, jobs
  db/migrations/             4 ordered SQL files; runner in scripts/migrate.ts
```

## API surface

```
POST   /v1/auth/register                     { email, password, display_name }
POST   /v1/auth/login                        { email, password }
POST   /v1/auth/refresh                      { refresh_token }
POST   /v1/auth/logout                       { refresh_token }

GET    /v1/users/me
PATCH  /v1/users/me                          { display_name? }

GET    /v1/catalog/series?limit&cursor&tier
GET    /v1/catalog/series/:slug
GET    /v1/catalog/series/:slug/chapters/:number   → { ..., asset_url, asset_expires_at }
POST   /v1/catalog/author/series                   author/admin
POST   /v1/catalog/author/series/:id/publish       author/admin
POST   /v1/catalog/author/series/:id/chapters      author/admin
POST   /v1/catalog/author/chapters/:id/publish     author/admin

POST   /v1/reading/progress                  { chapter_id, position, percent }
GET    /v1/reading/history?limit
POST   /v1/reading/bookmarks                 { chapter_id, position, note? }
GET    /v1/reading/bookmarks?chapter_id
DELETE /v1/reading/bookmarks/:id

POST   /v1/subscriptions/checkout            { tier }
GET    /v1/subscriptions/me
POST   /v1/subscriptions/cancel
POST   /v1/webhooks/stripe                   raw body + signed header

POST   /v1/assets/upload-intent              { kind, content_type, byte_size }
POST   /v1/assets/resign                     { asset_key }

POST   /v1/admin/authors                     { user_id, pen_name, bio? }
GET    /v1/admin/payment-events/unprocessed
POST   /v1/admin/jobs/publish-due-chapters
GET    /v1/admin/users/:id
```

All errors are `{ error: { code, message, details? } }` with stable codes:
`bad_request, unauthorized, forbidden, not_found, conflict, gone, unprocessable,
too_many_requests, subscription_required, internal`.

## Design decisions worth defending

### Refresh-token rotation with reuse detection

Each `/auth/refresh` call:

1. Looks up the presented token by SHA-256 hash (raw token never persisted).
2. If the row is already revoked → revokes the entire `session_id` family.
   This is the textbook compromise signal: an attacker re-using a token after
   the legitimate client already rotated past it.
3. Otherwise issues a new access+refresh pair, marks the old row revoked with
   `replaced_by` pointing at the new row, all in one transaction.

Sessions can be revoked en masse via `session_id` — useful for "log out all
devices" or admin-driven kill switches.

### Webhook idempotency with a durable log

`POST /v1/webhooks/stripe` mounts the raw body parser BEFORE `express.json()`
because Stripe-style HMAC verification needs byte-identical input.

The handler runs in a transaction:

1. `INSERT INTO payment_events (provider_event_id, ...) ON CONFLICT DO NOTHING`.
2. If conflict → return `{ duplicate: true, received: true }`. Stripe stops
   retrying.
3. Otherwise apply mutations and mark `processed_at`.

`/v1/admin/payment-events/unprocessed` is the operator surface for events that
hit `processing_error` so a human can intervene.

### Tier entitlement is enforced at the read site, not at indexing

`series.access_tier` is `free | reader | patron`. The `JWT` carries the user's
current tier (resolved at issuance) plus role. The chapter resolver checks
`isEntitled(req.user, series.access_tier)` and returns a freshly-signed asset
URL only if it passes. Admin bypasses the check.

Trade-off: tier in JWT can be stale until refresh. The refresh path
re-derives it from the active subscription row, so a successful refresh
within `ACCESS_TOKEN_TTL_SECONDS` of the webhook arrival is enough.

### Forward-only reading progress

`reading_progress` uses `GREATEST(stored, incoming)` for both `position` and
`percent`. Clients can fire-and-forget; out-of-order or replayed pings can't
walk a reader backward.

### Author writes are ownership-scoped at the SQL layer

Author mutations don't fetch-then-check; they include
`WHERE series.author_id = (SELECT id FROM authors WHERE user_id = $1)` and
return zero rows on mismatch, which the service translates to `404`. This
collapses two round-trips and avoids a TOCTOU window. Admins gate via
`requireRole('author', 'admin')` at the route.

### Signed asset URLs with input shape constraints

`signAssetUrl` rejects keys containing `..` or leading `/`. The URL embeds
`exp` + HMAC(`bucket | key | exp`), constant-time verified.
TTL defaults to 5 minutes. In production swap for CloudFront/S3 presigned
URLs; the call surface stays identical.

### Strict TypeScript + `noUncheckedIndexedAccess`

Catches `req.params.x` and `rows[0]` when they can be `undefined`. Slightly
noisier code (`rows[0]!` or explicit guards) buys real safety on the
indexing patterns that show up everywhere in pg result handling.

## Schema

Six tables + `_migrations`:

```
users(id, email, password_hash, display_name, role, ...)
refresh_tokens(id, user_id, session_id, token_hash, expires_at, revoked_at, replaced_by, ...)
authors(id, user_id UNIQUE, pen_name, bio)
series(id, author_id, slug UNIQUE, title, status, access_tier, published_at, ...)
chapters(id, series_id, number, title, asset_key, status, publish_at, published_at,
         UNIQUE(series_id, number))
subscriptions(id, user_id, tier, status, provider_subscription_id UNIQUE,
              current_period_end, cancel_at_period_end, ...)
  -- partial UNIQUE on user_id WHERE status IN ('trialing','active','past_due')
payment_events(id, provider_event_id UNIQUE, type, payload, processed_at, processing_error)
reading_progress(user_id, chapter_id, position, percent, completed_at, PRIMARY KEY(...))
bookmarks(id, user_id, chapter_id, position, note)
audit_log(id, actor_id, action, resource_type, resource_id, metadata, ip_addr)
```

Notable indexes: `idx_chapters_publish_at WHERE status='scheduled'` (cheap
scheduler scan), `idx_series_status_tier` (catalog list), partial unique on
active subscription per user.

## Known limitations / production hardening backlog

Calling these out because the project would not ship in this state.

1. **Webhook processing inside the idempotency transaction.** A poison event
   currently rolls back the `payment_events` insert along with its mutation,
   so the next delivery re-tries forever. Production split: insert
   `payment_events` in tx A, process in tx B, store `processing_error` on
   failure without losing the durable record. The admin endpoint already
   exposes the surface.
2. **No outbox for downstream effects.** Welcome emails, search indexing,
   notification fanout — currently no place to put them. Add an `outbox`
   table written in the same tx as the trigger, drained by a worker.
3. **In-memory rate limiter.** Fine for a single instance; swap for Redis
   (`rate-limiter-flexible` has a Redis backend with the same API).
4. **Email verification & password reset flows are absent.** `users` has
   `email_verified_at` but no token issuance / consumption.
5. **No request ID propagation.** Add an `X-Request-Id` middleware feeding
   pino so logs and error responses share an ID.
6. **Tests are unit-level only.** Pure-logic coverage for jwt, entitlements,
   stripe signing, asset signing (18 tests). Integration tests against a
   real Postgres (suggest a `--testcontainers` setup) are the next layer.
7. **Stripe SDK is mocked.** Surface matches Stripe's `checkout.sessions`,
   `customer.subscription.*`, and webhook signature scheme so the swap is
   mechanical — but it's not been validated against the real SDK.
8. **Scheduler is admin-triggered.** `POST /v1/admin/jobs/publish-due-chapters`
   exists for `publish_at <= now()` chapters but no cron. Wire to whatever
   the deploy environment uses (k8s CronJob, Cloud Scheduler, pg_cron with
   `FOR UPDATE SKIP LOCKED`).
9. **No content immutability after publish.** A published chapter can be
   re-`UPDATE`d on its `asset_key`. If readers must see the exact bytes they
   first read, snapshot to an immutable key on publish.
10. **JWT tier claim staleness.** Upgrading mid-session needs a refresh to
    take effect. For instant unlock on upgrade, either reduce
    `ACCESS_TOKEN_TTL_SECONDS` or check the live subscription on
    entitlement-sensitive routes.

## Seed credentials

After `npm run seed`:

```
admin@quill.local   / AdminPasswordChangeMe!
author@quill.local  / AuthorPasswordChangeMe!
reader@quill.local  / ReaderPasswordChangeMe!
```

All three are pre-verified. The seed creates one published free-tier series
("The Glass Tower") with three chapters whose asset_keys point at non-existent
S3 objects — fine for testing the resolver path, not for reading content.
