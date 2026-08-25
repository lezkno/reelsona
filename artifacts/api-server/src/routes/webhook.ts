/**
 * POST /api/webhooks/stripe
 *
 * Mounted before express.json() so Stripe signature verification receives the
 * raw request body. Every handled event is processed before we acknowledge it:
 * failures return 500 so Stripe can retry. Handlers are designed to be
 * idempotent via provider IDs, invoice grant IDs, or deterministic upserts.
 */

import express, { Router } from "express";
import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe, getWebhookSecret } from "../lib/stripe";
import { PLAN_CREDITS, reconcilePurchasedCreditsRefund } from "../lib/credits";
import { upsertEntitlement } from "../lib/access";
import { invalidateAccessCache } from "../middleware/requireToolAccess";
import { invalidatePlanCache } from "../middleware/requirePlanAccess";
import { provisionPurchase, provisionPaymentElementSubscription } from "../lib/provision-purchase";
import { db } from "@workspace/db";
import { stripePriceConfigsTable } from "@workspace/db/schema";
import {
  purchases,
  subscriptionsTable,
  userCreditsTable,
  creditLedgerTable,
  invoiceCreditGrantsTable,
} from "@workspace/db/schema";
import { eq, sql, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  isTopupAmountValid,
  resolveVerifiedCreditAmount,
  resolveVerifiedPlanSlug,
} from "../lib/payment-validation";

const router = Router();

async function requireProvisioned(
  purchase: typeof purchases.$inferSelect,
  stripe: Stripe,
): Promise<void> {
  const ok = await provisionPurchase(purchase, stripe);
  if (!ok) {
    throw new Error(`Purchase ${purchase.id} provisioning failed; Stripe retry required`);
  }
}

router.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers["stripe-signature"] as string | undefined;

    let stripe: ReturnType<typeof getStripe>;
    let webhookSecret: string;
    try {
      stripe = getStripe();
      webhookSecret = getWebhookSecret();
    } catch (configErr: any) {
      logger.error({ err: configErr?.message }, "[webhook/stripe] Stripe is not configured");
      res.status(503).json({ received: false, reason: "not_configured" });
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
      logger.warn({ err: err?.message }, "[webhook/stripe] Signature verification failed");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    const handler = EVENT_HANDLERS[event.type];
    if (!handler) {
      logger.debug({ type: event.type }, "[webhook/stripe] Unhandled event type");
      res.json({ received: true, unhandled: true });
      return;
    }

    try {
      await handler(event.data.object as any, stripe, event.created);
      res.json({ received: true });
    } catch (err: any) {
      logger.error(
        { err: err?.message, type: event.type, eventId: event.id },
        "[webhook/stripe] Event processing failed — Stripe will retry",
      );
      res.status(500).json({ error: "Processing failed" });
    }
  }
);

