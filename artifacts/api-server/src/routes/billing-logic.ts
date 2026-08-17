/**
 * billing-logic.ts — pure business logic for plan change operations.
 *
 * Functions here accept all external dependencies as parameters so they can be
 * imported and tested directly without Express, without DB connections, and
 * without Stripe credentials.  The thin route handlers in billing.ts call these
 * functions after fetching DB rows and initialising the Stripe client.
 *
 * Every function returns a discriminated union  { ok: true, ... } | { ok: false, status, code, message }
 * so the route handler can forward the result unchanged.
 */

import type Stripe from "stripe";
import { logger } from "../lib/logger";
import { PLAN_CREDITS } from "../lib/credits";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface PlanConfig {
  planSlug:    string;
  stripePriceId: string;
}

export interface SubRow {
  id:                   number;
  userId:               number;
  planSlug:             string;
  status:               string;
  stripeSubscriptionId: string | null;
  stripeCustomerId:     string | null;
  stripeScheduleId:     string | null;
  pendingPlanSlug:      string | null;
  currentPeriodEnd:     Date | null;
}

type UpdateSubFn = (updates: Partial<{
  planSlug:         string;
  pendingPlanSlug:  string | null;
  stripeScheduleId: string | null;
}>) => Promise<void>;

type InvalidateFn = (userId: number) => void;

// ── Validation helpers ────────────────────────────────────────────────────────

export function validateChangePlan(
  targetPlan: unknown,
  sub: SubRow | null,
): { ok: false; status: number; code: string; message: string } | null {
  if (!targetPlan || !["basic", "pro"].includes(targetPlan as string)) {
    return { ok: false, status: 400, code: "invalid_plan", message: "targetPlan must be 'basic' or 'pro'" };
  }
  if (!sub || !["active", "trialing"].includes(sub.status)) {
    return { ok: false, status: 404, code: "no_subscription",
      message: "No active subscription found. Use checkout to start a new subscription." };
  }
  if (sub.planSlug === "founder") {
    return { ok: false, status: 400, code: "founder_plan",
      message: "Founder plans are managed separately and cannot be changed through this endpoint." };
  }
  if (!sub.stripeSubscriptionId) {
    return { ok: false, status: 400, code: "no_stripe_sub", message: "No Stripe subscription ID on file." };
  }
  if (sub.planSlug === targetPlan && !sub.pendingPlanSlug) {
    return { ok: false, status: 409, code: "same_plan", message: `Ya estás en el plan ${targetPlan}.` };
  }
  if (sub.pendingPlanSlug === targetPlan) {
    return { ok: false, status: 409, code: "already_pending", message: `El cambio a ${targetPlan} ya está programado.` };
  }
  return null; // all good
}

// ── Upgrade: Basic → Pro (immediate) ─────────────────────────────────────────

export interface UpgradeParams {
  userId:                      number;
  sub:                         SubRow;
  proConfig:                   PlanConfig;
  stripeFirstItemId:           string;
  stripe:                      Stripe;
  provisionSubscriptionCredits: (userId: number, amount: number, desc: string) => Promise<void>;
  invalidateAccessCache:       InvalidateFn;
  invalidatePlanCache:         InvalidateFn;
  updateSub:                   UpdateSubFn;
}

export type UpgradeResult =
  | { ok: true; type: "upgrade"; plan: "pro" }
  | { ok: false; status: number; code: string; message: string };

/**
 * Upgrade Basic → Pro.
 *
 * - Updates the Stripe subscription item price to Pro (with proration so the
 *   user is charged/credited for the remainder of the billing period).
 * - Sets metadata.plan_slug = 'pro' on the Stripe subscription so future
 *   handleSubscriptionUpdated events resolve to Pro from metadata (belt-and-
 *   suspenders alongside the price-based lookup).
 * - If there is a pending downgrade schedule, releases it first.
 * - Replaces the subscription credit pool with the Pro capacity immediately.
 * - Clears pendingPlanSlug and stripeScheduleId in DB.
 */
