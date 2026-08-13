-- Migration 021: SaaS credit wallet — Phase 1
-- Adds user_credits (wallet) and credit_ledger (audit log) tables.
-- Adds provisioned_at to purchases for idempotent provision recovery.

-- ── user_credits ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_credits (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  available_credits INTEGER NOT NULL DEFAULT 0,
  reserved_credits  INTEGER NOT NULL DEFAULT 0,
  total_consumed    INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── credit_ledger ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_ledger (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              VARCHAR(32) NOT NULL,   -- provision | reserve | consume | release
  amount            INTEGER NOT NULL,       -- positive = added, negative = spent/reserved
  balance_before    INTEGER NOT NULL,
  balance_after     INTEGER NOT NULL,
  video_id          INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  related_ledger_id INTEGER,               -- FK to credit_ledger.id (self-ref, unenforced for simplicity)
  description       TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_id_idx     ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS credit_ledger_video_id_idx    ON credit_ledger(video_id);
CREATE INDEX IF NOT EXISTS credit_ledger_related_idx     ON credit_ledger(related_ledger_id);
CREATE INDEX IF NOT EXISTS credit_ledger_type_idx        ON credit_ledger(type);

-- ── purchases: provisioned_at ─────────────────────────────────────────────────
-- Tracks whether provisionUser() completed after a successful payment.
-- NULL = provision pending or failed; non-null = provisioned successfully.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMP;

-- ── Bootstrap credits for existing active users ───────────────────────────────
-- Grants credits proportional to remaining access days so current users
-- are not suddenly blocked when the credit check goes live.
-- 10 credits per remaining day of access (matches CREDITS_PER_DAY constant).
INSERT INTO user_credits (user_id, available_credits, reserved_credits, total_consumed, updated_at)
SELECT
  ue.user_id,
  GREATEST(10, CEIL(EXTRACT(EPOCH FROM (ue.tool_access_ends_at - NOW())) / 86400)::integer * 10),
  0,
  0,
  NOW()
FROM user_entitlements ue
WHERE ue.tool_access_status IN ('active', 'trialing')
  AND (ue.tool_access_ends_at IS NULL OR ue.tool_access_ends_at > NOW())
  AND NOT EXISTS (SELECT 1 FROM user_credits uc WHERE uc.user_id = ue.user_id)
ON CONFLICT (user_id) DO NOTHING;

-- Mark existing purchases as provisioned (they were processed before this column existed)
UPDATE purchases
SET provisioned_at = updated_at
WHERE status = 'completed'
  AND provisioned_at IS NULL
  AND user_id IS NOT NULL;
