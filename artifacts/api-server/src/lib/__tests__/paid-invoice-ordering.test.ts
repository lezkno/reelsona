import test from "node:test";
import assert from "node:assert/strict";
import { getPaidInvoiceOrderPolicy } from "../paid-invoice-ordering.js";

test("a delayed paid invoice still grants credits without regressing newer subscription state", () => {
  const result = getPaidInvoiceOrderPolicy({
    eventCreated: 1_790_490_530,
    lastSubscriptionEventAt: new Date(1_790_490_531 * 1000),
    invoicePeriodEnd: new Date("2026-10-24T01:21:37.000Z"),
    currentPeriodEnd: new Date("2026-10-24T01:21:37.000Z"),
  });

  assert.equal(result.grantCredits, true);
  assert.equal(result.updateSubscriptionState, false);
  assert.equal(result.updatePeriodEnd, false);
});

test("a newer paid invoice can advance subscription state and period", () => {
  const result = getPaidInvoiceOrderPolicy({
    eventCreated: 1_790_490_532,
    lastSubscriptionEventAt: new Date(1_790_490_531 * 1000),
    invoicePeriodEnd: new Date("2026-10-24T01:21:37.000Z"),
    currentPeriodEnd: new Date("2026-09-24T01:21:37.000Z"),
  });

  assert.equal(result.grantCredits, true);
  assert.equal(result.updateSubscriptionState, true);
  assert.equal(result.updatePeriodEnd, true);
});