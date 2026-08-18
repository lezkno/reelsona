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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves a Stripe PaymentIntent client_secret from a subscription's
 * latest_invoice field, handling three response shapes that Stripe can return:
 *
 *   1. Fully-expanded object  → use directly
 *   2. String invoice ID      → fetch invoice with payment_intent expanded
 *   3. String PI ID on object → fetch PaymentIntent directly
 *
 * Case 2 occurs when Stripe replays an idempotency-key-cached response that
 * was originally created without the `expand` parameter (the root cause of the
 * "Stripe did not return a client_secret" production error).
 *
 * Returns null when there is no actionable PaymentIntent (e.g. zero-amount
 * first invoice from a trial period or a customer credit covering the full
 * amount).  The caller must handle null explicitly.
 */
async function resolveInvoicePaymentIntentSecret(
  stripe: ReturnType<typeof getStripe>,
  latestInvoiceRaw: unknown,
): Promise<{ secret: string; piId: string } | null> {
  if (!latestInvoiceRaw) return null;

  // Resolve invoice object — may arrive as a string ID when replay has no expand
  let invoice: Record<string, any>;
  if (typeof latestInvoiceRaw === "string") {
    // Fetch with payment_intent expanded so we get the full object in one call
    invoice = await stripe.invoices.retrieve(latestInvoiceRaw as string, {
      expand: ["payment_intent"],
    }) as unknown as Record<string, any>;
  } else {
    invoice = latestInvoiceRaw as Record<string, any>;
  }

  // If the invoice object is present but payment_intent is null/undefined,
  // explicitly re-fetch the invoice. This handles the case where:
  //   (a) The expand worked but the PI wasn't created yet (async creation in
  //       API v2026-07-29.dahlia when payment_method_types is unspecified), or
  //   (b) A cached idempotency response returned the invoice without PI data.
  // A re-fetch will reflect the current PI state from Stripe.
  if (!invoice?.payment_intent && invoice?.id && typeof invoice.id === "string") {
    invoice = await stripe.invoices.retrieve(invoice.id as string, {
      expand: ["payment_intent"],
    }) as unknown as Record<string, any>;
  }

  const piRaw = invoice?.payment_intent;
  if (!piRaw) return null; // truly no PI (trial, send_invoice collection method, etc.)

  // Resolve PI — may also arrive as a string ID
  let pi: Record<string, any>;
  if (typeof piRaw === "string") {
    pi = await stripe.paymentIntents.retrieve(piRaw as string) as unknown as Record<string, any>;
  } else {
    pi = piRaw as Record<string, any>;
  }

  if (!pi?.client_secret) return null;
  // Succeeded / canceled PIs no longer accept confirmation — skip them
  if (pi.status === "succeeded" || pi.status === "canceled") return null;

  return { secret: pi.client_secret as string, piId: pi.id as string };
}

/**
 * POST /api/checkout/create-payment-intent
 *
 * Creates a Stripe Subscription (recurring) or PaymentIntent (topups) and
 * returns the clientSecret for mounting Stripe Payment Element on the frontend.
 *
 * This is the modern embedded-checkout path. The UI mounts Elements +
 * PaymentElement using this secret; payment confirmation triggers:
 *   - Subscriptions: invoice.paid (billing_reason=subscription_create) webhook
 *   - Topups:        payment_intent.succeeded webhook
 *
 * NOTE: Stripe Dashboard webhook endpoint must include payment_intent.succeeded
 * in addition to the existing events for topup provisioning to work.
 */
