-- Reelsona assumes exactly one settings, automation_config and caption_config
-- row per user. Preserve the newest row for any historical duplicates, then
-- enforce the invariant in PostgreSQL so .limit(1) is deterministic.

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id DESC) AS rn
  FROM settings
)
DELETE FROM settings
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC, id DESC) AS rn
  FROM automation_config
)
DELETE FROM automation_config
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY updated_at DESC, id DESC) AS rn
  FROM caption_config
)
DELETE FROM caption_config
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS settings_user_id_uidx
  ON settings(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS automation_config_user_id_uidx
  ON automation_config(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS caption_config_user_id_uidx
  ON caption_config(user_id);
