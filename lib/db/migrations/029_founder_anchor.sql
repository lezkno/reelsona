-- Bloque 5 patch: immutable anchor date for Founder monthly credit grants.
--
-- founderAnchorAt is set once at initial Founder purchase and never changed.
-- Each monthly grant date is computed as: addCalendarMonths(founderAnchorAt, founderMonthsGranted).
-- This preserves the original purchase day across all 12 cycles, even when a grant
-- is processed late (e.g., downtime on the anniversary day).
--
-- founderLastGrantAt is retained purely as an audit trail (when the grant actually ran).

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS founder_anchor_at TIMESTAMP;

-- Back-fill existing Founder rows from founderLastGrantAt.
-- When founderMonthsGranted = 1, founderLastGrantAt IS the anchor (exact).
-- When founderMonthsGranted > 1 (unlikely in beta), this is a best-effort approximation.
UPDATE subscriptions
SET founder_anchor_at = founder_last_grant_at
WHERE plan_slug = 'founder'
  AND founder_last_grant_at IS NOT NULL
  AND founder_anchor_at IS NULL;
