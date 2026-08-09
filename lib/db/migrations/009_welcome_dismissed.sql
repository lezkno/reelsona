-- Add welcome_dismissed column to settings table
ALTER TABLE settings ADD COLUMN IF NOT EXISTS welcome_dismissed boolean NOT NULL DEFAULT false;
