import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isTopupAmountValid,
  resolveVerifiedCreditAmount,
  resolveVerifiedPlanSlug,
} from "../../lib/payment-validation.js";
import { resolvePurchaseUserId } from "../../lib/provision-purchase.js";

const routesRoot = path.resolve(import.meta.dirname, "..");
const webhookSource = fs.readFileSync(path.join(routesRoot, "webhook.ts"), "utf8");

type PriceStub = {
  planSlug: string;
  amountCents: number;
  creditAmount: number;
};

function fakeStripePriceLookup(price: PriceStub | null) {
  return {
    checkout: {
      sessions: {
        listLineItems: async () => ({
          data: price ? [{ price: { id: "price_stub" } }] : [],
        }),
      },
    },
    subscriptions: {
      retrieve: async () => ({
        metadata: { plan_slug: "metadata-plan", email: "buyer@example.com" },
        items: { data: [{ price: { id: "price_stub" } }] },
      }),
    },
  };
}

test("checkout.session.completed overrides a mismatched metadata plan with the paid price plan", async () => {
  const paidPrice: PriceStub = { planSlug: "pro", amountCents: 2900, creditAmount: 1500 };
  const stripe = fakeStripePriceLookup(paidPrice);
  const lineItems = await (stripe.checkout.sessions.listLineItems as any)("cs_stub", { limit: 5 });
  const paidPriceId = lineItems.data[0]?.price?.id;

  assert.equal(paidPriceId, "price_stub");
  assert.equal(
    resolveVerifiedPlanSlug("basic", paidPrice.planSlug),
    "pro",
    "checkout must provision the plan represented by the paid Stripe price",
  );
  assert.match(webhookSource, /handleCheckoutCompleted[\s\S]*resolveVerifiedPlanSlug/);
});

test("Payment Element subscription overrides a mismatched metadata plan with the paid price plan", async () => {
  const paidPrice: PriceStub = { planSlug: "founder", amountCents: 9900, creditAmount: 5000 };
  const stripe = fakeStripePriceLookup(paidPrice);
  const subscription = await (stripe.subscriptions.retrieve as any)("sub_stub", { expand: ["items"] });

  assert.equal(subscription.items.data[0].price.id, "price_stub");
  assert.equal(resolveVerifiedPlanSlug(subscription.metadata.plan_slug, paidPrice.planSlug), "founder");
  assert.match(webhookSource, /handlePaymentElementSubscriptionCreate[\s\S]*resolveVerifiedPlanSlug/);
});

test("Payment Element topup rejects an amount mismatch before provisioning", () => {
  const paidAmount = 499;
  const configuredAmount = 600;

  assert.equal(isTopupAmountValid(paidAmount, configuredAmount), false);
  assert.match(
    webhookSource,
    /handlePaymentIntentSucceeded[\s\S]*isTopupAmountValid\(paidAmount, priceRow\.amountCents\)[\s\S]*throw new Error/,
  );
});

test("Payment Element topup uses configured credits when metadata credits are stale", () => {
  assert.equal(resolveVerifiedCreditAmount(300, 600), 600);
  assert.equal(resolveVerifiedCreditAmount(600, null), 600);
  assert.match(
    webhookSource,
    /handlePaymentIntentSucceeded[\s\S]*resolveVerifiedCreditAmount\(creditsAmount, priceRow\.creditAmount\)/,
  );
});

test("purchase attribution prefers the stable user ID before email fallback", () => {
  assert.equal(typeof resolvePurchaseUserId, "function");
  assert.match(
    webhookSource,
    /const userId = parseMetadataUserId\(session\.metadata\?\.user_id\)/,
    "Checkout must read user_id metadata",
  );
  assert.match(
    webhookSource,
    /const userId = parseMetadataUserId\(metadata\.user_id\)/,
    "Payment Element subscription must read user_id metadata",
  );
  assert.match(
    webhookSource,
    /const userId\s+=\s+parseMetadataUserId\(metadata\.user_id\)/,
    "Payment Element topups must read user_id metadata",
  );
});