const EVENT_HANDLERS: Record<string, (obj: any, stripe: Stripe, eventCreated?: number) => Promise<void>> = {
  "checkout.session.completed":          handleCheckoutCompleted,
  "checkout.session.async_payment_succeeded": handleCheckoutCompleted,
  "customer.subscription.updated":       handleSubscriptionUpdated,
  "customer.subscription.deleted":       handleSubscriptionDeleted,
  "invoice.paid":                        handleInvoicePaid,
  "invoice.payment_failed":              handleInvoicePaymentFailed,
  "subscription_schedule.released":      handleSubscriptionScheduleReleased,
  // Payment Element flow (no Checkout Session)
  "payment_intent.succeeded":            handlePaymentIntentSucceeded,
  "charge.refunded":                     handleChargeRefunded,
};

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, stripe: Stripe): Promise<void> {
  const sessionId = session.id;
  let planSlug = session.metadata?.plan_slug ?? "";   // let — may be corrected by price verification
  const product = session.metadata?.product ?? "";
  const userId = parseMetadataUserId(session.metadata?.user_id);

  logger.info({ sessionId, planSlug, product, paymentStatus: session.payment_status }, "[webhook/stripe] checkout.session.completed");

  if (session.payment_status !== "paid") {
    logger.info(
      { sessionId, paymentStatus: session.payment_status },
      "[webhook/stripe] Session not yet paid — will provision on async_payment_succeeded",
    );
    return;
  }

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
    await requireProvisioned(existing, stripe);
    return;
  }

  const email = (session.customer_details?.email ?? session.metadata?.email ?? "").toLowerCase().trim();
  const fullName = (session.customer_details?.name ?? session.metadata?.full_name ?? "").trim();
  const amountTotal = session.amount_total ?? 0;
  const currency = session.currency ?? "usd";
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  if (!email) {
    throw new Error(`Checkout ${sessionId} has no customer email; cannot provision safely`);
  }

  const isSubscription = product === "reelsona_subscription" || session.mode === "subscription";
  const isTopup = product === "reelsona_topup";
  let creditsAmount = parseInt(session.metadata?.credits_amount ?? "0", 10) || 0; // let — may be corrected below

  // ── Price verification ─────────────────────────────────────────────────────
  // Cross-check the metadata plan_slug against the Stripe line item that was
  // actually charged. Metadata is backend-written, but if a DB row was edited
  // after the session was created the wrong plan could be provisioned.
  if (isSubscription || isTopup) {
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 5 });
      const paidPriceId = lineItems.data[0]?.price?.id ?? null;
      if (paidPriceId) {
        const [priceRow] = await db
          .select({ planSlug: stripePriceConfigsTable.planSlug, creditAmount: stripePriceConfigsTable.creditAmount })
          .from(stripePriceConfigsTable)
          .where(eq(stripePriceConfigsTable.stripePriceId, paidPriceId))
          .limit(1);
        if (priceRow) {
          if (priceRow.planSlug !== planSlug) {
            logger.error(
              { sessionId, metadataPlan: planSlug, paidPlan: priceRow.planSlug, paidPriceId },
              "[webhook/stripe] PLAN MISMATCH: metadata plan_slug does not match paid price — overriding with actual paid plan",
            );
            planSlug = resolveVerifiedPlanSlug(planSlug, priceRow.planSlug);
          }
          if (priceRow.creditAmount && priceRow.creditAmount !== creditsAmount) {
            logger.warn(
              { sessionId, metadataCredits: creditsAmount, dbCredits: priceRow.creditAmount },
              "[webhook/stripe] Credits mismatch in checkout — using DB value",
            );
            creditsAmount = resolveVerifiedCreditAmount(creditsAmount, priceRow.creditAmount);
          }
        } else {
          throw new Error(
            `Paid Stripe price ${paidPriceId} is not configured for checkout ${sessionId}; refusing to provision`,
          );
        }
      }
    } catch (err: any) {
      logger.error(
        { sessionId, err: err?.message },
        "[webhook/stripe] Price verification failed — refusing to provision; Stripe will retry",
      );
      throw err;
    }
  }

  const purchaseType: "subscription" | "topup" | "program" =
    isSubscription ? "subscription" : isTopup ? "topup" : "program";

  const insertedRows = await db
    .insert(purchases)
    .values({
      provider: "stripe",
      providerSessionId: sessionId,
      providerCustomerId: customerId,
      providerPaymentIntentId: paymentIntentId,
      email,
      fullName,
      amountTotal,
      currency,
      status: "completed",
      toolAccessDays: 365,
      purchaseType,
      planSlug: planSlug || null,
      creditsPurchased: creditsAmount > 0 ? creditsAmount : null,
      userId,
    })
    .returning();

  await requireProvisioned(insertedRows[0], stripe);
}

/**
 * True when this Stripe subscription id was replaced by a Founder purchase.
 * Late lifecycle events (updated / invoice.paid / payment_failed) for the old
 * subscription must be acknowledged as no-ops instead of erroring, or Stripe
 * retries them forever. The superseded id mapping is kept permanently on the
 * subscriptions row.
 */
