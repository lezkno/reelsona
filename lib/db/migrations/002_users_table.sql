-- Migration 002: admin users table (with all extended fields)
-- Run this against production DB before deploying the users management feature.
-- The API server also auto-applies these via ALTER TABLE IF NOT EXISTS on startup.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  full_name     VARCHAR(128),
  email         VARCHAR(256),
  phone         VARCHAR(32),
  role          VARCHAR(32)  NOT NULL DEFAULT 'admin',
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  notes         TEXT,
  last_login_at TIMESTAMP,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- If upgrading from the initial schema (without extended fields):
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name     VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email         VARCHAR(256);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone         VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notes         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMP NOT NULL DEFAULT NOW();
