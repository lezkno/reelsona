/**
 * POST /api/webhooks/stripe
 *
 * IMPORTANT: Mounted in app.ts BEFORE express.json() so req.body arrives as a
 * raw Buffer — required for Stripe signature verification.
 *
 * Handles:
 *   checkout.session.completed              → subscription or topup; ONLY when payment_status=paid
 *   checkout.session.async_payment_succeeded → delayed confirmation for async payment methods
 *   customer.subscription.updated           → renewal, upgrade/downgrade, cancel-at-period-end
 *   customer.subscription.deleted           → subscription actually canceled / expired
 *   invoice.paid                            → successful renewal → atomic credit grant
 *   invoice.payment_failed                  → billing failure → mark past_due
 *   payment_intent.succeeded                → legacy PaymentElement form (program purchase)
 *
 * Hardening:
 *   - providerSessionId UNIQUE prevents duplicate checkout processing.
 *   - invoice.paid uses atomic currentPeriodEnd update to prevent double credit grants
 *     on duplicate Stripe delivery: credits are only granted when the new period end
 *     is strictly later than the stored one (one grant per billing period).
 *   - Topups NEVER touch entitlements/tool-access. They only add purchasedCredits to
 *     the wallet of an existing user identified by email.
 *   - Subscription provisioning always calls provisionUser FIRST (creates/finds the
 *     account), then upserts the subscription row (which requires the user to exist).
 *   - provisionedAt=null rows are retried by the scheduler recovery sweep.
 *   - Stripe always gets a 200 immediately; processing is fire-and-forget.
 */

import express, { Router } from "express";
import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe, getWebhookSecret } from "../lib/stripe";
import { PLAN_CREDITS } from "../lib/credits";
import { upsertEntitlement } from "../lib/access";
import { invalidateAccessCache } from "../middleware/requireToolAccess";
import { invalidatePlanCache } from "../middleware/requirePlanAccess";
import { provisionPurchase } from "../lib/provision-purchase";
import { db } from "@workspace/db";
import {
  purchases,
  subscriptionsTable,
  userCreditsTable,
  creditLedgerTable,
  invoiceCreditGrantsTable,
} from "@workspace/db/schema";
import { eq, and, or, lt, isNull, ne, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers["stripe-signature"] as string | undefined;

    let stripe: ReturnType<typeof getStripe>;
    let webhookSecret: string;
    try {
      stripe        = getStripe();
      webhookSecret = getWebhookSecret();
    } catch (configErr: any) {
      console.error("[webhook/stripe] Not configured:", configErr.message);
      res.json({ received: false, reason: "not_configured" });
      return;
    }

    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch (err: any) {
      console.warn("[webhook/stripe] Signature verification failed:", err.message);
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const handler = EVENT_HANDLERS[event.type];

    if (!handler) {
      logger.debug({ type: event.type }, "[webhook/stripe] Unhandled event type");
      res.json({ received: true, unhandled: true });
      return;
    }

    // ── invoice.paid is processed synchronously ────────────────────────────────
    // A failed invoice.paid transaction must produce a non-2xx response so Stripe
    // will retry. All other events are fire-and-forget (idempotent by design).
    if (event.type === "invoice.paid") {
      try {
        await handler(event.data.object as any, stripe);
        res.json({ received: true });
      } catch (err: any) {
        logger.error({ err: err?.message, type: event.type }, "[webhook/stripe] invoice.paid failed — Stripe will retry");
        res.status(500).json({ error: "Processing failed" });
      }
      return;
    }

    // All other events: respond immediately then process async
    res.json({ received: true });
    handler(event.data.object as any, stripe).catch((err: any) => {
      logger.error({ err: err?.message, type: event.type }, "[webhook/stripe] Handler error");
    });
  }
);

// ── Event dispatcher map ───────────────────────────────────────────────────────

const EVENT_HANDLERS: Record<string, (obj: any, stripe: Stripe) => Promise<void>> = {
  // Gate on payment_status=paid; delayed bank / SEPA / etc. come via async_payment_succeeded
  "checkout.session.completed":               handleCheckoutCompleted,
  "checkout.session.async_payment_succeeded": handleCheckoutCompleted, // same handler, already gated
  "customer.subscription.updated":            handleSubscriptionUpdated,
  "customer.subscription.deleted":            handleSubscriptionDeleted,
  "invoice.paid":                             handleInvoicePaid,
  "invoice.payment_failed":                   handleInvoicePaymentFailed,
  // payment_intent.succeeded (legacy reelsona_program) removed — endpoint discontinued
};

