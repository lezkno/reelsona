ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS caption_processing_lease_id TEXT;