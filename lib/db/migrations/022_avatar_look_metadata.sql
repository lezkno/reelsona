-- Migration 022: avatar_look_metadata
-- Stores per-user per-look metadata (group, engine support, master flag)
-- so the generation pipeline can resolve reference_look_id for Avatar V
-- without extra HeyGen API calls at render time.

CREATE TABLE avatar_look_metadata (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  look_id              TEXT    NOT NULL,   -- HeyGen look ID (with "tp:" prefix for photo avatars)
  group_id             TEXT,              -- HeyGen avatar group ID
  avatar_type          TEXT,              -- "digital_twin" | "photo_avatar" | "studio_avatar"
  supported_api_engines TEXT[] NOT NULL DEFAULT '{}',
  is_master_look       BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_orientation TEXT,             -- "vertical" | "horizontal"
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, look_id)
);

-- Fast lookup: all looks belonging to a user+group (for reference look resolution)
CREATE INDEX idx_avatar_look_metadata_user_group
  ON avatar_look_metadata(user_id, group_id);
