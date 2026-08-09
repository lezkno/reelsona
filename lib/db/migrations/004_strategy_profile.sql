-- 004_strategy_profile.sql
-- Additive migration — creates the strategic profile and niche radar tables.
-- Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS audit_profiles (
  id                SERIAL PRIMARY KEY,
  account_data      JSONB,
  market_insights   JSONB,
  content_strategy  JSONB,
  steps_completed   TEXT[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS niche_radar_accounts (
  id                SERIAL PRIMARY KEY,
  ig_username       TEXT NOT NULL,
  profile_url       TEXT,
  bio               TEXT,
  followers         INTEGER,
  relevance_score   INTEGER DEFAULT 5,
  use_as_reference  BOOLEAN NOT NULL DEFAULT TRUE,
  source            TEXT NOT NULL DEFAULT 'manual',
  top_posts_json    JSONB,
  last_synced_at    TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ensure top_posts_json exists for databases created before this column was added
ALTER TABLE niche_radar_accounts ADD COLUMN IF NOT EXISTS top_posts_json JSONB;