async function isSupersededSubscription(stripeSubId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.supersededStripeSubscriptionId, stripeSubId))
    .limit(1);
  return !!row;
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription, _stripe: Stripe, eventCreated = 0): Promise<void> {
  const stripeSubId = sub.id;
  const status = mapStripeStatus(sub.status);
  const cancelAtPeriodEnd = sub.cancel_at_period_end;

  const firstItem = sub.items?.data?.[0] as any;
  const periodStart: number | null = firstItem?.current_period_start ?? sub.billing_cycle_anchor ?? null;
  const periodEnd: number | null = firstItem?.current_period_end ?? null;

  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
    .for("update")
    .limit(1);

  if (!existing) {
    if (await isSupersededSubscription(stripeSubId)) {
      logger.info({ stripeSubId }, "[webhook/stripe] subscription.updated for superseded (Founder-swapped) subscription — acknowledged no-op");
      return;
    }
    // Race condition: subscription.updated may arrive before invoice.paid completes
    // provisioning (especially with Payment Element flow). Log and return 200 so
    // Stripe does not retry — the subscription state will be synced when the next
    // event arrives or on the next invoice cycle.
    logger.warn({ stripeSubId }, "[webhook/stripe] subscription.updated arrived before local subscription exists — acknowledged no-op (will be provisioned by invoice.paid)");
    return;
  }
  if (eventCreated > 0 && existing.lastStripeEventCreatedAt &&
      existing.lastStripeEventCreatedAt.getTime() >= eventCreated * 1000) {
    logger.info({ stripeSubId, eventCreated }, "[webhook/stripe] Ignoring stale subscription.updated event");
    return;
  }

  const priceId = firstItem?.price?.id ?? null;
  let planSlugFromPrice: string | null = null;
  if (priceId) {
    const [priceRow] = await db
      .select({ planSlug: stripePriceConfigsTable.planSlug })
      .from(stripePriceConfigsTable)
      .where(eq(stripePriceConfigsTable.stripePriceId, priceId))
      .limit(1);
    planSlugFromPrice = priceRow?.planSlug ?? null;
  }
  const resolvedPlanSlug = planSlugFromPrice ?? getPlanSlugFromSub(sub) ?? existing.planSlug;

  const scheduleApplied = !!(
    planSlugFromPrice &&
    existing.pendingPlanSlug &&
    planSlugFromPrice === existing.pendingPlanSlug
  );

  logger.info(
    { stripeSubId, status, resolvedPlanSlug, priceId, scheduleApplied },
    "[webhook/stripe] subscription.updated",
  );

  await db
    .update(subscriptionsTable)
    .set({
      status,
      planSlug: resolvedPlanSlug,
      cancelAtPeriodEnd,
      currentPeriodStart: periodStart ? new Date(periodStart * 1000) : undefined,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
      ...(scheduleApplied ? { pendingPlanSlug: null } : {}),
      updatedAt: new Date(),
      lastStripeEventCreatedAt: eventCreated > 0 ? new Date(eventCreated * 1000) : undefined,
    })
    .where(eq(subscriptionsTable.id, existing.id));

  const toolActive = status === "active" || status === "trialing";
  const newEndsAt = periodEnd ? new Date(periodEnd * 1000) : null;

  await upsertEntitlement({
    userId: existing.userId,
    courseAccess: true,
    toolAccessStatus: toolActive ? "active" : "expired",
    toolAccessEndsAt: newEndsAt,
    source: "stripe_subscription",
    planSlug: resolvedPlanSlug,
  });
  invalidateAccessCache(existing.userId);
  invalidatePlanCache(existing.userId);

  logger.info(
    { userId: existing.userId, status, resolvedPlanSlug, scheduleApplied },
    "[webhook/stripe] Entitlement updated from subscription.updated",
  );
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription, _stripe: Stripe, eventCreated = 0): Promise<void> {
  const stripeSubId = sub.id;
  const firstItemDel = sub.items?.data?.[0] as any;
  const periodEnd: number | null = firstItemDel?.current_period_end ?? null;
  logger.info({ stripeSubId }, "[webhook/stripe] subscription.deleted");

  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
    .for("update")
    .limit(1);

  if (!existing) return;
  if (eventCreated > 0 && existing.lastStripeEventCreatedAt &&
      existing.lastStripeEventCreatedAt.getTime() >= eventCreated * 1000) {
    logger.info({ stripeSubId, eventCreated }, "[webhook/stripe] Ignoring stale subscription.deleted event");
    return;
  }

  await db
    .update(subscriptionsTable)
    .set({
      status: "canceled",
      updatedAt: new Date(),
      lastStripeEventCreatedAt: eventCreated > 0 ? new Date(eventCreated * 1000) : undefined,
    })
    .where(eq(subscriptionsTable.id, existing.id));

  await upsertEntitlement({
    userId: existing.userId,
    courseAccess: true,
    toolAccessStatus: "expired",
    toolAccessEndsAt: periodEnd ? new Date(periodEnd * 1000) : new Date(),
    source: "stripe_subscription",
    planSlug: existing.planSlug,
  });
  invalidateAccessCache(existing.userId);
  invalidatePlanCache(existing.userId);

  logger.info({ userId: existing.userId }, "[webhook/stripe] Subscription canceled — entitlement expired");
}

