/**
 * Checkout routes.
 *
 * POST /api/checkout/create-session
 *   body: { planSlug, email?, fullName?, embedded? }
 *   planSlug: 'basic' | 'pro' | 'founder' | 'topup-300' | 'topup-600' | 'topup-1200'
 *
 * New subscriptions and topups use Stripe Checkout Sessions. The preferred UI
 * is Stripe Embedded Checkout inside Reelsona; hosted checkout remains a safe
 * fallback when explicitly requested.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { getStripe, getPlanConfig, getActiveFounderCount } from "../lib/stripe";
import { getAppUrl } from "../lib/email";
import { FOUNDER_MAX_SEATS } from "../lib/credits";
import { db } from "@workspace/db";
import { subscriptionsTable, users as usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { buildCheckoutSessionParams } from "./checkout-logic";

const router = Router();

/**
 * Legacy PaymentIntent endpoint. The current product uses Checkout Sessions for
 * both recurring subscriptions and one-time credit packs so webhook semantics
 * stay consistent.
 */
router.post("/checkout/create-payment-intent", (_req: Request, res: Response): void => {
  res.status(410).json({
    error: "Este endpoint fue reemplazado por Checkout Sessions.",
    code: "legacy_endpoint_removed",
  });
});

router.post("/checkout/create-session", async (req: Request, res: Response): Promise<void> => {
  let { planSlug, email, fullName, embedded = true } = (req.body ?? {}) as {
    planSlug?: string;
    email?: string;
    fullName?: string;
    embedded?: boolean;
  };

  if (!planSlug) {
    res.status(400).json({ error: "Se requiere 'planSlug'", code: "missing_plan" });
    return;
  }

  const validSlugs = ["basic", "pro", "founder", "topup-300", "topup-600", "topup-1200"];
  if (!validSlugs.includes(planSlug)) {
    res.status(400).json({ error: `Plan no válido: ${planSlug}`, code: "invalid_plan" });
    return;
  }

  const authenticatedUserId = req.session?.user?.userId ?? null;

  // Authenticated checkouts always use the account email from DB. Never accept a
  // different destination email from the browser for wallet/subscription crediting.
  if (authenticatedUserId) {
    const [user] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, authenticatedUserId))
      .limit(1);
    email = user?.email ?? undefined;
  }

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Se requiere un email válido para el checkout", code: "invalid_email" });
    return;
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (configErr: any) {
    req.log?.error?.({ err: configErr }, "Stripe not configured for checkout");
    res.status(503).json({ error: "El checkout no está disponible en este momento.", code: "stripe_unavailable" });
    return;
  }

  let planConfig: Awaited<ReturnType<typeof getPlanConfig>>;
  try {
    planConfig = await getPlanConfig(planSlug);
  } catch (err: any) {
    req.log?.error?.({ err, planSlug }, "Failed to load Stripe plan config");
    res.status(500).json({ error: "Error de configuración de plan", code: "plan_config_error" });
    return;
  }

  if (!planConfig) {
    res.status(503).json({
      error: `Plan '${planSlug}' no está configurado todavía.`,
      code: "plan_not_configured",
    });
    return;
  }

  if (planSlug === "founder") {
    const founderCount = await getActiveFounderCount();
    if (founderCount >= FOUNDER_MAX_SEATS) {
      res.status(409).json({
        error: `El plan Founder está agotado (máximo ${FOUNDER_MAX_SEATS} plazas).`,
        code: "founder_sold_out",
        founderSoldOut: true,
      });
      return;
    }
  }

  const isSubscription = planConfig.isRecurring;

  // Existing subscribers MUST change the current Stripe subscription instead of
  // creating a second recurring subscription. The Billing page routes those
  // transitions through /api/billing/change-plan.
  if (isSubscription && authenticatedUserId) {
    const [existingSub] = await db
      .select({ status: subscriptionsTable.status })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, authenticatedUserId))
      .limit(1);

    if (existingSub && ["active", "trialing"].includes(existingSub.status)) {
      res.status(409).json({
        error: "Ya tienes una suscripción activa. Cambia el plan desde Facturación.",
        code: "existing_subscription",
      });
      return;
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  const appUrl = getAppUrl();
  const idempotencyScope = authenticatedUserId
    ? `uid_${authenticatedUserId}`
    : `email_${normalizedEmail.replace(/[^a-z0-9]/g, "_")}`;
  const idempotencyKey = `checkout_${idempotencyScope}_${planSlug}_${embedded ? "embedded" : "hosted"}_${Math.floor(Date.now() / 60_000)}`;

  try {
    const params = buildCheckoutSessionParams({
      planSlug,
      isSubscription,
      priceId: planConfig.stripePriceId,
      email: normalizedEmail,
      fullName,
      creditsAmount: planConfig.creditAmount,
      appUrl,
      embedded,
    });

    const session = await stripe.checkout.sessions.create(params, { idempotencyKey });

    if (embedded) {
      if (!session.client_secret) {
        throw new Error("Stripe Embedded Checkout did not return a client_secret");
      }
      res.json({ clientSecret: session.client_secret, sessionId: session.id, mode: "embedded" });
      return;
    }

    if (!session.url) {
      throw new Error("Stripe hosted checkout did not return a URL");
    }
    res.json({ url: session.url, sessionId: session.id, mode: "hosted" });
  } catch (err: any) {
    req.log?.error?.({ err, planSlug, embedded }, "Failed to create Stripe Checkout Session");
    res.status(502).json({
      error: "No se pudo iniciar el pago. Intenta nuevamente.",
      code: "checkout_session_failed",
    });
  }
});

export default router;
