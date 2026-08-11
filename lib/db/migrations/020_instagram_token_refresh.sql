-- Migration 020: Instagram token expiry tracking and auto-refresh support
-- token_expires_at was already in the Drizzle schema but never written; ensure column exists
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP;
-- needs_reconnection: set to true when a token refresh fails so the UI can prompt the user
ALTER TABLE instagram_accounts ADD COLUMN IF NOT EXISTS needs_reconnection BOOLEAN NOT NULL DEFAULT FALSE;