export async function executeUpgrade(p: UpgradeParams): Promise<UpgradeResult> {
  // Release any existing schedule (leftover from a previous downgrade attempt)
  if (p.sub.stripeScheduleId) {
    try {
      await p.stripe.subscriptionSchedules.release(p.sub.stripeScheduleId);
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[billing] Could not release existing schedule during upgrade — continuing");
    }
  }

  try {
    await p.stripe.subscriptions.update(p.sub.stripeSubscriptionId!, {
      items: [{ id: p.stripeFirstItemId, price: p.proConfig.stripePriceId }],
      proration_behavior: "create_prorations",
      metadata: { plan_slug: "pro" },
    });
  } catch (err: any) {
    logger.error({ err: err?.message, userId: p.userId }, "[billing] Stripe upgrade failed");
    return { ok: false, status: 502, code: "stripe_error", message: "El upgrade en Stripe falló." };
  }

  await p.updateSub({ planSlug: "pro", pendingPlanSlug: null, stripeScheduleId: null });

  await p.provisionSubscriptionCredits(
    p.userId,
    PLAN_CREDITS["pro"],
    `Upgrade a Pro: pool mensual actualizado a ${PLAN_CREDITS["pro"]} créditos`,
  );

  p.invalidateAccessCache(p.userId);
  p.invalidatePlanCache(p.userId);

  logger.info({ userId: p.userId }, "[billing] Upgraded Basic → Pro ✓");
  return { ok: true, type: "upgrade", plan: "pro" };
}

// ── Downgrade: Pro → Basic (scheduled via Subscription Schedule) ──────────────

export interface DowngradeParams {
  userId:           number;
  sub:              SubRow;
  proConfig:        PlanConfig;
  basicConfig:      PlanConfig;
  stripe:           Stripe;
  updateSub:        UpdateSubFn;
}

export type DowngradeResult =
  | { ok: true; type: "downgrade"; plan: "basic"; scheduled: true; effectiveDate: string | null }
  | { ok: false; status: number; code: string; message: string };

/**
 * Schedule a Pro → Basic downgrade using a Stripe Subscription Schedule.
 *
 * A Subscription Schedule keeps the subscription on its current Pro price in
 * Stripe's own reporting and portal for the remainder of the billing period.
 * At period end, Stripe automatically transitions to the Basic price and generates
 * a Basic invoice — at which point handleInvoicePaid derives the effective plan
 * from the invoice line-item price (authoritative) and grants 400 credits.
 *
 * The schedule ID is stored in stripeScheduleId so it can be released if the
 * user changes their mind (see executeCancelPlanChange).
 *
 * We intentionally leave metadata.plan_slug = 'pro' on the Stripe subscription
 * during the Pro period. handleSubscriptionUpdated now derives planSlug from
 * the subscription's price (not metadata), so this is safe and order-independent.
 */
