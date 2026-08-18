-- Legacy Instagram connections created before token expiry tracking was reliable
-- must not be treated as healthy. A missing expiry means Reelsona cannot prove
-- the long-lived token is still valid, so force an explicit reconnect instead
-- of making provider calls with an unknown credential state.

UPDATE instagram_accounts
SET needs_reconnection = TRUE,
    updated_at = NOW()
WHERE token_expires_at IS NULL
  AND COALESCE(needs_reconnection, FALSE) = FALSE;