// ── checkout.session.completed ─────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, stripe: Stripe): Promise<void> {
  const sessionId = session.id;
  const planSlug  = session.metadata?.plan_slug ?? "";
  const product   = session.metadata?.product   ?? "";

  logger.info({ sessionId, planSlug, product, paymentStatus: session.payment_status }, "[webhook/stripe] checkout.session.completed");

  // ── Payment settlement gate ────────────────────────────────────────────────
  // Stripe can emit checkout.session.completed for asynchronous payment methods
  // (bank redirects, SEPA, etc.) before funds have actually cleared.
  // Only provision when payment_status is "paid". For async methods, the
  // checkout.session.async_payment_succeeded event fires later when funds settle
  // and we process it with the same handler.
  if (session.payment_status !== "paid") {
    logger.info(
      { sessionId, paymentStatus: session.payment_status },
      "[webhook/stripe] Session not yet paid — will provision on async_payment_succeeded",
    );
    return;
  }

  // Idempotency check — providerSessionId is UNIQUE in purchases
  const [existing] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.providerSessionId, sessionId))
    .limit(1);

  if (existing) {
    if (existing.provisionedAt) {
      logger.info({ sessionId }, "[webhook/stripe] Already processed — skipping");
      return;
    }
    logger.info({ sessionId }, "[webhook/stripe] Purchase exists but unprovisioned — retrying");
    await provisionPurchase(existing, stripe);
    return;
  }

  const email      = (session.customer_details?.email ?? session.metadata?.email ?? "").toLowerCase().trim();
  const fullName   = (session.customer_details?.name  ?? session.metadata?.full_name ?? "").trim();
  const amountTotal = session.amount_total  ?? 0;
  const currency    = session.currency      ?? "usd";
  const customerId  = typeof session.customer === "string" ? session.customer : null;

  if (!email) {
    logger.error({ sessionId }, "[webhook/stripe] No email in session — cannot provision");
    return;
  }

  // Determine purchase type
  const isSubscription = product === "reelsona_subscription" || session.mode === "subscription";
  const isTopup        = product === "reelsona_topup";
  const creditsAmount  = parseInt(session.metadata?.credits_amount ?? "0", 10) || 0;

  const purchaseType: "subscription" | "topup" | "program" =
    isSubscription ? "subscription" : isTopup ? "topup" : "program";

  const insertedRows = await db
    .insert(purchases)
    .values({
      provider:           "stripe",
      providerSessionId:  sessionId,
      providerCustomerId: customerId,
      email,
      fullName,
      amountTotal,
      currency,
      status:           "completed",
      toolAccessDays:   365,
      purchaseType,
      planSlug:         planSlug || null,
      creditsPurchased: creditsAmount > 0 ? creditsAmount : null,
    })
    .returning();

  // provisionPurchase fetches the real Stripe subscription period end internally
  // so the subscription row gets the actual Stripe period end — not a fabricated date.
  // This prevents invoice.paid from double-granting credits on the initial invoice.
  await provisionPurchase(insertedRows[0], stripe);
}

// ── customer.subscription.updated ─────────────────────────────────────────────

async function handleSubscriptionUpdated(sub: Stripe.Subscription, _stripe: Stripe): Promise<void> {
  const stripeSubId = sub.id;
  const status      = mapStripeStatus(sub.status);
  const planSlug    = getPlanSlugFromSub(sub);
  const cancelAtPeriodEnd = sub.cancel_at_period_end;

  // Stripe v22: current_period_end/start moved off the Subscription root to subscription items.
  // Read from the first item; fall back to billing_cycle_anchor (still on root) for start.
  const firstItem                  = sub.items?.data?.[0] as any;
  const periodStart: number | null = firstItem?.current_period_start ?? sub.billing_cycle_anchor ?? null;
  const periodEnd: number | null   = firstItem?.current_period_end   ?? null;

  logger.info({ stripeSubId, status, planSlug }, "[webhook/stripe] subscription.updated");

  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
    .limit(1);

  if (!existing) {
    logger.warn({ stripeSubId }, "[webhook/stripe] subscription.updated: no matching row — skipping");
    return;
  }

  await db
    .update(subscriptionsTable)
    .set({
      status,
      planSlug:           planSlug ?? existing.planSlug,
      cancelAtPeriodEnd,
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : undefined,
      currentPeriodEnd:   periodEnd   ? new Date(periodEnd   * 1000) : undefined,
      updatedAt:          new Date(),
    })
    .where(eq(subscriptionsTable.id, existing.id));

  // Update entitlement status
  const toolActive = status === "active" || status === "trialing";
  const newEndsAt  = periodEnd ? new Date(periodEnd * 1000) : null;

  await upsertEntitlement({
    userId:           existing.userId,
    courseAccess:     true,
    toolAccessStatus: toolActive ? "active" : "expired",
    toolAccessEndsAt: newEndsAt,
    source:           "stripe_subscription",
    planSlug:         planSlug ?? existing.planSlug,
  });
  invalidateAccessCache(existing.userId);
  invalidatePlanCache(existing.userId);

  logger.info({ userId: existing.userId, status }, "[webhook/stripe] Entitlement updated from subscription.updated");
}

