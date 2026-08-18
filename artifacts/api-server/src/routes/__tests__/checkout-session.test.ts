import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildCheckoutSessionParams } from "../checkout.js";

describe("RC1 Stripe Checkout contract", () => {
  test("embedded subscription returns an embedded Checkout contract", () => {
    const params = buildCheckoutSessionParams({
      planSlug: "pro",
      stripePriceId: "price_pro",
      isSubscription: true,
      email: "user@example.com",
      fullName: "Test User",
      creditsAmount: 1500,
      appUrl: "https://reelsona.com",
      embedded: true,
    });

    assert.equal(params.mode, "subscription");
    assert.equal(params.ui_mode, "embedded");
    assert.equal(params.return_url, "https://reelsona.com/checkout/success?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(params.success_url, undefined);
    assert.equal(params.cancel_url, undefined);
    assert.equal(params.customer_email, "user@example.com");
    assert.equal(params.metadata?.plan_slug, "pro");
    assert.equal(params.metadata?.product, "reelsona_subscription");
  });

  test("embedded topup uses payment mode and an existing Stripe customer when available", () => {
    const params = buildCheckoutSessionParams({
      planSlug: "topup-600",
      stripePriceId: "price_topup_600",
      isSubscription: false,
      email: "user@example.com",
      creditsAmount: 600,
      appUrl: "https://reelsona.com",
      embedded: true,
      stripeCustomerId: "cus_123",
    });

    assert.equal(params.mode, "payment");
    assert.equal(params.ui_mode, "embedded");
    assert.equal(params.customer, "cus_123");
    assert.equal(params.customer_email, undefined);
    assert.equal(params.metadata?.product, "reelsona_topup");
    assert.equal(params.metadata?.credits_amount, "600");
  });

  test("hosted fallback remains valid for older clients", () => {
    const params = buildCheckoutSessionParams({
      planSlug: "basic",
      stripePriceId: "price_basic",
      isSubscription: true,
      email: "user@example.com",
      creditsAmount: 400,
      appUrl: "https://reelsona.com",
      embedded: false,
    });

    assert.equal(params.ui_mode, undefined);
    assert.equal(params.success_url, "https://reelsona.com/checkout/success?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(params.cancel_url, "https://reelsona.com/checkout/cancel");
  });
});
