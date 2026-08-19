export interface RenewalBalanceInput {
  planCredits: number;
  purchasedCredits: number;
}

export interface RenewalBalanceResult {
  subscriptionCredits: number;
  purchasedCredits: number;
  availableCredits: number;
}

/**
 * A renewal starts a fresh subscription-credit cycle.
 *
 * Reservations created in a previous cycle were already deducted from that
 * previous cycle. They must never reduce the fresh monthly grant. Settlement of
 * those reservations is handled separately by computeReleaseRestore().
 */
export function computeRenewalBalances(input: RenewalBalanceInput): RenewalBalanceResult {
  const planCredits = Math.max(0, Math.trunc(input.planCredits));
  const purchasedCredits = Math.max(0, Math.trunc(input.purchasedCredits));

  return {
    subscriptionCredits: planCredits,
    purchasedCredits,
    availableCredits: planCredits + purchasedCredits,
  };
}

export interface ReleaseRestoreInput {
  amount: number;
  reservationSubscriptionAmount: number;
  reservationPurchasedAmount: number;
  reservationCreatedAt: Date;
  latestSubscriptionProvisionAt: Date | null;
}

export interface ReleaseRestoreResult {
  restoreSubscription: number;
  restorePurchased: number;
  expiredSubscriptionAmount: number;
}

/**
 * Decide which pools a failed/cancelled reservation may restore.
 *
 * Purchased credits never expire, so their reserved portion is always restored.
 * Subscription credits belong to a billing cycle. If a reservation was created
 * before the latest subscription provision, that subscription portion belongs to
 * the previous cycle and must not be restored into the new cycle.
 */
export function computeReleaseRestore(input: ReleaseRestoreInput): ReleaseRestoreResult {
  const amount = Math.max(0, Math.trunc(input.amount));
  const fromSub = Math.max(0, Math.trunc(input.reservationSubscriptionAmount));
  const fromPur = Math.max(0, Math.trunc(input.reservationPurchasedAmount));

  const knownAttributed = fromSub + fromPur;
  const unattributed = Math.max(0, amount - knownAttributed);

  const crossedSubscriptionCycle = !!input.latestSubscriptionProvisionAt &&
    input.reservationCreatedAt.getTime() < input.latestSubscriptionProvisionAt.getTime();

  if (crossedSubscriptionCycle) {
    // Any subscription-attributed amount is from an expired cycle. For legacy
    // unattributed reservations, do not manufacture new subscription credits;
    // only explicitly purchased attribution can safely survive the cycle boundary.
    return {
      restoreSubscription: 0,
      restorePurchased: Math.min(amount, fromPur),
      expiredSubscriptionAmount: Math.min(amount - Math.min(amount, fromPur), fromSub + unattributed),
    };
  }

  // Same cycle: restore exactly the recorded pools. Legacy unattributed amount
  // follows the historical behavior and returns to subscription first.
  const restoreSubscription = Math.min(amount, fromSub + unattributed);
  const restorePurchased = Math.min(amount - restoreSubscription, fromPur);

  return {
    restoreSubscription,
    restorePurchased,
    expiredSubscriptionAmount: 0,
  };
}