// ── customer.subscription.deleted ─────────────────────────────────────────────

async function handleSubscriptionDeleted(sub: Stripe.Subscription, _stripe: Stripe): Promise<void> {
  const stripeSubId = sub.id;
  // Stripe v22: current_period_end moved to subscription items
  const firstItemDel              = sub.items?.data?.[0] as any;
  const periodEnd: number | null  = firstItemDel?.current_period_end ?? null;
  logger.info({ stripeSubId }, "[webhook/stripe] subscription.deleted");

  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
    .limit(1);

  if (!existing) return;

  await db
    .update(subscriptionsTable)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(subscriptionsTable.id, existing.id));

  await upsertEntitlement({
    userId:           existing.userId,
    courseAccess:     true,
    toolAccessStatus: "expired",
    toolAccessEndsAt: periodEnd ? new Date(periodEnd * 1000) : new Date(),
    source:           "stripe_subscription",
    planSlug:         existing.planSlug,
  });
  invalidateAccessCache(existing.userId);
  invalidatePlanCache(existing.userId);

  logger.info({ userId: existing.userId }, "[webhook/stripe] Subscription canceled — entitlement expired");
}

// ── invoice.paid ───────────────────────────────────────────────────────────────
// Fires on every successful renewal. Processed SYNCHRONOUSLY — route returns 500
// on failure so Stripe retries automatically (see route handler above).
//
// IDEMPOTENCY: Uses invoice_credit_grants (UNIQUE stripe_invoice_id) as the true
// idempotency key — a durable log, not a mutable "last" column.
//   - INSERT … ON CONFLICT DO NOTHING inside the credit transaction.
//   - Works correctly for out-of-order delivery: old invoice arrives after new one
//     → its row is not in the table → INSERT claims it → correct credits granted.
//   - Immune to subscription.updated races: that handler never touches this table.
//   - Initial invoice is pre-claimed at checkout (provisionSubscription), so
//     invoice.paid for the first billing cycle is always a guaranteed no-op.
//
// ATOMICITY: INSERT into invoice_credit_grants + wallet updates in one transaction.
// If either fails, everything rolls back → 0 rows in grant table → Stripe retries.

