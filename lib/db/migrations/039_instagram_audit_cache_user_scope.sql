-- Instagram audit cache was historically global (one row for the whole app),
-- which allowed the last audited account to influence another user's content.
-- Legacy rows cannot be attributed safely, so discard them and require user_id.

DELETE FROM instagram_audit_cache;

ALTER TABLE instagram_audit_cache
  ADD COLUMN IF NOT EXISTS user_id INTEGER;

ALTER TABLE instagram_audit_cache
  ALTER COLUMN user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS instagram_audit_cache_user_id_uidx
  ON instagram_audit_cache(user_id);
