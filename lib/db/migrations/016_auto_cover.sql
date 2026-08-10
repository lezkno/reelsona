-- Migration: add auto_cover_enabled flag to automation_config
-- When true the publish pipeline automatically generates and attaches a
-- branded cover image (using the user's saved brand colors) to each Reel.
ALTER TABLE automation_config ADD COLUMN IF NOT EXISTS auto_cover_enabled BOOLEAN NOT NULL DEFAULT FALSE;
