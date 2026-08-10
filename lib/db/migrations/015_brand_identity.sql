-- Migration: add brand identity columns to settings table
-- Stores the uploaded logo path and the extracted colour palette so that
-- Reel cover generation can use consistent brand colours automatically.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS brand_logo_url      TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS brand_primary_color  TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS brand_accent_color   TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS brand_palette_colors TEXT[];
