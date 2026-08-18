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
