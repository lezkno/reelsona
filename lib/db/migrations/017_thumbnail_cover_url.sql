-- Migration: add thumbnail_cover_url to videos table
-- Stores the AI-generated Reel cover image (gpt-image-1) so it can be reused
-- on publish retry without re-generating and paying for another AI call.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_cover_url TEXT;
