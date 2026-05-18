-- 002_subscriptions.sql — subscriptions + webhook idempotency log

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier                     TEXT NOT NULL CHECK (tier IN ('reader', 'patron')),
  status                   TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),
  provider                 TEXT NOT NULL DEFAULT 'stripe',
  provider_subscription_id TEXT UNIQUE,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active (non-canceled) subscription per user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_user_active
  ON subscriptions(user_id)
  WHERE status IN ('trialing', 'active', 'past_due');

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL,
  payload           JSONB NOT NULL,
  processed_at      TIMESTAMPTZ,
  processing_error  TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_unprocessed
  ON payment_events(received_at)
  WHERE processed_at IS NULL;
