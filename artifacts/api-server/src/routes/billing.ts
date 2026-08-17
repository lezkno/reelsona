/**
 * Billing routes — authenticated, read/write.
 *
 * GET  /api/billing          — current plan, subscription status, credit balances, available plans
 * POST /api/billing/change-plan — upgrade (Basic→Pro immediate) or downgrade (Pro→Basic scheduled)
 * POST /api/billing/portal   — create a Stripe Billing Portal session for self-service management
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { db } from "@workspace/db";
import {
  subscriptionsTable,
  userCreditsTable,
  stripePriceConfigsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { PLAN_CREDITS, FOUNDER_MAX_SEATS, FOUNDER_MAX_MONTHS, provisionSubscriptionCredits } from "../lib/credits";
import { getActiveFounderCount, getStripe, getPlanConfig } from "../lib/stripe";
import { invalidateAccessCache } from "../middleware/requireToolAccess";
import { invalidatePlanCache } from "../middleware/requirePlanAccess";
import { getAppUrl } from "../lib/email";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /api/billing ──────────────────────────────────────────────────────────

router.get("/billing", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.session!.user!.userId;

  // Parallel reads
  const [subRows, walletRows, priceRows] = await Promise.all([
    db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1),
    db
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .limit(1),
    db.select().from(stripePriceConfigsTable),
  ]);

  const subscription = subRows[0] ?? null;
  const wallet       = walletRows[0] ?? null;

  // Build plan list
  const plans = priceRows
    .filter((r) => r.isRecurring)
    .map((r) => ({
      slug:        r.planSlug,
      amountCents: r.amountCents,
      currency:    r.currency,
      interval:    r.interval,
      credits:     r.creditAmount,
      priceId:     r.stripePriceId,
    }));

  const topups = priceRows
    .filter((r) => !r.isRecurring)
    .map((r) => ({
      slug:        r.planSlug,
      amountCents: r.amountCents,
      currency:    r.currency,
      credits:     r.creditAmount,
      priceId:     r.stripePriceId,
    }));

  // Founder availability
  let founderSeatsLeft: number | null = null;
  if (plans.some((p) => p.slug === "founder")) {
    const used = await getActiveFounderCount();
    founderSeatsLeft = Math.max(0, FOUNDER_MAX_SEATS - used);
  }

  res.json({
    subscription: subscription
      ? {
          planSlug:           subscription.planSlug,
          status:             subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd:   subscription.currentPeriodEnd,
          cancelAtPeriodEnd:  subscription.cancelAtPeriodEnd,
          // pendingPlanSlug: set when a downgrade is scheduled for next renewal cycle
          pendingPlanSlug:    subscription.pendingPlanSlug ?? null,
          founderMonthsGranted: subscription.planSlug === "founder"
            ? subscription.founderMonthsGranted
            : undefined,
          founderMonthsRemaining: subscription.planSlug === "founder"
            ? Math.max(0, FOUNDER_MAX_MONTHS - subscription.founderMonthsGranted)
            : undefined,
        }
      : null,
    credits: {
      available:    wallet?.availableCredits    ?? 0,
      subscription: wallet?.subscriptionCredits ?? 0,
      purchased:    wallet?.purchasedCredits    ?? 0,
      reserved:     wallet?.reservedCredits     ?? 0,
      totalConsumed: wallet?.totalConsumed      ?? 0,
    },
    plans,
    topups,
    founderSeatsLeft,
    planCreditsTable: PLAN_CREDITS,
  });
});

// ── POST /api/billing/change-plan ────────────────────────────────────────────

/**
 * Upgrade or downgrade the authenticated user's subscription.
 *
 * Basic → Pro : immediate via Stripe subscription item update with proration.
 *               Subscription credits are reset to the Pro pool (1,500) right away.
 *               Purchased credits are never touched.
 *
 * Pro → Basic : scheduled — Stripe price changes with proration_behavior:'none'
 *               (no immediate charge/refund). The user keeps Pro access until
 *               currentPeriodEnd. On the next subscription_cycle invoice, the
 *               webhook applies the plan change and grants 400 credits.
 *
 * Founder plans cannot be changed through this endpoint.
 * The endpoint always resolves Stripe IDs from DB — never from the frontend.
 */
