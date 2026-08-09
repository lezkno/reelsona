-- Migration 005: Talking-head format metadata on content_plan_items
-- Adds visual_dependency, format_fit_score, suggested_visual_support, avatar_fit_reason
-- All ADD COLUMN IF NOT EXISTS — safe to re-run

ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS visual_dependency TEXT;
ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS format_fit_score REAL;
ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS suggested_visual_support TEXT;
ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS avatar_fit_reason TEXT;
