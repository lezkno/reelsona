-- Founder swap durability: when an active Basic/Pro subscriber buys Founder,
-- the old Stripe subscription must be cancelled. The cancellation happens after
-- the provisioning transaction commits, so it can fail (crash, Stripe error).
-- These columns make the pending cancellation durable so a scheduler sweep can
-- retry until Stripe confirms it.
--
--   superseded_stripe_subscription_id — the OLD Stripe subscription id replaced
--     by the Founder purchase. Kept permanently as a mapping so late webhooks
--     for the old subscription can be acknowledged as no-ops.
--   superseded_cancelled_at — set once Stripe confirms the old subscription is
--     cancelled. NULL means the cancellation is still pending retry.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS superseded_stripe_subscription_id VARCHAR(256);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS superseded_cancelled_at TIMESTAMP;
