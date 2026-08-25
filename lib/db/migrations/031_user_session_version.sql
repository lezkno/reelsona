-- Revoke all sessions for a user whenever security-sensitive account state changes.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;