/**
 * Checkout routes.
 *
 * POST /api/checkout/create-session
 *   body: { planSlug, email?, fullName? }
 *   planSlug: 'basic' | 'pro' | 'founder' | 'topup-300' | 'topup-600' | 'topup-1200'
 *
 * POST /api/checkout/create-payment-intent  (legacy — kept for old PaymentElement form)
 *
 * Founder plan: checked server-side for ≤ FOUNDER_MAX_SEATS active subscriptions
 * before creating a checkout session.
 *
 * NOTE: Stripe Embedded Checkout (ui_mode: "embedded_page") requires the account
 * owner to enable it in the Stripe Dashboard → Settings → Checkout. Until that is
 * done we use standard hosted checkout which always works and returns a redirect URL.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { getStripe, getPlanConfig, getActiveFounderCount } from "../lib/stripe";
import { getAppUrl } from "../lib/email";
import { FOUNDER_MAX_SEATS } from "../lib/credits";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db/schema";
import { users as usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/**
 * POST /api/checkout/create-payment-intent — REMOVED (legacy program product).
 * Returns 410 Gone so old clients get a clear error instead of hanging.
 */
router.post("/checkout/create-payment-intent", (_req: Request, res: Response): void => {
  res.status(410).json({
    error: "Este endpoint fue removido. El producto original ya no está disponible.",
    code:  "legacy_endpoint_removed",
  });
});

/**
 * POST /api/checkout/create-session
 *
 * Creates a Stripe Checkout Session for:
 *   - Subscription plans  (basic / pro / founder) — mode: 'subscription'
 *   - One-time topups     (topup-300 / 600 / 1200) — mode: 'payment'
 *
 * Returns: { url }  — redirect the browser to this Stripe-hosted checkout URL.
 *
 * If the caller is authenticated and does not provide an email, the user's
 * stored email is looked up from the database automatically.
 */
router.post("/checkout/create-session", async (req: Request, res: Response): Promise<void> => {
  let { planSlug, email, fullName } = (req.body ?? {}) as {
    planSlug?: string;
    email?:    string;
    fullName?: string;
    embedded?: boolean; // accepted but ignored — we always use hosted checkout
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

  // For authenticated users without a provided email, look it up from the DB.
  if (!email && req.session?.user?.userId) {
    const [user] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.user.userId))
      .limit(1);
    email = user?.email ?? undefined;
  }

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Se requiere un email válido para el checkout" });
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

  // Block authenticated users from creating a second subscription.
  // Top-ups (isSubscription=false) are always allowed.
  // Unauthenticated users (landing / initial signup) pass through normally.
  if (isSubscription && req.session?.user?.userId) {
    const userId = req.session.user.userId;
    const [existingSub] = await db
      .select({ status: subscriptionsTable.status })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    if (existingSub && ["active", "trialing"].includes(existingSub.status)) {
      res.status(400).json({
        error: "existing_subscription",
        message: "Ya tenés una suscripción activa. Usá Facturación → Cambiar plan para modificarla.",
      });
      return;
    }
  }

  const appUrl = getAppUrl();

  try {
    const metadata: Record<string, string> = {
      plan_slug:      planSlug,
      product:        isSubscription ? "reelsona_subscription" : "reelsona_topup",
      full_name:      (fullName ?? "").trim(),
      credits_amount: String(planConfig.creditAmount),
    };

    // Hosted checkout — always works regardless of Stripe account settings.
    const session = await stripe.checkout.sessions.create({
      mode:           isSubscription ? "subscription" : "payment",
      customer_email: email.trim().toLowerCase(),
      line_items:     [{ price: planConfig.stripePriceId, quantity: 1 }],
      metadata,
      success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/checkout/cancel`,
      ...(isSubscription ? {
        subscription_data: { metadata },
      } : {}),
    });

    res.json({ url: session.url });
  } catch (err: any) {
    console.error("[checkout/create-session]", err?.message);
    res.status(500).json({ error: "No se pudo crear la sesión de pago" });
  }
});

export default router;