export async function executeDowngrade(p: DowngradeParams): Promise<DowngradeResult> {
  if (!p.sub.currentPeriodEnd) {
    return { ok: false, status: 400, code: "no_period_end",
      message: "No se pudo determinar el fin del período actual." };
  }

  const periodEndUnix = Math.floor(p.sub.currentPeriodEnd.getTime() / 1000);
  let schedule: Awaited<ReturnType<typeof p.stripe.subscriptionSchedules.create>>;

  try {
    // Create a schedule from the current subscription. Stripe auto-creates Phase 1
    // from the current subscription state (same items, start_date = current_period_start).
    schedule = await p.stripe.subscriptionSchedules.create({
      from_subscription: p.sub.stripeSubscriptionId!,
    });
  } catch (err: any) {
    logger.error({ err: err?.message, userId: p.userId }, "[billing] Stripe schedule create failed");
    return { ok: false, status: 502, code: "stripe_error",
      message: "No se pudo programar el cambio en Stripe." };
  }

  // Stripe requires start_date on the first phase of an active schedule update.
  // It must match the current phase's start_date returned by the create call.
  const phase0StartDate = schedule.phases[0]?.start_date;
  if (typeof phase0StartDate !== "number") {
    // Defensive: release the orphan schedule before returning an error.
    try { await p.stripe.subscriptionSchedules.release(schedule.id); } catch {}
    logger.error({ scheduleId: schedule.id, userId: p.userId }, "[billing] Schedule phase0 has no start_date");
    return { ok: false, status: 502, code: "stripe_error",
      message: "No se pudo programar el cambio en Stripe (sin fecha de inicio)." };
  }

  try {
    // Phase 1: keep the current Pro price through the paid-for period end.
    // Phase 2: Basic price for exactly 1 billing iteration so `end_behavior: release`
    //          fires automatically after that cycle and returns the subscription to
    //          normal (not schedule-managed). Without iterations, the schedule would
    //          be indefinite and end_behavior would never trigger.
    await p.stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          items:      [{ price: p.proConfig.stripePriceId, quantity: 1 }],
          start_date: phase0StartDate, // required — must match current phase start
          end_date:   periodEndUnix,
        },
        {
          items:    [{ price: p.basicConfig.stripePriceId, quantity: 1 }],
          // `duration` bounds the phase to exactly 1 monthly cycle. Without a bound,
          // the schedule is indefinite and end_behavior:'release' would never fire
          // automatically; the subscription would remain schedule-managed forever.
          // After 1 month, Stripe ends the schedule and releases the subscription
          // back to normal Basic management.
          duration: { interval: "month" as const, interval_count: 1 },
        },
      ],
      end_behavior:       "release",
      proration_behavior: "none",
    });
  } catch (err: any) {
    // Release the orphan schedule so it doesn't silently control the subscription.
    try { await p.stripe.subscriptionSchedules.release(schedule.id); } catch {}
    logger.error({ err: err?.message, userId: p.userId, scheduleId: schedule.id },
      "[billing] Stripe schedule update failed");
    return { ok: false, status: 502, code: "stripe_error",
      message: "No se pudo programar el cambio en Stripe." };
  }

  await p.updateSub({ pendingPlanSlug: "basic", stripeScheduleId: schedule.id });

  const effectiveDate = p.sub.currentPeriodEnd.toISOString();
  logger.info({ userId: p.userId, effectiveDate, scheduleId: schedule.id },
    "[billing] Downgrade Pro → Basic scheduled ✓");

  return { ok: true, type: "downgrade", plan: "basic", scheduled: true, effectiveDate };
}

// ── Cancel pending plan change (release the schedule) ─────────────────────────

export interface CancelPlanChangeParams {
  userId:    number;
  sub:       SubRow;
  stripe:    Stripe;
  updateSub: UpdateSubFn;
}

export type CancelPlanChangeResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/**
 * Cancel a scheduled Pro → Basic downgrade by releasing the Stripe Subscription
 * Schedule.  After release, Stripe removes the schedule and the subscription
 * continues on its current Pro price normally.
 *
 * Clears pendingPlanSlug and stripeScheduleId in DB.
 */
export async function executeCancelPlanChange(p: CancelPlanChangeParams): Promise<CancelPlanChangeResult> {
  if (!p.sub.pendingPlanSlug || !p.sub.stripeScheduleId) {
    return { ok: false, status: 404, code: "no_pending_change",
      message: "No hay ningún cambio de plan programado para cancelar." };
  }

  try {
    await p.stripe.subscriptionSchedules.release(p.sub.stripeScheduleId);
  } catch (err: any) {
    logger.error({ err: err?.message, userId: p.userId }, "[billing] Could not release Stripe schedule");
    return { ok: false, status: 502, code: "stripe_error",
      message: "No se pudo cancelar el cambio en Stripe." };
  }

  await p.updateSub({ pendingPlanSlug: null, stripeScheduleId: null });

  logger.info({ userId: p.userId }, "[billing] Pending plan change cancelled ✓");
  return { ok: true };
}

// ── Portal session ────────────────────────────────────────────────────────────

export interface PortalParams {
  userId:            number;
  stripeCustomerId:  string | null;
  stripe:            Stripe;
  returnUrl:         string;
}

export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; status: number; code: string; message: string };

/**
 * Create a Stripe Billing Portal session for the authenticated user.
 */
export async function executeCreatePortal(p: PortalParams): Promise<PortalResult> {
  if (!p.stripeCustomerId) {
    return { ok: false, status: 404, code: "no_customer",
      message: "No se encontró un cliente de Stripe para esta cuenta." };
  }

  try {
    const session = await p.stripe.billingPortal.sessions.create({
      customer:   p.stripeCustomerId,
      return_url: p.returnUrl,
    });
    return { ok: true, url: session.url };
  } catch (err: any) {
    logger.error({ err: err?.message, userId: p.userId }, "[billing] Portal session creation failed");
    return { ok: false, status: 502, code: "stripe_error",
      message: "No se pudo abrir el portal de facturación." };
  }
}
