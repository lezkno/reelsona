-- Migration 003: Viral Editorial Engine
-- Run this against the production DB before deploying this release.
-- All changes are additive — no data is modified or removed.

-- New editorial metadata columns on content_plan_items
ALTER TABLE content_plan_items
  ADD COLUMN IF NOT EXISTS viral_score          INTEGER,
  ADD COLUMN IF NOT EXISTS editorial_angle      TEXT,
  ADD COLUMN IF NOT EXISTS hook_candidates      TEXT,
  ADD COLUMN IF NOT EXISTS hook_selection_reason TEXT,
  ADD COLUMN IF NOT EXISTS share_reason         TEXT,
  ADD COLUMN IF NOT EXISTS audience_pain        TEXT,
  ADD COLUMN IF NOT EXISTS novelty_level        TEXT;

-- Instagram audit cache table (persists audit results for future generations)
CREATE TABLE IF NOT EXISTS instagram_audit_cache (
  id                  SERIAL PRIMARY KEY,
  recommended_topics  TEXT[]     NOT NULL DEFAULT '{}',
  content_insights    TEXT,
  top_captions_json   TEXT       NOT NULL DEFAULT '[]',
  avg_engagement      REAL       NOT NULL DEFAULT 0,
  best_posting_times  TEXT[]     NOT NULL DEFAULT '{}',
  fetched_at          TIMESTAMP  NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMP  NOT NULL DEFAULT NOW()
);
