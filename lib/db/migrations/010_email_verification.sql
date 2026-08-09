-- Migration 010: email verification tokens for self-registration
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verification_token      text,
  ADD COLUMN IF NOT EXISTS verification_token_expires_at timestamp;
