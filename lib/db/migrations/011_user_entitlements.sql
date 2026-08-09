-- Migration 011: user_entitlements — access/license layer
-- One row per user. Separates course access from tool access.

CREATE TABLE IF NOT EXISTS user_entitlements (
  id                    serial PRIMARY KEY,
  user_id               integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  course_access         boolean NOT NULL DEFAULT false,
  tool_access_status    varchar(16) NOT NULL DEFAULT 'disabled'
                          CHECK (tool_access_status IN ('active', 'trialing', 'expired', 'disabled')),
  tool_access_starts_at timestamp,
  tool_access_ends_at   timestamp,
  source                varchar(64),          -- 'manual', 'stripe', 'gumroad', etc.
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now()
);

-- Activation token for post-purchase "set your password" flow
-- Different from verification_token: longer expiry, sent by admin/checkout
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS activation_token            text,
  ADD COLUMN IF NOT EXISTS activation_token_expires_at timestamp;
