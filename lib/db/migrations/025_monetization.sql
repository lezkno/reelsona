-- ============================================================================
-- Migration 001: Monetization backend (Task #274)
--
-- Applied: 2026-08-16 via raw SQL (drizzle-kit push requires TTY).
-- Safe to re-run: all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ============================================================================

-- ── New tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(256) UNIQUE,
  stripe_customer_id     VARCHAR(256),
  plan_slug              VARCHAR(32) NOT NULL,
  status                 VARCHAR(32) NOT NULL DEFAULT 'active',
  current_period_start   TIMESTAMP,
  current_period_end     TIMESTAMP,
  founder_months_granted INTEGER NOT NULL DEFAULT 0,
  founder_last_grant_at  TIMESTAMP,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_price_configs (
  id               SERIAL PRIMARY KEY,
  plan_slug        VARCHAR(64) NOT NULL UNIQUE,
  stripe_price_id  VARCHAR(256) NOT NULL,
  stripe_product_id VARCHAR(256) NOT NULL,
  amount_cents     INTEGER NOT NULL,
  currency         VARCHAR(8) NOT NULL DEFAULT 'usd',
  interval         VARCHAR(16),
  credit_amount    INTEGER NOT NULL DEFAULT 0,
  is_recurring     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Alter user_credits: dual credit-pool tracking ─────────────────────────────

ALTER TABLE user_credits
  ADD COLUMN IF NOT EXISTS subscription_credits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchased_credits    INTEGER NOT NULL DEFAULT 0;

-- Migrate existing balances: treat all pre-migration available_credits as purchased
UPDATE user_credits
  SET purchased_credits = available_credits
  WHERE purchased_credits = 0 AND available_credits > 0;

-- ── Alter credit_ledger: pool attribution columns ─────────────────────────────

ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS pool                VARCHAR(16),
  ADD COLUMN IF NOT EXISTS subscription_amount INTEGER,
  ADD COLUMN IF NOT EXISTS purchased_amount    INTEGER;

-- ── Alter user_entitlements: plan association ─────────────────────────────────

ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS plan_slug VARCHAR(32);

-- ── Alter purchases: purchase type and credit tracking ────────────────────────

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS purchase_type    VARCHAR(32) NOT NULL DEFAULT 'program',
  ADD COLUMN IF NOT EXISTS plan_slug        VARCHAR(32),
  ADD COLUMN IF NOT EXISTS credits_purchased INTEGER;

-- ── Alter subscriptions: immutable invoice idempotency key ─────────────────────
-- Stores the Stripe invoice ID of the last credit grant (secondary reference, not
-- the primary idempotency gate — see invoice_credit_grants below).

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS last_granted_invoice_id VARCHAR(256);

-- ── invoice_credit_grants: per-invoice credit grant log ────────────────────────
-- UNIQUE on stripe_invoice_id is the true idempotency mechanism:
--   - INSERT ON CONFLICT DO NOTHING inside the credit-grant transaction
--   - Pre-claimed at checkout (initial invoice) so invoice.paid is a no-op
--   - Durable: stores all invoice IDs, not just the "last" one

CREATE TABLE IF NOT EXISTS invoice_credit_grants (
  id               SERIAL PRIMARY KEY,
  stripe_invoice_id VARCHAR(256) NOT NULL UNIQUE,
  user_id          INTEGER      NOT NULL,
  plan_slug        VARCHAR(32)  NOT NULL,
  credits_granted  INTEGER      NOT NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── Settlement uniqueness: exactly one consume or release per reserve ──────────
-- Prevents concurrent consume + release from both committing for the same
-- reservation even if the application-level FOR UPDATE lock is defeated.
-- Partial index: only settlement rows (consume/release) are indexed, so the
-- reserve row itself (which has no related_ledger_id) is not affected.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_one_settlement_per_reserve
  ON credit_ledger (related_ledger_id)
  WHERE type IN ('consume', 'release');
