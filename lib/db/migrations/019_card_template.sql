-- Migration: add card_template column to caption_config table
-- Stores the user's saved card template configuration (MultiCardConfig | SavedCardTemplate | null).
-- This column is read/written by the /api/cards/template routes and consumed by both
-- the standard ASS/FFmpeg and browser caption-engine paths during video processing.

ALTER TABLE caption_config ADD COLUMN IF NOT EXISTS card_template JSONB;