async function handleInvoicePaid(invoice: Stripe.Invoice, stripe: Stripe): Promise<void> {
  // Stripe v22: invoice.subscription was removed.
  // The subscription ID is now at invoice.parent.subscription_details.subscription.
  const subRef      = invoice.parent?.subscription_details?.subscription;
  const stripeSubId = typeof subRef === "string" ? subRef : (subRef as Stripe.Subscription | undefined)?.id ?? null;

  if (!stripeSubId) {
    logger.debug("[webhook/stripe] invoice.paid without subscription — skipping");
    return;
  }

  // invoice.period_end is still a direct field in Stripe v22 Invoice.
  // invoiceId is the immutable idempotency key
  const invoiceId: string | null = invoice.id ?? null;
  if (!invoiceId) {
    logger.warn({ stripeSubId }, "[webhook/stripe] invoice.paid: no invoice ID — cannot safely process");
    return;
  }

  // ── billing_reason gate ────────────────────────────────────────────────────
  // Only grant subscription cycle credits for actual renewals.
  //   subscription_create: initial invoice — credits already granted at checkout
  //   subscription_cycle:  recurring renewal — grant cycle credits (fall through)
  //   subscription_update: proration from plan change — NOT a new cycle; skip
  //   manual / other:      not a standard cycle renewal; skip
  // invoice.billing_reason and invoice.period_end are direct fields in Stripe v22 Invoice.
  const billingReason = invoice.billing_reason ?? "unknown";
  if (billingReason !== "subscription_cycle") {
    logger.info(
      { stripeSubId, invoiceId, billingReason },
      "[webhook/stripe] invoice.paid: not a subscription_cycle — skipping credit grant",
    );
    // Still update subscription status/period end (informational) without credit grant
    if (billingReason === "subscription_update" || billingReason === "subscription_create") {
      const periodEndTs = invoice.period_end;
      await db
        .update(subscriptionsTable)
        .set({ status: "active", currentPeriodEnd: periodEndTs ? new Date(periodEndTs * 1000) : undefined, updatedAt: new Date() })
        .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId));
    }
    return;
  }

  // invoice.period_end is a direct field on Stripe v22 Invoice (number, always present)
  const newPeriodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : null;

  logger.info({ stripeSubId, invoiceId, billingReason, newPeriodEnd: newPeriodEnd?.toISOString() }, "[webhook/stripe] invoice.paid (subscription_cycle)");

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
    .limit(1);

  if (!sub) {
    logger.warn({ stripeSubId }, "[webhook/stripe] invoice.paid: no matching subscription row");
    return;
  }

  // ── Founder: cron is the sole credit-grant path ───────────────────────────
  // invoice.paid fires once per annual renewal, while the monthly cron grants
  // Founder credits 12 times (months 2–12) atomically with a durable idempotency
  // key. If invoice.paid also grants credits, they share different idempotency
  // namespaces (Stripe invoice ID vs. cron_founder_<id>_month<N>) and can both
  // succeed in the same billing period, advancing founderMonthsGranted twice.
  // Solution: invoice.paid only updates subscription status/period end for
  // Founder; credits come exclusively from the cron.
  if (sub.planSlug === "founder") {
    await db
      .update(subscriptionsTable)
      .set({ status: "active", currentPeriodEnd: newPeriodEnd ?? undefined, updatedAt: new Date() })
      .where(eq(subscriptionsTable.id, sub.id));
    logger.info({ stripeSubId, invoiceId }, "[webhook/stripe] invoice.paid: Founder — updated period end only (cron is grant authority)");
    return;
  }

  // ── Pending plan change (scheduled downgrade) ─────────────────────────────
  // When pendingPlanSlug is set (Pro→Basic downgrade was scheduled), apply the
  // new plan on this renewal: grant credits for the target plan, update planSlug,
  // and clear pendingPlanSlug so subsequent renewals use the standard path.
  const effectivePlanSlug = sub.pendingPlanSlug ?? sub.planSlug;
  const planCredits = PLAN_CREDITS[effectivePlanSlug] ?? 0;
  let credited = false;

  // ── Atomic: invoice claim + credit grant (non-Founder only) ──────────────
  // Any throw propagates to the route handler → 500 → Stripe retries.
  await db.transaction(async (tx) => {
    // Step 1: try to claim this invoice — UNIQUE constraint prevents double grants
    const claimed = await tx
      .insert(invoiceCreditGrantsTable)
      .values({
        stripeInvoiceId: invoiceId,
        userId:          sub.userId,
        planSlug:        effectivePlanSlug,
        creditsGranted:  planCredits,
      })
      .onConflictDoNothing()
      .returning({ id: invoiceCreditGrantsTable.id });

    if (claimed.length === 0) {
      // Already processed (pre-claimed at checkout OR duplicate delivery)
      logger.info({ stripeSubId, invoiceId }, "[webhook/stripe] invoice.paid: invoice already in grant log — skipping");
      return;
    }

    // Update subscription period end + apply pending plan change if scheduled
    const subUpdate: Record<string, unknown> = {
      status:           "active",
      currentPeriodEnd: newPeriodEnd ?? undefined,
      updatedAt:        new Date(),
    };
    if (sub.pendingPlanSlug) {
      subUpdate.planSlug        = sub.pendingPlanSlug;
      subUpdate.pendingPlanSlug = null;
    }
    await tx
      .update(subscriptionsTable)
      .set(subUpdate)
      .where(eq(subscriptionsTable.id, sub.id));

    if (planCredits <= 0) return;

    // Step 2: grant subscription credits in the same transaction.
    // FOR UPDATE: locks the wallet row to prevent concurrent topups/reservations
    // from reading a stale balance and producing lost updates.
    const [existingCredits] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, sub.userId))
      .for("update")
      .limit(1);

    const prevSubCredits   = existingCredits?.subscriptionCredits ?? 0;
    const purchasedCredits = existingCredits?.purchasedCredits    ?? 0;
    // Query unsettled reserved-from-sub (renewal safety — see pool model in credits.ts).
    // newSub = planCredits - reservedFromSub ensures release cannot push sub above planCredits.
    const reservedResultW  = await tx.execute(sql`
      SELECT COALESCE(SUM(COALESCE(subscription_amount, 0)), 0) AS rsub
      FROM credit_ledger r
      WHERE r.user_id = ${sub.userId}
        AND r.type = 'reserve'
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger s
          WHERE s.related_ledger_id = r.id AND s.type IN ('consume', 'release')
        )
    `);
    const reservedFromSubW = Number((reservedResultW.rows[0] as Record<string, unknown>)?.rsub ?? 0);
    const newSubCreditsW   = planCredits - reservedFromSubW;
    const newAvailable     = newSubCreditsW + purchasedCredits;

    if (existingCredits) {
      await tx
        .update(userCreditsTable)
        .set({ subscriptionCredits: newSubCreditsW, availableCredits: newAvailable, updatedAt: new Date() })
        .where(eq(userCreditsTable.userId, sub.userId));
    } else {
      await tx.insert(userCreditsTable).values({
        userId:              sub.userId,
        availableCredits:    planCredits,
        subscriptionCredits: planCredits,
        purchasedCredits:    0,
        reservedCredits:     0,
        totalConsumed:       0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId:             sub.userId,
      type:               "provision",
      amount:             planCredits - prevSubCredits,
      balanceBefore:      existingCredits?.availableCredits ?? 0,
      balanceAfter:       newAvailable,
      pool:               "subscription",
      subscriptionAmount: newSubCreditsW,
      description:        `Renovación ${effectivePlanSlug} (invoice ${invoiceId}): ${planCredits} créditos del ciclo`,
    });

    credited = true;
  });

  // ── Update entitlement period + Stripe metadata (idempotent; outside main tx) ──
  if (credited && newPeriodEnd) {
    await upsertEntitlement({
      userId:           sub.userId,
      courseAccess:     true,
      toolAccessStatus: "active",
      toolAccessEndsAt: newPeriodEnd,
      source:           "stripe_renewal",
      planSlug:         effectivePlanSlug,
    });
    invalidateAccessCache(sub.userId);
    invalidatePlanCache(sub.userId);

    // If a scheduled downgrade was applied, update Stripe metadata to match the new plan.
    // Non-critical: a failure here doesn't affect credits or DB state.
    if (sub.pendingPlanSlug && sub.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          metadata: { plan_slug: sub.pendingPlanSlug },
        });
      } catch (err: any) {
        logger.warn({ err: err?.message, stripeSubId }, "[webhook/stripe] Could not update Stripe metadata after plan change — non-critical");
      }
    }

    logger.info({ userId: sub.userId, planSlug: effectivePlanSlug, prevPlanSlug: sub.planSlug, planCredits, invoiceId }, "[webhook/stripe] Renewal credits granted ✓");
  }
}