router.post("/checkout/create-payment-intent", async (req: Request, res: Response): Promise<void> => {
  const { planSlug, email: bodyEmail, fullName } = (req.body ?? {}) as {
    planSlug?: string;
    email?: string;
    fullName?: string;
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
  let email = bodyEmail ?? "";
  let stripeCustomerId: string | null = null;

  // ── Topups require an authenticated account ──────────────────────────────────
  // Credits are account-scoped; an unauthenticated caller cannot reliably be
  // provisioned credits, and the topup payment would be unattributable.
  if (planSlug.startsWith("topup") && !userId) {
    res.status(401).json({
      error:   "authentication_required",
      message: "Inicia sesión para comprar créditos adicionales.",
    });
    return;
  }

  if (userId) {
    const [[user], [sub]] = await Promise.all([
      db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1),
      db.select({
        stripeCustomerId: subscriptionsTable.stripeCustomerId,
        status:           subscriptionsTable.status,
        planSlug:         subscriptionsTable.planSlug,
      }).from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)).limit(1),
    ]);
    email = user?.email ?? email;
    stripeCustomerId = sub?.stripeCustomerId ?? null;

    // Prevent duplicate subscriptions for authenticated active subscribers.
    // Same rule as create-session: Founder upgrade is always allowed.
    if (sub && ["active", "trialing"].includes(sub.status ?? "") && !planSlug.startsWith("topup")) {
      const founderUpgradeAllowed = planSlug === "founder" && sub.planSlug !== "founder";
      if (!founderUpgradeAllowed) {
        res.status(409).json({
          error:   "existing_subscription",
          message: sub.planSlug === "founder" && planSlug === "founder"
            ? "Ya tienes el plan Founder activo."
            : "Ya tienes una suscripción activa. Usa el cambio de plan desde Facturación.",
        });
        return;
      }
    }
  }

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Se requiere un email válido para el checkout" });
    return;
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (configErr: any) {
    console.error("[checkout/create-payment-intent] Stripe not configured:", configErr.message);
    const isDev = process.env.NODE_ENV !== "production";
    res.status(503).json({
      error:   "El checkout no está disponible en este momento.",
      code:    "stripe_not_configured",
      devHint: isDev
        ? "Estás en el entorno de desarrollo. Para procesar pagos reales abre la app publicada (Deployments). Si quieres probar aquí con tu clave live, añade la variable de entorno ALLOW_LIVE_STRIPE_IN_NONPROD=true."
        : undefined,
    });
    return;
  }

  if (planSlug === "founder") {
    const founderCount = await getActiveFounderCount();
    if (founderCount >= FOUNDER_MAX_SEATS) {
      res.status(409).json({ error: `El plan Founder está agotado (máximo ${FOUNDER_MAX_SEATS} plazas).`, founderSoldOut: true });
      return;
    }
  }

  const planConfig = await getPlanConfig(planSlug).catch((err: any) => {
    console.error("[checkout/create-payment-intent] Error loading plan config:", err?.message);
    return null;
  });
  if (!planConfig) {
    res.status(503).json({ error: `Plan '${planSlug}' no está configurado todavía.` });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const metadata: Record<string, string> = {
    plan_slug:      planSlug,
    email:          normalizedEmail,
    full_name:      (fullName ?? "").trim(),
    credits_amount: String(planConfig.creditAmount),
    product:        planConfig.isRecurring ? "reelsona_subscription" : "reelsona_topup",
  };

  // ── Idempotency bucket ───────────────────────────────────────────────────────
  // 10-minute window: repeated calls within the window return the same Stripe
  // object instead of creating duplicate subscriptions / payment intents.
  const idemBucket = Math.floor(Date.now() / 600_000);

  try {
    // ── Customer resolution ──────────────────────────────────────────────────
    // Security invariant: NEVER look up a Stripe customer by email for anonymous
    // callers. Reusing an existing customer would let an attacker who knows a
    // victim's email attach incomplete subscriptions to their Stripe account and
    // enumerate saved payment methods.
    //
    // - Authenticated user with known stripeCustomerId → use it directly.
    // - Everyone else → always create a new Stripe customer.
    //   For anonymous signups within the same 10-min window and same email+plan
    //   the idempotency key returns the same customer (prevents duplicate orphan
    //   customers from rapid form re-submits).
    let customerId: string;

    if (stripeCustomerId) {
      // Authenticated user — persisted, ownership already verified via session.
      customerId = stripeCustomerId;
    } else {
      // New subscriber (anonymous or authenticated before first purchase).
      const customerIdempotencyKey = userId
        ? `new-customer-uid-${userId}-${idemBucket}`
        : `new-customer-email-${Buffer.from(normalizedEmail).toString("base64url")}-${planSlug}-${idemBucket}`;
      const newCustomer = await stripe.customers.create(
        { email: normalizedEmail, name: (fullName ?? "").trim() || undefined },
        { idempotencyKey: customerIdempotencyKey },
      );
      customerId = newCustomer.id;
    }

    if (planConfig.isRecurring) {
      // ── Subscription via Payment Element ────────────────────────────────
      //
      // For users with a known Stripe customer (returning / authenticated), try
      // to reuse an existing incomplete subscription for this price rather than
      // creating a new one. This covers the "user went back and re-opened the
      // modal" case and prevents stale incomplete-subscription accumulation.
      // ── Step 1: reuse an existing incomplete subscription if available ─────
      // This avoids accumulating multiple incomplete subscriptions when the
      // user opens the modal more than once. We use the explicit helper so the
      // PI is always resolved correctly even when Stripe returns a string ID.
      if (stripeCustomerId) {
        const existingList = await stripe.subscriptions.list({
          customer: customerId,
          status:   "incomplete",
          expand:   ["data.latest_invoice.payment_intent"],
          limit:    5,
        });
        for (const sub of existingList.data) {
          const priceMatch = sub.items.data.some(
            (item: { price: { id: string } }) => item.price.id === planConfig.stripePriceId,
          );
          if (priceMatch) {
            const resolved = await resolveInvoicePaymentIntentSecret(stripe, sub.latest_invoice);
            if (resolved) {
              console.info(`[checkout/create-payment-intent] Reusing incomplete subscription ${sub.id} pi=${resolved.piId}`);
              res.json({ clientSecret: resolved.secret, type: "subscription", customerId });
              return;
            }
          }
        }
      }

      // ── Step 2: create a new subscription ───────────────────────────────
      // Idempotency key: prefix is versioned (pe-sub-v5) so deploying a new
      // version with different expand params never replays an old cached
      // response that lacks the expanded payment_intent.
      const subIdempotencyKey = userId
        ? `pe-sub-v5-uid-${userId}-${planSlug}-${idemBucket}`
        : `pe-sub-v5-cid-${customerId}-${planSlug}-${idemBucket}`;

      const subscription = await stripe.subscriptions.create(
        {
          customer:            customerId,
          items:               [{ price: planConfig.stripePriceId }],
          payment_behavior:    "default_incomplete",
          collection_method:   "charge_automatically",
          payment_settings: {
            save_default_payment_method: "on_subscription",
            // Must specify payment_method_types explicitly in API v2026-07-29.dahlia
            // or Stripe does not create a PaymentIntent for the initial invoice.
            payment_method_types: ["card", "link"],
          },
          expand:   ["latest_invoice.payment_intent"],
          metadata,
        },
        { idempotencyKey: subIdempotencyKey },
      );

      // ── Step 3: resolve the client_secret with explicit fallbacks ────────
      // resolveInvoicePaymentIntentSecret handles all three shapes Stripe can
      // return for latest_invoice.payment_intent (full object / invoice ID /
      // PI ID string) by fetching the missing pieces explicitly.
      const resolved = await resolveInvoicePaymentIntentSecret(stripe, subscription.latest_invoice);

      if (!resolved) {
        // Diagnostic log — never log client_secret or API key
        const inv = subscription.latest_invoice as any;
        console.error("[checkout/create-payment-intent] No actionable PaymentIntent found", {
          subscriptionId:     subscription.id,
          subscriptionStatus: subscription.status,
          latestInvoiceShape: typeof inv,
          latestInvoiceId:    typeof inv === "string" ? inv : inv?.id,
          invoiceStatus:      typeof inv !== "string" ? inv?.status : undefined,
          invoiceAmountDue:   typeof inv !== "string" ? inv?.amount_due : undefined,
          piShape:            typeof inv !== "string" ? typeof inv?.payment_intent : undefined,
        });
        res.status(422).json({
          error: "No se pudo iniciar el pago con Stripe.",
          code:  "payment_intent_unavailable",
          message: process.env.NODE_ENV === "production"
            ? "Error al iniciar el pago. Inténtalo de nuevo."
            : `Subscription ${subscription.id} status='${subscription.status}' returned no actionable PaymentIntent. ` +
              `Check plan trial settings or zero-amount first invoice. Invoice type: ${typeof inv}`,
        });
        return;
      }

      res.json({ clientSecret: resolved.secret, type: "subscription", customerId });
    } else {
      // ── One-time topup via Payment Element ──────────────────────────────
      // Topups require authentication (checked above), so customerId is always
      // from the persisted stripeCustomerId or a fresh customer for the userId.
      const piIdempotencyKey = `topup-uid-${userId}-${planSlug}-${idemBucket}`;

      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount:                    planConfig.amountCents,
          currency:                  "usd",
          customer:                  customerId,
          automatic_payment_methods: { enabled: true },
          metadata,
        },
        { idempotencyKey: piIdempotencyKey },
      );

      if (!paymentIntent.client_secret) {
        throw new Error("Stripe did not return a client_secret for the PaymentIntent");
      }

      res.json({ clientSecret: paymentIntent.client_secret, type: "payment", customerId });
    }
  } catch (err: any) {
    console.error("[checkout/create-payment-intent]", err?.message);
    res.status(502).json({
      error:   "No se pudo iniciar el pago con Stripe.",
      message: process.env.NODE_ENV === "production"
        ? "Error al iniciar el pago. Inténtalo de nuevo."
        : err?.message,
    });
  }
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
      // keep return_url for redirect-based payment methods (e.g. bank redirects)
      return_url: `${args.appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      // "if_required" means Stripe only redirects when the payment method needs it
      // (e.g. bank redirects); card payments complete inside the embedded form.
      redirect_on_completion: "if_required",
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

  // Never create a second Basic/Pro subscription for an authenticated active
  // subscriber — those must go through the change-plan endpoint. Founder is the
  // exception: an active Basic/Pro subscriber may buy Founder (the old
  // subscription is cancelled after the Founder purchase is provisioned), but a
  // user who is ALREADY Founder can never buy Founder again.
  if (isSubscription && userId) {
    const [existingSub] = await db
      .select({ status: subscriptionsTable.status, planSlug: subscriptionsTable.planSlug })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    if (existingSub && ["active", "trialing"].includes(existingSub.status)) {
      const founderUpgradeAllowed = planSlug === "founder" && existingSub.planSlug !== "founder";
      if (!founderUpgradeAllowed) {
        res.status(409).json({
          error: "existing_subscription",
          code: "existing_subscription",
          currentPlan: existingSub.planSlug,
          message: existingSub.planSlug === "founder" && planSlug === "founder"
            ? "Ya tienes el plan Founder activo."
            : "Ya tienes una suscripción activa. Usa el cambio de plan de Facturación.",
        });
        return;
      }
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
