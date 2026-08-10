-- 014_multi_tenant_user_scope.sql
-- Add user_id to every table that was previously a global singleton.
-- Existing rows are re-assigned to the first registered user so no data is lost.

ALTER TABLE caption_config     ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE automation_config  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE avatar_config      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE videos             ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);

-- Assign every existing row to the first (oldest) registered user.
DO $$
DECLARE v_uid INTEGER;
BEGIN
  SELECT id INTO v_uid FROM users ORDER BY id LIMIT 1;
  IF v_uid IS NOT NULL THEN
    UPDATE caption_config     SET user_id = v_uid WHERE user_id IS NULL;
    UPDATE automation_config  SET user_id = v_uid WHERE user_id IS NULL;
    UPDATE avatar_config      SET user_id = v_uid WHERE user_id IS NULL;
    UPDATE instagram_accounts SET user_id = v_uid WHERE user_id IS NULL;
    UPDATE content_plan_items SET user_id = v_uid WHERE user_id IS NULL;
    UPDATE videos             SET user_id = v_uid WHERE user_id IS NULL;
  END IF;
END $$;

-- Enforce NOT NULL now that all rows are populated.
ALTER TABLE caption_config     ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE automation_config  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE avatar_config      ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE instagram_accounts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE content_plan_items ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE videos             ALTER COLUMN user_id SET NOT NULL;
