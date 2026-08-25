import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeRefundCreditReversal, computeRefundedCredits } from "./credits.js";

describe("refunded credit package reconciliation", () => {
  test("reverses only the remaining purchased-credit balance", () => {
    assert.equal(computeRefundCreditReversal(600, 600), 600);
    assert.equal(computeRefundCreditReversal(125, 600), 125);
  });

  test("never reverses subscription credits or creates a negative balance", () => {
    assert.equal(computeRefundCreditReversal(0, 600), 0);
    assert.equal(computeRefundCreditReversal(-10, 600), 0);
    assert.equal(computeRefundCreditReversal(600, -1), 0);
  });

  test("calculates partial refunds against the original package, not the user's aggregate wallet", () => {
    assert.equal(computeRefundedCredits(600, 1000, 250), 150);
    assert.equal(computeRefundedCredits(600, 1000, 500), 300);
    assert.equal(computeRefundedCredits(600, 1000, 1000), 600);
  });

  test("caps refunds and treats repeated smaller events as the same target", () => {
    assert.equal(computeRefundedCredits(600, 1000, 1500), 600);
    assert.equal(computeRefundedCredits(600, 1000, 0), 0);
    assert.equal(computeRefundedCredits(600, 0, 500), 0);
  });
});