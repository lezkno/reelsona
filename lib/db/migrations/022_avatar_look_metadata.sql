-- Migration 022: avatar_look_metadata table
-- Stores per-user per-look metadata (group, avatar type, supported engines, master look flag)
-- so generateVideo can use reference_look_id for Avatar V without extra HeyGen API calls.

CREATE TABLE IF NOT EXISTS avatar_look_metadata (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  look_id              TEXT NOT NULL,
  group_id             TEXT,
  avatar_type          TEXT,
  supported_api_engines TEXT[] NOT NULL DEFAULT '{}',
  is_master_look       BOOLEAN NOT NULL DEFAULT false,
  preferred_orientation TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, look_id)
);

CREATE INDEX IF NOT EXISTS idx_avatar_look_metadata_user_group
  ON avatar_look_metadata (user_id, group_id);
