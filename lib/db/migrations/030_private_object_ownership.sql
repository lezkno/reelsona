-- 030_private_object_ownership.sql
-- Tenant isolation for private object-storage uploads.
-- Every newly-issued private object path is bound to exactly one Reelsona user.
-- Legacy objects without an ownership row are intentionally denied by the API
-- until explicitly backfilled.

CREATE TABLE IF NOT EXISTS private_object_ownership (
  object_path TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS private_object_ownership_user_id_idx
  ON private_object_ownership(user_id);