router.post("/billing/change-plan", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.session!.user!.userId;
  const { targetPlan } = (req.body ?? {}) as { targetPlan?: string };

  if (!targetPlan || !["basic", "pro"].includes(targetPlan)) {
    res.status(400).json({ error: "targetPlan must be 'basic' or 'pro'", code: "invalid_plan" });
    return;
  }

  // Resolve subscription from DB — never accept IDs from frontend
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);

  if (!sub || !["active", "trialing"].includes(sub.status)) {
    res.status(404).json({
      error: "No active subscription found. Use checkout to start a new subscription.",
      code: "no_subscription",
    });
    return;
  }

  if (sub.planSlug === "founder") {
    res.status(400).json({
      error: "Founder plans are managed separately and cannot be changed through this endpoint.",
      code: "founder_plan",
    });
    return;
  }

  if (!sub.stripeSubscriptionId) {
    res.status(400).json({ error: "No Stripe subscription ID on file.", code: "no_stripe_sub" });
    return;
  }

  const currentPlan = sub.planSlug;

  // Idempotency: already on this plan with no pending change
  if (currentPlan === targetPlan && !sub.pendingPlanSlug) {
    res.status(409).json({ error: `Ya estás en el plan ${targetPlan}.`, code: "same_plan" });
    return;
  }

  // If there's a pending downgrade and user wants to go back to current plan, cancel it
  if (sub.pendingPlanSlug === targetPlan) {
    res.status(409).json({ error: `El cambio a ${targetPlan} ya está programado.`, code: "already_pending" });
    return;
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    res.status(503).json({ error: "El servicio de pagos no está disponible.", code: "stripe_unavailable" });
    return;
  }

  const targetConfig = await getPlanConfig(targetPlan);
  if (!targetConfig) {
    res.status(503).json({
      error: `Plan '${targetPlan}' no está configurado. El administrador debe ejecutar el setup de Stripe primero.`,
      code: "plan_not_configured",
    });
    return;
  }

  // Retrieve current Stripe subscription to get the item ID
  let stripeSub: Awaited<ReturnType<typeof stripe.subscriptions.retrieve>>;
  try {
    stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  } catch (err: any) {
    logger.error({ err: err?.message, userId }, "[billing/change-plan] Failed to retrieve Stripe subscription");
    res.status(502).json({ error: "No se pudo contactar con Stripe.", code: "stripe_error" });
    return;
  }

  const firstItem = stripeSub.items.data[0];
  if (!firstItem) {
    res.status(500).json({ error: "No se encontraron ítems en la suscripción de Stripe.", code: "no_items" });
    return;
  }

  // ── Basic → Pro: immediate upgrade ──────────────────────────────────────────
  if (currentPlan === "basic" && targetPlan === "pro") {
    try {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items:              [{ id: firstItem.id, price: targetConfig.stripePriceId }],
        proration_behavior: "create_prorations",
        metadata:           { plan_slug: "pro" },
      });
    } catch (err: any) {
      logger.error({ err: err?.message, userId }, "[billing/change-plan] Stripe upgrade failed");
      res.status(502).json({ error: "El upgrade en Stripe falló.", code: "stripe_error" });
      return;
    }

    // Persist plan change in DB immediately
    await db
      .update(subscriptionsTable)
      .set({ planSlug: "pro", pendingPlanSlug: null, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, userId));

    // Replace subscription credit pool with Pro capacity (purchased credits untouched)
    await provisionSubscriptionCredits(
      userId,
      PLAN_CREDITS["pro"],
      `Upgrade a Pro: pool mensual actualizado a ${PLAN_CREDITS["pro"]} créditos`,
    );

    invalidateAccessCache(userId);
    invalidatePlanCache(userId);

    logger.info({ userId }, "[billing/change-plan] Upgraded Basic → Pro ✓");
    res.json({ success: true, type: "upgrade", plan: "pro", effective: true });
    return;
  }

  // ── Pro → Basic: scheduled downgrade ────────────────────────────────────────
  if (currentPlan === "pro" && targetPlan === "basic") {
    try {
      // Update Stripe subscription price to Basic for next cycle.
      // proration_behavior:'none' = no immediate charge/refund.
      // We intentionally do NOT update metadata.plan_slug here — keeping 'pro' in
      // metadata ensures the subscription.updated webhook won't prematurely
      // downgrade the user in DB before the next billing cycle.
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items:              [{ id: firstItem.id, price: targetConfig.stripePriceId }],
        proration_behavior: "none",
      });
    } catch (err: any) {
      logger.error({ err: err?.message, userId }, "[billing/change-plan] Stripe downgrade schedule failed");
      res.status(502).json({ error: "No se pudo programar el cambio en Stripe.", code: "stripe_error" });
      return;
    }

    // Store pending downgrade — planSlug remains 'pro' until renewal
    await db
      .update(subscriptionsTable)
      .set({ pendingPlanSlug: "basic", updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, userId));

    const effectiveDate = sub.currentPeriodEnd?.toISOString() ?? null;

    logger.info({ userId, effectiveDate }, "[billing/change-plan] Downgrade Pro → Basic scheduled ✓");
    res.json({ success: true, type: "downgrade", plan: "basic", scheduled: true, effectiveDate });
    return;
  }

  // Any other transition is not supported
  res.status(409).json({
    error: `Cambio de ${currentPlan} a ${targetPlan} no soportado.`,
    code: "invalid_transition",
  });
});

// ── POST /api/billing/portal ──────────────────────────────────────────────────

/**
 * Creates a Stripe Billing Portal session for the authenticated user.
 *
 * The portal allows the user to:
 *   - Update their payment method
 *   - View invoices
 *   - Cancel or reactivate their subscription
 *
 * Security: stripeCustomerId is always resolved from DB using the authenticated
 * userId — never accepted from the frontend.
 */
router.post("/billing/portal", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.session!.user!.userId;

  const [sub] = await db
    .select({ stripeCustomerId: subscriptionsTable.stripeCustomerId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);

  if (!sub?.stripeCustomerId) {
    res.status(404).json({ error: "No se encontró un cliente de Stripe para esta cuenta.", code: "no_customer" });
    return;
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch {
    res.status(503).json({ error: "El servicio de pagos no está disponible.", code: "stripe_unavailable" });
    return;
  }

  try {
    const appUrl = getAppUrl();
    const session = await stripe.billingPortal.sessions.create({
      customer:   sub.stripeCustomerId,
      return_url: `${appUrl}/billing`,
    });
    res.json({ url: session.url });
  } catch (err: any) {
    logger.error({ err: err?.message, userId }, "[billing/portal] Failed to create portal session");
    res.status(502).json({ error: "No se pudo abrir el portal de facturación.", code: "stripe_error" });
  }
});

export default router;
