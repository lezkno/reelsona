/**
 * Checkout routes for Reelsona RC1.
 *
 * POST /api/checkout/create-session
 *   body: { planSlug, email?, fullName?, embedded? }
 *
 * New subscriptions and one-time credit topups use Stripe Checkout Sessions.
 * The production UI requests embedded=true so Stripe mounts inside Reelsona.
 * Hosted checkout remains as a backwards-compatible fallback for old clients.
 *
 * IMPORTANT: authenticated users with an active subscription must use
 * /api/billing/change-plan. We never create a second subscription for them.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe, getPlanConfig, getActiveFounderCount } from "../lib/stripe";
import { getAppUrl } from "../lib/email";
import { FOUNDER_MAX_SEATS } from "../lib/credits";
import { db } from "@workspace/db";
import { subscriptionsTable, users as usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/** Legacy PaymentIntent flow was a different product architecture. */
router.post("/checkout/create-payment-intent", (_req: Request, res: Response): void => {
  res.status(410).json({
    error: "Este endpoint fue removido. Usa Checkout Sessions.",
    code: "legacy_endpoint_removed",
  });
});

export function buildCheckoutSessionParams(args: {
  planSlug: string;
  stripePriceId: string;
  isSubscription: boolean;
  email: string;
  fullName?: string;
  creditsAmount: number;
  appUrl: string;
  embedded: boolean;
  stripeCustomerId?: string | null;
}): Stripe.Checkout.SessionCreateParams {
  const metadata: Record<string, string> = {
    plan_slug: args.planSlug,
    product: args.isSubscription ? "reelsona_subscription" : "reelsona_topup",
    full_name: (args.fullName ?? "").trim(),
    credits_amount: String(args.creditsAmount),
  };

  const customerIdentity: Pick<Stripe.Checkout.SessionCreateParams, "customer" | "customer_email"> =
    args.stripeCustomerId
      ? { customer: args.stripeCustomerId }
      : { customer_email: args.email.trim().toLowerCase() };

  const common: Stripe.Checkout.SessionCreateParams = {
    mode: args.isSubscription ? "subscription" : "payment",
    line_items: [{ price: args.stripePriceId, quantity: 1 }],
    metadata,
    locale: "es-419",
    ...customerIdentity,
    ...(args.isSubscription ? { subscription_data: { metadata } } : {}),
  };

  if (args.embedded) {
    return {
      ...common,
      ui_mode: "embedded",
      return_url: `${args.appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      redirect_on_completion: "always",
    };
  }

  return {
    ...common,
    success_url: `${args.appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${args.appUrl}/checkout/cancel`,
  };
}

router.post("/checkout/create-session", async (req: Request, res: Response): Promise<void> => {
  let { planSlug, email, fullName, embedded } = (req.body ?? {}) as {
    planSlug?: string;
    email?: string;
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

  const userId = req.session?.user?.userId ?? null;
  let stripeCustomerId: string | null = null;

  if (userId) {
    const [[user], [sub]] = await Promise.all([
      db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1),
      db.select({
        status: subscriptionsTable.status,
        stripeCustomerId: subscriptionsTable.stripeCustomerId,
      }).from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)).limit(1),
    ]);
    email = user?.email ?? undefined;
    stripeCustomerId = sub?.stripeCustomerId ?? null;
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

  const planConfig = await getPlanConfig(planSlug).catch((err: any) => {
    console.error("[checkout/create-session] Error loading plan config:", err?.message);
    return null;
  });

  if (!planConfig) {
    res.status(503).json({ error: `Plan '${planSlug}' no está configurado todavía.` });
    return;
  }

  if (planSlug === "founder") {
    const founderCount = await getActiveFounderCount();
    if (founderCount >= FOUNDER_MAX_SEATS) {
      res.status(409).json({
        error: `El plan Founder está agotado (máximo ${FOUNDER_MAX_SEATS} plazas).`,
        founderSoldOut: true,
      });
      return;
    }
  }

  const isSubscription = planConfig.isRecurring;

  // Never create a second subscription for an authenticated active subscriber.
  if (isSubscription && userId) {
    const [existingSub] = await db
      .select({ status: subscriptionsTable.status, planSlug: subscriptionsTable.planSlug })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    if (existingSub && ["active", "trialing"].includes(existingSub.status)) {
      res.status(409).json({
        error: "existing_subscription",
        code: "existing_subscription",
        currentPlan: existingSub.planSlug,
        message: "Ya tienes una suscripción activa. Usa el cambio de plan de Facturación.",
      });
      return;
    }
  }

  const appUrl = getAppUrl();
  const useEmbedded = embedded !== false;

  try {
    const idempotencyScope = userId
      ? `uid_${userId}`
      : `email_${email.trim().toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    const idempotencyKey = `checkout_${idempotencyScope}_${planSlug}_${Math.floor(Date.now() / 60_000)}`;

    const params = buildCheckoutSessionParams({
      planSlug,
      stripePriceId: planConfig.stripePriceId,
      isSubscription,
      email,
      fullName,
      creditsAmount: planConfig.creditAmount,
      appUrl,
      embedded: useEmbedded,
      stripeCustomerId,
    });

    const session = await stripe.checkout.sessions.create(params, { idempotencyKey });

    if (useEmbedded) {
      if (!session.client_secret) {
        throw new Error("Stripe did not return a client_secret for embedded checkout");
      }
      res.json({ clientSecret: session.client_secret, sessionId: session.id, embedded: true });
      return;
    }

    if (!session.url) throw new Error("Stripe did not return a hosted checkout URL");
    res.json({ url: session.url, sessionId: session.id, embedded: false });
  } catch (err: any) {
    console.error("[checkout/create-session]", err?.message);
    res.status(502).json({
      error: "No se pudo iniciar el pago con Stripe.",
      code: "stripe_checkout_error",
      detail: process.env.NODE_ENV === "production" ? undefined : err?.message,
    });
  }
});

export default router;
