-- Migration 002: admin users table
-- Run this against production DB before deploying the users management feature.

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role        VARCHAR(32) NOT NULL DEFAULT 'admin',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- NOTE: Seed the initial admin user from your ADMIN_PASSWORD env var.
-- The API server does this automatically on first startup when the table is empty.
-- You do NOT need to run any INSERT manually.
