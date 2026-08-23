import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { computeRefundCreditReversal } from "./credits.js";

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
});