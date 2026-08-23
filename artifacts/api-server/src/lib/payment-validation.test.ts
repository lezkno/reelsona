import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isTopupAmountValid,
  resolveVerifiedCreditAmount,
  resolveVerifiedPlanSlug,
} from "./payment-validation.js";

describe("Stripe payment guardrails", () => {
  test("uses the plan mapped to the actually paid Stripe price", () => {
    assert.equal(resolveVerifiedPlanSlug("basic", "pro"), "pro");
  });

  test("keeps metadata plan when no configured price match exists", () => {
    assert.equal(resolveVerifiedPlanSlug("pro", null), "pro");
  });

  test("uses configured credits instead of stale metadata", () => {
    assert.equal(resolveVerifiedCreditAmount(400, 1500), 1500);
  });

  test("accepts only an exact topup amount", () => {
    assert.equal(isTopupAmountValid(1200, 1200), true);
    assert.equal(isTopupAmountValid(1199, 1200), false);
    assert.equal(isTopupAmountValid(0, 1200), false);
  });
});