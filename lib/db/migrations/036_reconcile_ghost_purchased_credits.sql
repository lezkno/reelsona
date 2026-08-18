-- Reconcile legacy admin-grant wallets where purchased_credits was incorrectly
-- initialized to the same value as subscription_credits even though no purchased
-- credits were ever provisioned in the immutable ledger.
--
-- Safety: only targets the exact corruption pattern observed in production:
--   available = subscription = purchased = 1500, no consumption/reservations,
--   and no ledger evidence of purchased credits. Genuine top-ups always create
--   purchased-pool ledger entries and therefore are excluded.

WITH ghost_wallets AS (
  SELECT uc.user_id, uc.available_credits, uc.purchased_credits
  FROM user_credits uc
  WHERE uc.available_credits = 1500
    AND uc.subscription_credits = 1500
    AND uc.purchased_credits = 1500
    AND uc.reserved_credits = 0
    AND uc.total_consumed = 0
    AND NOT EXISTS (
      SELECT 1
      FROM credit_ledger cl
      WHERE cl.user_id = uc.user_id
        AND (
          cl.pool = 'purchased'
          OR COALESCE(cl.purchased_amount, 0) > 0
        )
    )
),
audit_rows AS (
  INSERT INTO credit_ledger (
    user_id,
    type,
    amount,
    balance_before,
    balance_after,
    pool,
    purchased_amount,
    description
  )
  SELECT
    gw.user_id,
    'adjustment',
    0,
    gw.available_credits,
    gw.available_credits,
    'purchased',
    -gw.purchased_credits,
    'Reconcile legacy ghost purchased credits from manual Pro grant; available balance unchanged'
  FROM ghost_wallets gw
  RETURNING user_id
)
UPDATE user_credits uc
SET purchased_credits = 0,
    updated_at = NOW()
WHERE uc.user_id IN (SELECT user_id FROM audit_rows);
