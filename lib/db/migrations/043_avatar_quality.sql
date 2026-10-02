-- Avatar video quality: 'standard' = InfiniteTalk (cheaper, static presenter),
-- 'premium' = WAN 3.0 (dynamic scenes, billed per WAN second).
-- settings.avatar_quality is the account default; content_plan_items.avatar_quality
-- is an optional per-reel override (NULL = use the account default).
-- Keep this migration immutable.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS avatar_quality TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_avatar_quality_check;
ALTER TABLE settings
  ADD CONSTRAINT settings_avatar_quality_check CHECK (avatar_quality IN ('standard', 'premium'));

ALTER TABLE content_plan_items
  ADD COLUMN IF NOT EXISTS avatar_quality TEXT;
ALTER TABLE content_plan_items
  DROP CONSTRAINT IF EXISTS content_plan_items_avatar_quality_check;
ALTER TABLE content_plan_items
  ADD CONSTRAINT content_plan_items_avatar_quality_check
  CHECK (avatar_quality IS NULL OR avatar_quality IN ('standard', 'premium'));
