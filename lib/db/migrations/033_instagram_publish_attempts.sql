-- 033_instagram_publish_attempts.sql
-- Durable idempotency/fail-safe ledger for the final Instagram media_publish call.
-- A creation_id is published at most once by Reelsona. If the network outcome is
-- uncertain, retries are blocked rather than risking a duplicate Reel.

CREATE TABLE IF NOT EXISTS instagram_publish_attempts (
  creation_id TEXT PRIMARY KEY,
  ig_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('attempting', 'confirmed', 'uncertain')),
  media_id TEXT,
  last_error TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS instagram_publish_attempts_status_idx
  ON instagram_publish_attempts(status);
