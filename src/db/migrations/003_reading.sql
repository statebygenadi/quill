-- 003_reading.sql — per-user reading state

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id   UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  percent      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  completed_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_progress_user_updated
  ON reading_progress(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id  UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position >= 0),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_chapter ON bookmarks(user_id, chapter_id);
