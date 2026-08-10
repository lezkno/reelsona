-- Video Effects: per-account defaults (settings), per-item overrides (content_plan_items),
-- and immutable job snapshot (videos).
ALTER TABLE settings           ADD COLUMN IF NOT EXISTS video_effects jsonb NOT NULL DEFAULT '{"zoom":false,"ai_broll":false,"text_cards":false}';
ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS video_effects_override jsonb;
ALTER TABLE videos             ADD COLUMN IF NOT EXISTS video_effects jsonb;
