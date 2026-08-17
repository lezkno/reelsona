-- Migration 028: add stripe_schedule_id to subscriptions
-- Stores the active Stripe Subscription Schedule ID for Pro→Basic scheduled downgrades.
-- Cleared when the schedule is released (upgrade, cancellation, or automatic phase transition).

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_schedule_id VARCHAR(256) DEFAULT NULL;
