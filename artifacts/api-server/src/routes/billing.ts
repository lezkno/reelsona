/**
 * Billing routes — authenticated, read/write.
 *
 * GET  /api/billing              — current plan, credits, available plans
 * POST /api/billing/change-plan  — upgrade (Basic→Pro) or schedule downgrade (Pro→Basic)
 * POST /api/billing/cancel-plan-change — cancel a pending Pro→Basic downgrade
 * POST /api/billing/portal       — create a Stripe Billing Portal session
 *
 * Route handlers are intentionally thin: they parse the request, fetch DB rows,
 * initialise the Stripe client, and delegate all business logic to billing-logic.ts
 * — which can be imported and tested independently of Express.
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
import {
  validateChangePlan,
  executeUpgrade,
  executeDowngrade,
  executeCancelPlanChange,
  executeCreatePortal,
} from "./billing-logic";
import { nextFounderGrantDate } from "../lib/founder-grant";

const router = Router();

// ── GET /api/billing ──────────────────────────────────────────────────────────

router.get("/billing", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.session!.user!.userId;

  const [subRows, walletRows, priceRows] = await Promise.all([
    db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)).limit(1),
    db.select().from(userCreditsTable).where(eq(userCreditsTable.userId, userId)).limit(1),
    db.select().from(stripePriceConfigsTable),
  ]);

  const subscription = subRows[0] ?? null;
  const wallet       = walletRows[0] ?? null;

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

  let founderSeatsLeft: number | null = null;
  if (plans.some((p) => p.slug === "founder")) {
    const used = await getActiveFounderCount();
    founderSeatsLeft = Math.max(0, FOUNDER_MAX_SEATS - used);
  }

  res.json({
    subscription: subscription
      ? {
          planSlug:            subscription.planSlug,
          status:              subscription.status,
          currentPeriodStart:  subscription.currentPeriodStart,
          currentPeriodEnd:    subscription.currentPeriodEnd,
          cancelAtPeriodEnd:   subscription.cancelAtPeriodEnd,
          pendingPlanSlug:     subscription.pendingPlanSlug ?? null,
          founderMonthsGranted: subscription.planSlug === "founder"
            ? subscription.founderMonthsGranted
            : undefined,
          founderMonthsRemaining: subscription.planSlug === "founder"
            ? Math.max(0, FOUNDER_MAX_MONTHS - subscription.founderMonthsGranted)
            : undefined,
          nextFounderGrantAt: subscription.planSlug === "founder"
            ? (nextFounderGrantDate(
                subscription.founderAnchorAt ?? subscription.founderLastGrantAt ?? null,
                subscription.founderMonthsGranted ?? 0,
              ) ?? null)
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

router.post("/billing/change-plan", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.session!.user!.userId;
  const { targetPlan } = (req.body ?? {}) as { targetPlan?: string };

  // 1. Load subscription from DB
  const [sub] = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId)).limit(1);

  // 2. Validate (pure function — testable independently)
  const validationError = validateChangePlan(targetPlan, sub ?? null);
  if (validationError) {
    res.status(validationError.status).json({ error: validationError.message, code: validationError.code });
    return;
  }

  // 3. Initialise Stripe
  let stripe: ReturnType<typeof getStripe>;
  try { stripe = getStripe(); }
  catch {
    res.status(503).json({ error: "El servicio de pagos no está disponible.", code: "stripe_unavailable" });
    return;
  }

  // 4. Load plan configs
  const [proConfig, targetConfig] = await Promise.all([
    getPlanConfig("pro"),
    getPlanConfig(targetPlan!),
  ]);
  if (!targetConfig) {
    res.status(503).json({ error: `Plan '${targetPlan}' no configurado.`, code: "plan_not_configured" });
    return;
  }

  // Shared updateSub helper bound to this user's subscription row
  const updateSub = async (updates: Parameters<typeof executeUpgrade>[0]["updateSub"] extends (u: infer U) => any ? U : never) => {
    await db.update(subscriptionsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, userId));
  };

  const currentPlan = sub!.planSlug;

  // ── Basic → Pro: immediate upgrade ──────────────────────────────────────────
  if (currentPlan === "basic" && targetPlan === "pro") {
    let stripeFirstItemId: string;
    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub!.stripeSubscriptionId!);
      stripeFirstItemId = stripeSub.items.data[0]?.id ?? "";
      if (!stripeFirstItemId) throw new Error("No subscription items");
    } catch (err: any) {
      res.status(502).json({ error: "No se pudo contactar con Stripe.", code: "stripe_error" });
      return;
    }

    const result = await executeUpgrade({
      userId,
      sub:                         sub!,
      proConfig:                   proConfig ?? targetConfig, // both point to pro
      stripeFirstItemId,
      stripe,
      provisionSubscriptionCredits,
      invalidateAccessCache,
      invalidatePlanCache,
      updateSub,
    });

    if (!result.ok) { res.status(result.status).json({ error: result.message, code: result.code }); return; }
    res.json({ success: true, type: result.type, plan: result.plan });
    return;
  }

  // ── Pro → Basic: scheduled downgrade via Subscription Schedule ───────────────
  if (currentPlan === "pro" && targetPlan === "basic") {
    if (!proConfig) {
      res.status(503).json({ error: "Plan Pro no configurado.", code: "plan_not_configured" });
      return;
    }

    const result = await executeDowngrade({
      userId,
      sub:         sub!,
      proConfig,
      basicConfig: targetConfig,
      stripe,
      updateSub,
    });

    if (!result.ok) { res.status(result.status).json({ error: result.message, code: result.code }); return; }
    res.json({ success: true, type: result.type, plan: result.plan, scheduled: result.scheduled, effectiveDate: result.effectiveDate });
    return;
  }

  res.status(409).json({ error: `Cambio de ${currentPlan} a ${targetPlan} no soportado.`, code: "invalid_transition" });
});

// ── POST /api/billing/cancel-plan-change ─────────────────────────────────────

router.post("/billing/cancel-plan-change", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.session!.user!.userId;

  const [sub] = await db.select().from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId)).limit(1);

  if (!sub) {
    res.status(404).json({ error: "No active subscription found.", code: "no_subscription" });
    return;
  }

  let stripe: ReturnType<typeof getStripe>;
  try { stripe = getStripe(); }
  catch {
    res.status(503).json({ error: "El servicio de pagos no está disponible.", code: "stripe_unavailable" });
    return;
  }

  const updateSub = async (updates: Parameters<typeof executeCancelPlanChange>[0]["updateSub"] extends (u: infer U) => any ? U : never) => {
    await db.update(subscriptionsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(subscriptionsTable.userId, userId));
  };

  const result = await executeCancelPlanChange({ userId, sub, stripe, updateSub });

  if (!result.ok) { res.status(result.status).json({ error: result.message, code: result.code }); return; }
  res.json({ success: true });
});

// ── POST /api/billing/portal ──────────────────────────────────────────────────

router.post("/billing/portal", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.session!.user!.userId;

  const [sub] = await db.select({ stripeCustomerId: subscriptionsTable.stripeCustomerId })
    .from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)).limit(1);

  let stripe: ReturnType<typeof getStripe>;
  try { stripe = getStripe(); }
  catch {
    res.status(503).json({ error: "El servicio de pagos no está disponible.", code: "stripe_unavailable" });
    return;
  }

  const result = await executeCreatePortal({
    userId,
    stripeCustomerId: sub?.stripeCustomerId ?? null,
    stripe,
    returnUrl: `${getAppUrl()}/billing`,
  });

  if (!result.ok) { res.status(result.status).json({ error: result.message, code: result.code }); return; }
  res.json({ url: result.url });
});

export default router;
