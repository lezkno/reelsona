-- Migration 027: add pending_plan_slug to subscriptions
-- Used for scheduled Pro→Basic downgrades: the column stores the target plan that
-- will be applied at the next billing cycle renewal. planSlug remains unchanged
-- (user keeps Pro access) until invoice.paid fires with billing_reason=subscription_cycle.

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pending_plan_slug VARCHAR(32) DEFAULT NULL;
