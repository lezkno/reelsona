-- Stripe events can arrive out of order; retain the newest event timestamp
-- processed for each subscription so stale state cannot overwrite fresh state.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS last_stripe_event_created_at TIMESTAMPTZ;