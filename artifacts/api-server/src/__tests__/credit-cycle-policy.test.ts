import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeRenewalBalances, computeReleaseRestore } from "../lib/credit-cycle-policy.js";

describe("credit cycle policy", () => {
  test("renewal grants the full new plan allocation even with old work still in flight", () => {
    assert.deepEqual(
      computeRenewalBalances({ planCredits: 1000, purchasedCredits: 250 }),
      {
        subscriptionCredits: 1000,
        purchasedCredits: 250,
        availableCredits: 1250,
      },
    );
  });

  test("same-cycle failed reservation restores subscription credits", () => {
    const provisionedAt = new Date("2026-08-01T00:00:00Z");
    const reservationAt = new Date("2026-08-10T00:00:00Z");

    assert.deepEqual(
      computeReleaseRestore({
        amount: 100,
        reservationSubscriptionAmount: 100,
        reservationPurchasedAmount: 0,
        reservationCreatedAt: reservationAt,
        latestSubscriptionProvisionAt: provisionedAt,
      }),
      { restoreSubscription: 100, restorePurchased: 0, expiredSubscriptionAmount: 0 },
    );
  });

  test("previous-cycle failed reservation does not inflate the new subscription cycle", () => {
    const reservationAt = new Date("2026-07-31T23:55:00Z");
    const renewedAt = new Date("2026-08-01T00:00:00Z");

    assert.deepEqual(
      computeReleaseRestore({
        amount: 100,
        reservationSubscriptionAmount: 100,
        reservationPurchasedAmount: 0,
        reservationCreatedAt: reservationAt,
        latestSubscriptionProvisionAt: renewedAt,
      }),
      { restoreSubscription: 0, restorePurchased: 0, expiredSubscriptionAmount: 100 },
    );
  });

  test("purchased credits survive a subscription renewal and are restored", () => {
    const reservationAt = new Date("2026-07-31T23:55:00Z");
    const renewedAt = new Date("2026-08-01T00:00:00Z");

    assert.deepEqual(
      computeReleaseRestore({
        amount: 120,
        reservationSubscriptionAmount: 70,
        reservationPurchasedAmount: 50,
        reservationCreatedAt: reservationAt,
        latestSubscriptionProvisionAt: renewedAt,
      }),
      { restoreSubscription: 0, restorePurchased: 50, expiredSubscriptionAmount: 70 },
    );
  });

  test("legacy unattributed reservation from an old cycle cannot create fresh credits", () => {
    const reservationAt = new Date("2026-07-31T23:55:00Z");
    const renewedAt = new Date("2026-08-01T00:00:00Z");

    assert.deepEqual(
      computeReleaseRestore({
        amount: 80,
        reservationSubscriptionAmount: 0,
        reservationPurchasedAmount: 0,
        reservationCreatedAt: reservationAt,
        latestSubscriptionProvisionAt: renewedAt,
      }),
      { restoreSubscription: 0, restorePurchased: 0, expiredSubscriptionAmount: 80 },
    );
  });
});
