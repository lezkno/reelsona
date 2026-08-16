/**
 * Checkout routes.
 *
 * POST /api/checkout/create-session
 *   body: { planSlug, email?, fullName?, embedded? }
 *   planSlug: 'basic' | 'pro' | 'founder' | 'topup-300' | 'topup-600' | 'topup-1200'
 *
 * POST /api/checkout/create-payment-intent  (legacy — kept for old PaymentElement form)
 *
 * Founder plan: checked server-side for ≤ FOUNDER_MAX_SEATS active subscriptions
 * before creating a checkout session.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { getStripe, getPlanConfig, getActiveFounderCount, getPriceId, getToolAccessDays } from "../lib/stripe";
import { getAppUrl } from "../lib/email";
import { FOUNDER_MAX_SEATS } from "../lib/credits";

const router = Router();

/**
 * POST /api/checkout/create-payment-intent
 *
 * Legacy: Creates a Stripe PaymentIntent for the old custom PaymentElement form.
 * Reads STRIPE_PRICE_ID_PROGRAM env var.  Still works, not removed yet.
 */
router.post("/checkout/create-payment-intent", async (req: Request, res: Response): Promise<void> => {
  let stripe: ReturnType<typeof getStripe>;
  let priceId: string;
  try {
    stripe  = getStripe();
    priceId = getPriceId();
  } catch (configErr: any) {
    console.error("[checkout/create-payment-intent] Stripe not configured:", configErr.message);
    res.status(503).json({ error: "El checkout no está disponible en este momento." });
    return;
  }

  const toolAccessDays = getToolAccessDays();

  try {
    const price = await stripe.prices.retrieve(priceId);
    if (!price.unit_amount) {
      res.status(500).json({ error: "No se pudo determinar el precio." });
      return;
    }

    const intent = await stripe.paymentIntents.create({
      amount:   price.unit_amount,
      currency: price.currency,
      automatic_payment_methods: { enabled: true },
      metadata: {
        product:          "reelsona_program",
        tool_access_days: String(toolAccessDays),
      },
    });

    res.json({ clientSecret: intent.client_secret });
  } catch (err: any) {
    console.error("[checkout/create-payment-intent]", err?.message);
    res.status(500).json({ error: "No se pudo crear la sesión de pago" });
  }
});

/**
 * POST /api/checkout/create-session
 *
 * Creates a Stripe Checkout Session for:
 *   - Subscription plans  (basic / pro / founder) — mode: 'subscription'
 *   - One-time topups     (topup-300 / 600 / 1200) — mode: 'payment'
 *
 * Returns: { clientSecret }  for embedded checkout,
 *          { url }           for hosted checkout.
 */
router.post("/checkout/create-session", async (req: Request, res: Response): Promise<void> => {
  const { planSlug, email, fullName, embedded } = (req.body ?? {}) as {
    planSlug?: string;
    email?:    string;
    fullName?: string;
    embedded?: boolean;
  };

  if (!planSlug) {
    res.status(400).json({ error: "Se requiere 'planSlug'" });
    return;
  }

  const validSlugs = ["basic", "pro", "founder", "topup-300", "topup-600", "topup-1200"];
  if (!validSlugs.includes(planSlug)) {
    res.status(400).json({ error: `Plan no válido: ${planSlug}` });
    return;
  }

  if (!embedded && (!email || !email.includes("@"))) {
    res.status(400).json({ error: "Se requiere un email válido para checkout alojado" });
    return;
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (configErr: any) {
    console.error("[checkout/create-session] Stripe not configured:", configErr.message);
    res.status(503).json({ error: "El checkout no está disponible en este momento." });
    return;
  }

  // Load plan config from DB
  let planConfig: Awaited<ReturnType<typeof getPlanConfig>>;
  try {
    planConfig = await getPlanConfig(planSlug);
  } catch (err: any) {
    console.error("[checkout/create-session] Error loading plan config:", err.message);
    res.status(500).json({ error: "Error de configuración de plan" });
    return;
  }

  if (!planConfig) {
    res.status(503).json({ error: `Plan '${planSlug}' no está configurado todavía. El administrador debe ejecutar el setup de Stripe primero.` });
    return;
  }

  // Founder seat check
  if (planSlug === "founder") {
    const founderCount = await getActiveFounderCount();
    if (founderCount >= FOUNDER_MAX_SEATS) {
      res.status(409).json({
        error: `El plan Founder está agotado (máximo ${FOUNDER_MAX_SEATS} plazas). Elige otro plan.`,
        founderSoldOut: true,
      });
      return;
    }
  }

  const isSubscription = planConfig.isRecurring;
  const appUrl = getAppUrl();

  try {
    const metadata: Record<string, string> = {
      plan_slug:        planSlug,
      product:          isSubscription ? "reelsona_subscription" : "reelsona_topup",
      full_name:        (fullName ?? "").trim(),
      credits_amount:   String(planConfig.creditAmount),
    };

    if (embedded) {
      const session = await stripe.checkout.sessions.create({
        mode:      isSubscription ? "subscription" : "payment",
        line_items: [{ price: planConfig.stripePriceId, quantity: 1 }],
        ui_mode:   "embedded_page",
        return_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        metadata,
        ...(isSubscription ? {
          subscription_data: { metadata },
        } : {}),
      });
      res.json({ clientSecret: session.client_secret });
    } else {
      const session = await stripe.checkout.sessions.create({
        mode:           isSubscription ? "subscription" : "payment",
        customer_email: email!.trim().toLowerCase(),
        line_items:     [{ price: planConfig.stripePriceId, quantity: 1 }],
        metadata,
        success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${appUrl}/checkout/cancel`,
        ...(isSubscription ? {
          subscription_data: { metadata },
        } : {}),
      });
      res.json({ url: session.url });
    }
  } catch (err: any) {
    console.error("[checkout/create-session]", err?.message);
    res.status(500).json({ error: "No se pudo crear la sesión de pago" });
  }
});

export default router;
