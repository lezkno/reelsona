import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildCheckoutSessionParams, stripeKeyModesCompatible } from "../checkout-logic.js";

describe("stripeKeyModesCompatible", () => {
  test("accepts matching live keys", () => {
    assert.equal(stripeKeyModesCompatible("sk_live_secret", "pk_live_public"), true);
  });

  test("accepts matching test keys", () => {
    assert.equal(stripeKeyModesCompatible("sk_test_secret", "pk_test_public"), true);
  });

  test("rejects mixed live/test keys and missing keys", () => {
    assert.equal(stripeKeyModesCompatible("sk_live_secret", "pk_test_public"), false);
    assert.equal(stripeKeyModesCompatible("sk_test_secret", "pk_live_public"), false);
    assert.equal(stripeKeyModesCompatible("sk_live_secret", null), false);
  });
});

describe("buildCheckoutSessionParams", () => {
  test("creates embedded subscription checkout for landing plans", () => {
    const params = buildCheckoutSessionParams({
      planSlug: "pro",
      isSubscription: true,
      priceId: "price_pro",
      email: "USER@Example.com",
      fullName: "Test User",
      creditsAmount: 1500,
      appUrl: "https://reelsona.com",
      embedded: true,
    });

    assert.equal(params.mode, "subscription");
    assert.equal(params.ui_mode, "embedded");
    assert.equal(params.customer_email, "user@example.com");
    assert.equal(params.return_url, "https://reelsona.com/checkout/success?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(params.success_url, undefined);
    assert.equal(params.cancel_url, undefined);
    assert.equal(params.line_items?.[0]?.price, "price_pro");
    assert.equal(params.metadata?.plan_slug, "pro");
    assert.equal(params.subscription_data?.metadata?.plan_slug, "pro");
  });

  test("creates embedded one-time checkout for credit topups", () => {
    const params = buildCheckoutSessionParams({
      planSlug: "topup-600",
      isSubscription: false,
      priceId: "price_topup_600",
      email: "user@example.com",
      creditsAmount: 600,
      appUrl: "https://reelsona.com",
      embedded: true,
    });

    assert.equal(params.mode, "payment");
    assert.equal(params.ui_mode, "embedded");
    assert.equal(params.metadata?.product, "reelsona_topup");
    assert.equal(params.metadata?.credits_amount, "600");
    assert.equal(params.subscription_data, undefined);
  });

  test("keeps hosted checkout as explicit fallback", () => {
    const params = buildCheckoutSessionParams({
      planSlug: "basic",
      isSubscription: true,
      priceId: "price_basic",
      email: "user@example.com",
      creditsAmount: 400,
      appUrl: "https://reelsona.com",
      embedded: false,
    });

    assert.equal(params.ui_mode, undefined);
    assert.equal(params.success_url, "https://reelsona.com/checkout/success?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(params.cancel_url, "https://reelsona.com/checkout/cancel");
    assert.equal(params.return_url, undefined);
  });
});