async function handleInvoicePaid(invoice: Stripe.Invoice, stripe: Stripe, eventCreated = 0): Promise<void> {
  const subRef = invoice.parent?.subscription_details?.subscription;
  const stripeSubId = typeof subRef === "string" ? subRef : (subRef as Stripe.Subscription | undefined)?.id ?? null;

  if (!stripeSubId) {
    logger.debug("[webhook/stripe] invoice.paid without subscription — skipping");
    return;
  }

  const invoiceId: string | null = invoice.id ?? null;
  if (!invoiceId) {
    throw new Error(`invoice.paid for ${stripeSubId} has no invoice ID`);
  }

  const billingReason = invoice.billing_reason ?? "unknown";
  if (billingReason !== "subscription_cycle") {
    logger.info(
      { stripeSubId, invoiceId, billingReason },
      "[webhook/stripe] invoice.paid: not a subscription_cycle",
    );

    if (billingReason === "subscription_create") {
      // Check if this subscription was already provisioned via the Checkout Session path.
      // If so, the local subscription row already exists — just update its period.
      // If not, this is a Payment Element subscription that needs provisioning here.
      const [existingSub] = await db
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
        .limit(1);

      if (existingSub) {
        const periodEndTs = invoice.period_end;
        await db
          .update(subscriptionsTable)
          .set({
            status: "active",
            currentPeriodEnd: periodEndTs ? new Date(periodEndTs * 1000) : undefined,
            updatedAt: new Date(),
            lastStripeEventCreatedAt: eventCreated > 0 ? new Date(eventCreated * 1000) : undefined,
          })
          .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId));
        logger.info({ stripeSubId }, "[webhook/stripe] invoice.paid subscription_create: existing row updated (Checkout Session path)");
      } else {
        logger.info({ stripeSubId, invoiceId }, "[webhook/stripe] invoice.paid subscription_create: no local row — provisioning via Payment Element path");
        await handlePaymentElementSubscriptionCreate(invoice, stripe);
      }
    } else if (billingReason === "subscription_update") {
      const periodEndTs = invoice.period_end;
      await db
        .update(subscriptionsTable)
          .set({
            status: "active",
            currentPeriodEnd: periodEndTs ? new Date(periodEndTs * 1000) : undefined,
            updatedAt: new Date(),
            lastStripeEventCreatedAt: eventCreated > 0 ? new Date(eventCreated * 1000) : undefined,
          })
        .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId));
    }

    return;
  }

  const newPeriodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : null;

  logger.info({ stripeSubId, invoiceId, billingReason, newPeriodEnd: newPeriodEnd?.toISOString() }, "[webhook/stripe] invoice.paid (subscription_cycle)");

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
    .for("update")
    .limit(1);

  if (!sub) {
    if (await isSupersededSubscription(stripeSubId)) {
      logger.info({ stripeSubId, invoiceId }, "[webhook/stripe] invoice.paid for superseded (Founder-swapped) subscription — acknowledged no-op");
      return;
    }
    throw new Error(`invoice.paid arrived before local subscription ${stripeSubId} exists`);
  }
  if (eventCreated > 0 && sub.lastStripeEventCreatedAt &&
      sub.lastStripeEventCreatedAt.getTime() >= eventCreated * 1000) {
    logger.info({ stripeSubId, invoiceId, eventCreated }, "[webhook/stripe] Ignoring stale invoice.paid event");
    return;
  }

  if (sub.planSlug === "founder") {
    await db
      .update(subscriptionsTable)
      .set({
        status: "active",
        currentPeriodEnd: newPeriodEnd ?? undefined,
        updatedAt: new Date(),
        lastStripeEventCreatedAt: eventCreated > 0 ? new Date(eventCreated * 1000) : undefined,
      })
      .where(eq(subscriptionsTable.id, sub.id));
    logger.info({ stripeSubId, invoiceId }, "[webhook/stripe] invoice.paid: Founder — updated period end only (cron is grant authority)");
    return;
  }

  const nonProrationLines = (invoice.lines?.data ?? []).filter((l: any) => !l.proration);
  const invoiceLinePrice = (nonProrationLines[0] as any)?.price?.id ?? null;
  let invoicePlanSlug: string | null = null;
  if (invoiceLinePrice) {
    const [priceRow] = await db
      .select({ planSlug: stripePriceConfigsTable.planSlug })
      .from(stripePriceConfigsTable)
      .where(eq(stripePriceConfigsTable.stripePriceId, invoiceLinePrice))
      .limit(1);
    invoicePlanSlug = priceRow?.planSlug ?? null;
  }
  const effectivePlanSlug = invoicePlanSlug ?? sub.pendingPlanSlug ?? sub.planSlug;
  const planCredits = PLAN_CREDITS[effectivePlanSlug] ?? 0;
  const planChanged = effectivePlanSlug !== sub.planSlug;
  let credited = false;

  await db.transaction(async (tx) => {
    const claimed = await tx
      .insert(invoiceCreditGrantsTable)
      .values({
        stripeInvoiceId: invoiceId,
        userId: sub.userId,
        planSlug: effectivePlanSlug,
        creditsGranted: planCredits,
      })
      .onConflictDoNothing()
      .returning({ id: invoiceCreditGrantsTable.id });

    if (claimed.length === 0) {
      logger.info({ stripeSubId, invoiceId }, "[webhook/stripe] invoice.paid: invoice already in grant log — skipping");
      return;
    }

    const subUpdate: Record<string, unknown> = {
      status: "active",
      currentPeriodEnd: newPeriodEnd ?? undefined,
      updatedAt: new Date(),
      lastStripeEventCreatedAt: eventCreated > 0 ? new Date(eventCreated * 1000) : undefined,
    };
    if (planChanged) {
      subUpdate.planSlug = effectivePlanSlug;
      subUpdate.pendingPlanSlug = null;
    }
    await tx
      .update(subscriptionsTable)
      .set(subUpdate)
      .where(eq(subscriptionsTable.id, sub.id));

    if (planCredits <= 0) return;

    const [existingCredits] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, sub.userId))
      .for("update")
      .limit(1);

    const prevSubCredits = existingCredits?.subscriptionCredits ?? 0;
    const purchasedCredits = existingCredits?.purchasedCredits ?? 0;
    const reservedResultW = await tx.execute(sql`
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
    const newSubCreditsW = planCredits - reservedFromSubW;
    const newAvailable = newSubCreditsW + purchasedCredits;

    if (existingCredits) {
      await tx
        .update(userCreditsTable)
        .set({ subscriptionCredits: newSubCreditsW, availableCredits: newAvailable, updatedAt: new Date() })
        .where(eq(userCreditsTable.userId, sub.userId));
    } else {
      await tx.insert(userCreditsTable).values({
        userId: sub.userId,
        availableCredits: planCredits,
        subscriptionCredits: planCredits,
        purchasedCredits: 0,
        reservedCredits: 0,
        totalConsumed: 0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId: sub.userId,
      type: "provision",
      amount: planCredits - prevSubCredits,
      balanceBefore: existingCredits?.availableCredits ?? 0,
      balanceAfter: newAvailable,
      pool: "subscription",
      subscriptionAmount: newSubCreditsW,
      description: `Renovación ${effectivePlanSlug} (invoice ${invoiceId}): ${planCredits} créditos del ciclo`,
    });

    credited = true;
  });

  if (credited && newPeriodEnd) {
    await upsertEntitlement({
      userId: sub.userId,
      courseAccess: true,
      toolAccessStatus: "active",
      toolAccessEndsAt: newPeriodEnd,
      source: "stripe_renewal",
      planSlug: effectivePlanSlug,
    });
    invalidateAccessCache(sub.userId);
    invalidatePlanCache(sub.userId);

    if (planChanged && sub.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          metadata: { plan_slug: effectivePlanSlug },
        });
      } catch (err: any) {
        logger.warn(
          { err: err?.message, stripeSubId, effectivePlanSlug },
          "[webhook/stripe] Metadata sync after plan change failed — price-based webhook lookup remains authoritative",
        );
      }
    }

    logger.info(
      { userId: sub.userId, effectivePlanSlug, prevPlanSlug: sub.planSlug, invoiceLinePrice, planCredits, invoiceId },
      "[webhook/stripe] Renewal credits granted ✓",
    );
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, _stripe: Stripe, eventCreated = 0): Promise<void> {
  const failSubRef = invoice.parent?.subscription_details?.subscription;
  const stripeSubId = typeof failSubRef === "string" ? failSubRef : (failSubRef as Stripe.Subscription | undefined)?.id ?? null;

  if (!stripeSubId) return;

  logger.warn({ stripeSubId }, "[webhook/stripe] invoice.payment_failed");

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.stripeSubscriptionId, stripeSubId))
    .for("update")
    .limit(1);

  if (!sub) {
    if (await isSupersededSubscription(stripeSubId)) {
      logger.info({ stripeSubId }, "[webhook/stripe] invoice.payment_failed for superseded (Founder-swapped) subscription — acknowledged no-op");
      return;
    }
    // Unknown subscription — possibly created before this deployment or already cancelled
    // on Stripe's side without a local record. Return no-op so Stripe stops retrying.
    logger.warn({ stripeSubId }, "[webhook/stripe] invoice.payment_failed for unknown subscription — acknowledged no-op");
    return;
  }
  if (eventCreated > 0 && sub.lastStripeEventCreatedAt &&
      sub.lastStripeEventCreatedAt.getTime() >= eventCreated * 1000) {
    logger.info({ stripeSubId, eventCreated }, "[webhook/stripe] Ignoring stale invoice.payment_failed event");
    return;
  }

  await db
    .update(subscriptionsTable)
    .set({
      status: "past_due",
      updatedAt: new Date(),
      lastStripeEventCreatedAt: eventCreated > 0 ? new Date(eventCreated * 1000) : undefined,
    })
    .where(eq(subscriptionsTable.id, sub.id));

  await upsertEntitlement({
    userId: sub.userId,
    courseAccess: true,
    toolAccessStatus: "expired",
    source: "stripe_past_due",
    planSlug: sub.planSlug,
  });
  invalidateAccessCache(sub.userId);
  invalidatePlanCache(sub.userId);

  logger.info({ userId: sub.userId }, "[webhook/stripe] Marked past_due from payment failure");
}

async function handleSubscriptionScheduleReleased(
  schedule: Stripe.SubscriptionSchedule,
  _stripe: Stripe,
): Promise<void> {
  const scheduleId = schedule.id;

  await db
    .update(subscriptionsTable)
    .set({ stripeScheduleId: null, updatedAt: new Date() })
    .where(eq(subscriptionsTable.stripeScheduleId, scheduleId));

  logger.info({ scheduleId }, "[webhook/stripe] Subscription schedule released — stripeScheduleId cleared ✓");
}

// ── Payment Element helpers ────────────────────────────────────────────────────

/**
 * Called by handleInvoicePaid when billing_reason=subscription_create and
 * there is no local subscription row (i.e. Payment Element path, no Checkout Session).
 * Expands the Stripe subscription for metadata + period, then provisions the user.
 */
async function handlePaymentElementSubscriptionCreate(
  invoice: Stripe.Invoice,
  stripe: Stripe,
): Promise<void> {
  const subRef    = invoice.parent?.subscription_details?.subscription;
  const stripeSubId = typeof subRef === "string" ? subRef : (subRef as Stripe.Subscription | undefined)?.id ?? null;
  if (!stripeSubId) throw new Error("Payment Element invoice.paid: no subscription ID on invoice");

  const stripeSub = await stripe.subscriptions.retrieve(stripeSubId, { expand: ["items"] });
  const metadata  = stripeSub.metadata ?? {};

  let planSlug = metadata.plan_slug ?? "";   // let — may be corrected by price verification
  const userId = parseMetadataUserId(metadata.user_id);
  const email    = (metadata.email ?? "").toLowerCase().trim();
  const fullName = (metadata.full_name ?? "").trim();

  if (!planSlug || !email) {
    throw new Error(
      `Payment Element subscription ${stripeSubId} is missing plan_slug or email in metadata — cannot provision`,
    );
  }

  const firstItem    = (stripeSub.items?.data?.[0] as any) ?? null;

  // ── Price verification ─────────────────────────────────────────────────────
  // The subscription carries the actual Stripe price that was charged.
  // Cross-check it against the DB to catch any plan_slug / price mismatch.
  const paidPriceId = firstItem?.price?.id ?? null;
  if (paidPriceId) {
    const [priceRow] = await db
      .select({ planSlug: stripePriceConfigsTable.planSlug })
      .from(stripePriceConfigsTable)
      .where(eq(stripePriceConfigsTable.stripePriceId, paidPriceId))
      .limit(1);
    if (priceRow && priceRow.planSlug !== planSlug) {
      logger.error(
        { stripeSubId, metadataPlan: planSlug, paidPlan: priceRow.planSlug, paidPriceId },
        "[webhook/stripe] PLAN MISMATCH in Payment Element subscription — overriding with actual paid plan",
      );
      planSlug = resolveVerifiedPlanSlug(planSlug, priceRow.planSlug);
    } else if (!priceRow) {
      throw new Error(
        `Paid Stripe price ${paidPriceId} is not configured for subscription ${stripeSubId}; refusing to provision`,
      );
    }
  }
  const periodEndTs: number | null =
    firstItem?.current_period_end ?? (stripeSub as any).current_period_end ?? null;
  const periodEnd = periodEndTs
    ? new Date(periodEndTs * 1000)
    : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; })();

  const stripeCustomerId =
    typeof stripeSub.customer === "string"
      ? stripeSub.customer
      : (stripeSub.customer as any)?.id ?? null;

  const initialInvoiceId = invoice.id ?? null;

  logger.info(
    { stripeSubId, planSlug, email, periodEnd: periodEnd.toISOString() },
    "[webhook/stripe] Provisioning Payment Element subscription",
  );

  await provisionPaymentElementSubscription({
    stripeSubId,
    stripeCustomerId,
    initialInvoiceId,
    email,
    fullName,
    planSlug,
    userId,
    periodEnd,
    stripe,
  });
}

/**
 * Handles payment_intent.succeeded for topup purchases made via Payment Element.
 * Subscription payment intents are handled through invoice.paid — this handler
 * only acts on PIs with metadata.product === "reelsona_topup".
 *
 * IMPORTANT: Add payment_intent.succeeded to your Stripe webhook endpoint in the
 * Stripe Dashboard for this to fire.
 */
async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent, stripe: Stripe): Promise<void> {
  const metadata = pi.metadata ?? {};
  const product  = metadata.product ?? "";

  if (product !== "reelsona_topup") {
    logger.debug({ piId: pi.id, product }, "[webhook/stripe] payment_intent.succeeded: not a topup — skipping");
    return;
  }

  const piId          = pi.id;
  const planSlug      = metadata.plan_slug ?? "";
  const userId        = parseMetadataUserId(metadata.user_id);
  const email         = (metadata.email ?? "").toLowerCase().trim();
  const fullName      = (metadata.full_name ?? "").trim();
  let creditsAmount   = parseInt(metadata.credits_amount ?? "0", 10); // let — may be corrected by DB
  const customerId    = typeof pi.customer === "string" ? pi.customer : (pi.customer as any)?.id ?? null;

  logger.info({ piId, planSlug, email, creditsAmount }, "[webhook/stripe] payment_intent.succeeded (topup)");

  if (!email || creditsAmount <= 0) {
    throw new Error(`PaymentIntent ${piId} is missing email or credits metadata; cannot provision safely`);
  }

  // ── Amount + credit verification ───────────────────────────────────────────
  // Verify the charged amount and credit count against the DB config so a
  // metadata/DB mismatch can never silently grant the wrong number of credits.
  if (planSlug) {
    const [priceRow] = await db
      .select({ amountCents: stripePriceConfigsTable.amountCents, creditAmount: stripePriceConfigsTable.creditAmount })
      .from(stripePriceConfigsTable)
      .where(eq(stripePriceConfigsTable.planSlug, planSlug))
      .limit(1);
    if (priceRow) {
      const paidAmount = pi.amount_received ?? 0;
      if (!isTopupAmountValid(paidAmount, priceRow.amountCents)) {
        logger.error(
          { piId, planSlug, paidAmount, expectedAmount: priceRow.amountCents },
          "[webhook/stripe] AMOUNT MISMATCH for topup — refusing to provision",
        );
        throw new Error(`PaymentIntent ${piId} amount does not match configured topup price`);
      }
      if (creditsAmount !== priceRow.creditAmount) {
        logger.warn(
          { piId, metadataCredits: creditsAmount, dbCredits: priceRow.creditAmount },
          "[webhook/stripe] Credits mismatch for topup — using DB value",
        );
        creditsAmount = resolveVerifiedCreditAmount(creditsAmount, priceRow.creditAmount);
      }
    } else {
      throw new Error(
        `Topup plan ${planSlug} is not configured in stripe_price_configs; refusing to provision PaymentIntent ${piId}`,
      );
    }
  }

  // Idempotency via providerSessionId = piId (same pattern as handleCheckoutCompleted)
  const [existing] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.providerSessionId, piId))
    .limit(1);

  if (existing?.provisionedAt) {
    logger.info({ piId }, "[webhook/stripe] payment_intent.succeeded: already provisioned — skipping");
    return;
  }

  if (existing) {
    logger.info({ piId }, "[webhook/stripe] payment_intent.succeeded: unprovisioned row found — retrying");
    await requireProvisioned(existing, stripe);
    return;
  }

  const [inserted] = await db
    .insert(purchases)
    .values({
      provider:          "stripe",
      providerSessionId: piId,
      providerCustomerId: customerId,
      providerPaymentIntentId: piId,
      email,
      fullName,
      amountTotal:       pi.amount_received ?? 0,
      currency:          pi.currency ?? "usd",
      status:            "completed",
      toolAccessDays:    0,
      purchaseType:      "topup",
      planSlug:          planSlug || null,
      creditsPurchased:  creditsAmount,
      userId,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    // Concurrent insert won the race — fetch and provision the winning row
    const [race] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.providerSessionId, piId))
      .limit(1);
    if (race && !race.provisionedAt) await requireProvisioned(race, stripe);
    return;
  }

  await requireProvisioned(inserted, stripe);
}

/**
 * Handles full refunds for credit-package charges. Subscription refunds are
 * intentionally not converted into credit deductions here: subscription
 * credits are cycle-scoped and have no single refundable package to reverse.
 */
async function handleChargeRefunded(charge: Stripe.Charge, _stripe: Stripe): Promise<void> {

  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  if (!paymentIntentId) {
    logger.warn({ chargeId: charge.id }, "[webhook/stripe] Refunded charge has no PaymentIntent — skipping safely");
    return;
  }

  const [purchase] = await db
    .select()
    .from(purchases)
    .where(or(
      eq(purchases.providerPaymentIntentId, paymentIntentId),
      eq(purchases.providerSessionId, paymentIntentId),
    ))
    .limit(1);

  if (!purchase || purchase.purchaseType !== "topup") {
    logger.info(
      { chargeId: charge.id, paymentIntentId },
      "[webhook/stripe] Refunded charge is not a credit topup — no credit reversal",
    );
    return;
  }

  if (!purchase.userId) {
    logger.error(
      { chargeId: charge.id, paymentIntentId, purchaseId: purchase.id },
      "[webhook/stripe] Refunded topup has no userId — refusing to guess account",
    );
    return;
  }

  const result = await reconcilePurchasedCreditsRefund({
    purchaseId: purchase.id,
    userId: purchase.userId,
    refundAmountCents: charge.amount_refunded ?? 0,
    refundKey: `charge:${charge.id}:${charge.amount_refunded ?? 0}`,
  });

  logger.info(
    {
      chargeId: charge.id,
      paymentIntentId,
      purchaseId: purchase.id,
      userId: purchase.userId,
      reversed: result.reversed,
      alreadyProcessed: result.alreadyProcessed,
      shortfall: result.shortfall,
    },
    "[webhook/stripe] Refunded topup credits reconciled",
  );
}

function mapStripeStatus(stripeStatus: string): string {
  const map: Record<string, string> = {
    active: "active",
    trialing: "trialing",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "past_due",
    incomplete: "past_due",
    incomplete_expired: "canceled",
    paused: "canceled",
  };
  return map[stripeStatus] ?? "canceled";
}

function getPlanSlugFromSub(sub: Stripe.Subscription): string | null {
  return sub.metadata?.plan_slug ?? null;
}

function parseMetadataUserId(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default router;
