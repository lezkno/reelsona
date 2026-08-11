-- Migration: add business-profile columns to settings table
-- These columns store the creator's offer, audience, value proposition, voice style,
-- common objections, and custom CTA — used to personalize script generation prompts.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS offer              TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ideal_audience     TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS unique_value_prop  TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS voice_style        TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS common_objections  TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS custom_cta         TEXT;