// ── invoice.payment_failed ────────────────────────────────────────────────────

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, _stripe: Stripe): Promise<void> {
  // Stripe v22: invoice.subscription removed; use invoice.parent.subscription_details.subscription
  const failSubRef  = invoice.parent?.subscription_details?.subscription;
  const stripeSubId = typeof failSubRef === "string" ? failSubRef : (failSubRef as Stripe.Subscription | undefined)?.id ?? null;

  if (!stripeSubId) return;

  logger.warn({ stripeSubId }, "[webhook/stripe] invoice.payment_failed");

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
    .limit(1);

  if (!sub) return;

  await db
    .update(subscriptionsTable)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(subscriptionsTable.id, sub.id));

  await upsertEntitlement({
    userId:           sub.userId,
    courseAccess:     true,
    toolAccessStatus: "expired",
    source:           "stripe_past_due",
    planSlug:         sub.planSlug,
  });
  invalidateAccessCache(sub.userId);
  invalidatePlanCache(sub.userId);

  logger.info({ userId: sub.userId }, "[webhook/stripe] Marked past_due from payment failure");
}

// handlePaymentIntentSucceeded (legacy reelsona_program product) removed.
// The /checkout/create-payment-intent endpoint and its Stripe webhook handler
// are discontinued. Any in-flight legacy payment_intent.succeeded events are
// simply ignored (no entry in EVENT_HANDLERS above).

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapStripeStatus(stripeStatus: string): string {
  const map: Record<string, string> = {
    active:              "active",
    trialing:            "trialing",
    past_due:            "past_due",
    canceled:            "canceled",
    unpaid:              "past_due",
    incomplete:          "past_due",
    incomplete_expired:  "canceled",
    paused:              "canceled",
  };
  return map[stripeStatus] ?? "canceled";
}

function getPlanSlugFromSub(sub: Stripe.Subscription): string | null {
  return sub.metadata?.plan_slug ?? null;
}

function getDefaultPeriodEnd(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}

export default router;
