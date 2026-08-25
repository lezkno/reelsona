-- Keep payment identity and refund progress attached to the exact purchase.
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS provider_payment_intent_id VARCHAR(256);

CREATE UNIQUE INDEX IF NOT EXISTS purchases_provider_payment_intent_id_idx
  ON purchases(provider_payment_intent_id)
  WHERE provider_payment_intent_id IS NOT NULL;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS refunded_amount_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS refunded_credits INTEGER NOT NULL DEFAULT 0;