import type Stripe from "stripe";

export interface CheckoutSessionParamsInput {
  planSlug: string;
  isSubscription: boolean;
  priceId: string;
  email: string;
  fullName?: string;
  creditsAmount: number;
  appUrl: string;
  embedded: boolean;
  userId?: number | null;
}

/** Returns true only when Stripe secret/publishable keys belong to the same mode. */
export function stripeKeyModesCompatible(secretKey?: string | null, publishableKey?: string | null): boolean {
  const sk = secretKey?.trim() ?? "";
  const pk = publishableKey?.trim() ?? "";
  if (!sk || !pk) return false;
  const secretMode = sk.startsWith("sk_live_") ? "live" : sk.startsWith("sk_test_") ? "test" : null;
  const publicMode = pk.startsWith("pk_live_") ? "live" : pk.startsWith("pk_test_") ? "test" : null;
  return secretMode !== null && secretMode === publicMode;
}

/**
 * Build Stripe Checkout Session params without touching Express/DB so the
 * monetization contract can be regression-tested independently.
 */
export function buildCheckoutSessionParams(input: CheckoutSessionParamsInput): Stripe.Checkout.SessionCreateParams {
  const metadata: Record<string, string> = {
    plan_slug: input.planSlug,
    product: input.isSubscription ? "reelsona_subscription" : "reelsona_topup",
    full_name: (input.fullName ?? "").trim(),
    credits_amount: String(input.creditsAmount),
  };
  if (input.userId != null) metadata.user_id = String(input.userId);

  const common: Stripe.Checkout.SessionCreateParams = {
    mode: input.isSubscription ? "subscription" : "payment",
    customer_email: input.email.trim().toLowerCase(),
    line_items: [{ price: input.priceId, quantity: 1 }],
    metadata,
    ...(input.isSubscription ? { subscription_data: { metadata } } : {}),
  };

  if (input.embedded) {
    return {
      ...common,
      ui_mode: "embedded",
      return_url: `${input.appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      redirect_on_completion: "always",
    };
  }

  return {
    ...common,
    success_url: `${input.appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.appUrl}/checkout/cancel`,
  };
}
