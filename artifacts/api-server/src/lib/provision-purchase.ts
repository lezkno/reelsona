/**
 * provision-purchase.ts
 *
 * Single source of truth for provisioning a Stripe purchase, regardless of
 * whether it is called:
 *   - immediately after checkout.session.completed, or
 *   - by the scheduler's unprovisioned-purchase recovery sweep.
 *
 * Contract:
 *   - Sets purchases.provisionedAt when it succeeds (caller must not do so again).
 *   - Never throws — logs and returns without setting provisionedAt on failure so
 *     the scheduler sweep will retry on the next cycle.
 *   - Topups NEVER create users or touch tool-access entitlements (security invariant).
 *   - Subscriptions always call provisionUser BEFORE creating the subscription row.
 *   - All subscription credit grants use the real Stripe period end to prevent
 *     invoice.paid double-grants (see invoice.paid handler in webhook.ts).
 */

import type Stripe from "stripe";
import { db } from "@workspace/db";
import {
  purchases,
  subscriptionsTable,
  users,
  userCreditsTable,
  creditLedgerTable,
  invoiceCreditGrantsTable,
  userEntitlements,
} from "@workspace/db/schema";
import { eq, isNull, and, or, count, sql } from "drizzle-orm";
import { provisionUser } from "./provision";
import { PLAN_CREDITS, FOUNDER_MAX_SEATS } from "./credits";
import { logger } from "./logger";
import { invalidateAccessCache } from "../middleware/requireToolAccess";
import { invalidatePlanCache } from "../middleware/requirePlanAccess";

/**
 * PostgreSQL advisory lock key for Founder seat allocation.
 * Any stable bigint — chosen to avoid collision with other advisory locks.
 * Acquired with pg_advisory_xact_lock() so it's automatically released
 * when the transaction commits or rolls back.
 */
const FOUNDER_SEAT_LOCK_KEY = BigInt("7823456789012");

// ── Public entry point ─────────────────────────────────────────────────────────

/**
 * Provision (or re-provision) a single purchase based on its purchaseType.
 *
 * Call this from:
 *   - webhook.ts immediately after inserting the purchase row
 *   - scheduler.ts recovery sweep for purchases with provisionedAt = null
 *
 * Returns true if provisioned successfully (provisionedAt was stamped).
 */
export async function provisionPurchase(
  purchase: typeof purchases.$inferSelect,
  stripe: Stripe,
): Promise<boolean> {
  const { email, fullName, purchaseType, planSlug, creditsPurchased, providerCustomerId, providerSessionId } = purchase;

  try {
    if (purchaseType === "topup") {
      await provisionTopup({ purchase, creditsPurchased, email });
    } else if (purchaseType === "subscription" && planSlug) {
      await provisionSubscription({ purchase, email, fullName, planSlug, providerCustomerId, providerSessionId, stripe });
    } else {
      // Legacy program purchase
      await provisionLegacyProgram({ purchase, email, fullName });
    }

    // Mark provisioned on success
    await db
      .update(purchases)
      .set({ provisionedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchases.id, purchase.id));

    logger.info(
      { purchaseId: purchase.id, email, purchaseType },
      "[provision-purchase] Provisioned successfully",
    );
    return true;
  } catch (err: any) {
    logger.error(
      { purchaseId: purchase.id, email, purchaseType, err: err?.message },
      "[provision-purchase] Provision failed — will retry next cycle",
    );
    return false;
  }
}

// ── Topup ──────────────────────────────────────────────────────────────────────
// SECURITY: topups NEVER create accounts or modify tool-access entitlements.
//
// CONCURRENCY & ATOMICITY:
//   1. Atomic claim:  UPDATE purchases SET provisioned_at = NOW() WHERE id = ?
//                     AND provisioned_at IS NULL RETURNING id
//      Two concurrent retries both try this; only one gets a row back.
//      The loser sees 0 rows and exits cleanly — no double grant possible.
//   2. Wallet + ledger writes happen in the same transaction as the claim.
//      If either fails, the transaction rolls back, provisioned_at stays NULL,
//      and the next scheduler sweep retries cleanly.

async function provisionTopup({
  purchase,
  creditsPurchased,
  email,
}: {
  purchase: typeof purchases.$inferSelect;
  creditsPurchased: number | null | undefined;
  email: string;
}): Promise<void> {
  // Topups require an existing account (they're purchased from within the app)
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, email.toLowerCase()))
    .limit(1);

  if (!existingUser) {
    logger.error(
      { email, purchaseId: purchase.id },
      "[provision-purchase] Topup: user not found — requires prior account (support intervention needed)",
    );
    throw new Error(`Topup: no user account found for ${email}`);
  }

  const credits = creditsPurchased ?? 0;
  if (credits <= 0) {
    throw new Error(`Topup: creditsPurchased is ${credits} — nothing to grant`);
  }

  // ── Single atomic transaction: claim + wallet + ledger ────────────────────
  await db.transaction(async (tx) => {
    // Atomic claim: set provisionedAt WHERE it IS NULL — only one concurrent caller wins
    const claimed = await tx
      .update(purchases)
      .set({ userId: existingUser.id, provisionedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(purchases.id, purchase.id), isNull(purchases.provisionedAt)))
      .returning({ id: purchases.id });

    if (claimed.length === 0) {
      // Another concurrent request already claimed this purchase
      logger.info({ purchaseId: purchase.id }, "[provision-purchase] Topup: already claimed — concurrent retry, skipping");
      return;
    }

    // Lock wallet row FOR UPDATE — two distinct topup purchases for the same user
    // arriving concurrently would both pass their per-purchase claim but could
    // race on the shared wallet. The FOR UPDATE serializes them.
    const [existing] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, existingUser.id))
      .for("update")
      .limit(1);

    const prevPurchased = existing?.purchasedCredits    ?? 0;
    const subCredits    = existing?.subscriptionCredits ?? 0;
    const newPurchased  = prevPurchased + credits;
    const newAvailable  = subCredits + newPurchased;

    if (existing) {
      await tx
        .update(userCreditsTable)
        .set({ purchasedCredits: newPurchased, availableCredits: newAvailable, updatedAt: new Date() })
        .where(eq(userCreditsTable.userId, existingUser.id));
    } else {
      await tx.insert(userCreditsTable).values({
        userId:              existingUser.id,
        availableCredits:    credits,
        subscriptionCredits: 0,
        purchasedCredits:    credits,
        reservedCredits:     0,
        totalConsumed:       0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId:          existingUser.id,
      type:            "provision",
      amount:          credits,
      balanceBefore:   existing?.availableCredits ?? 0,
      balanceAfter:    newAvailable,
      pool:            "purchased",
      purchasedAmount: credits,
      description:     `Topup: ${credits} créditos comprados (compra ${purchase.id})`,
    });
    // provisionedAt was already stamped atomically in the claim above.
  });
}

// ── Subscription ───────────────────────────────────────────────────────────────

async function provisionSubscription({
  purchase,
  email,
  fullName,
  planSlug,
  providerCustomerId,
  providerSessionId,
  stripe,
}: {
  purchase: typeof purchases.$inferSelect;
  email: string;
  fullName: string | null | undefined;
  planSlug: string;
  providerCustomerId: string | null | undefined;
  providerSessionId: string | null | undefined;
  stripe: Stripe;
}): Promise<void> {
  // ── Fetch real Stripe subscription (REQUIRED) ────────────────────────────────
  // Without the real Stripe subscription ID, every future lifecycle webhook
  // (invoice.paid, subscription.updated, subscription.deleted) cannot find this
  // subscription row → the subscriber's access and renewal credits silently break.
  // If retrieval fails, throw so provisionedAt stays null and the scheduler retries.
  if (!providerSessionId) {
    throw new Error("Subscription provisioning requires providerSessionId to look up Stripe data");
  }

  let stripeSubId: string | null = null;
  let realPeriodEnd: Date | null = null;
  let initialInvoiceId: string | null = null;

  try {
    const session = await stripe.checkout.sessions.retrieve(providerSessionId, {
      expand: ["subscription", "subscription.latest_invoice"],
    });
    const stripeSub = session.subscription as any;
    if (stripeSub?.id) stripeSubId = stripeSub.id;
    // Stripe v22: current_period_end moved from Subscription root to subscription items.
    // Read from first item; fall back to root for any API version compatibility.
    const subPeriodEnd: number | undefined =
      stripeSub?.items?.data?.[0]?.current_period_end ??
      stripeSub?.current_period_end;
    if (subPeriodEnd) {
      realPeriodEnd = new Date(subPeriodEnd * 1000);
    }
    if (typeof stripeSub?.latest_invoice === "object" && stripeSub.latest_invoice?.id) {
      initialInvoiceId = stripeSub.latest_invoice.id as string;
    } else if (typeof stripeSub?.latest_invoice === "string") {
      initialInvoiceId = stripeSub.latest_invoice;
    }
  } catch (err: any) {
    // REQUIRED: do not provision with fabricated data — leave unprovisioned for retry
    logger.error(
      { err: err?.message, providerSessionId },
      "[provision-purchase] Stripe session retrieval failed — not provisioning; scheduler will retry",
    );
    throw new Error(`Stripe session retrieval failed: ${err?.message}`);
  }

  if (!stripeSubId) {
    throw new Error(
      `Stripe session ${providerSessionId} has no subscription — cannot provision without Stripe subscription ID`,
    );
  }

  const periodEnd = realPeriodEnd ?? defaultPeriodEnd();

  const planCredits = PLAN_CREDITS[planSlug] ?? 0;

  if (planSlug === "founder") {
    // ── FOUNDER PATH ────────────────────────────────────────────────────────
    //
    // Hard seat cap is enforced here with an advisory lock.
    // The subscription row, entitlement, and credits are all created INSIDE
    // the locked transaction, so a failed seat check leaves NO persistent state:
    // no active subscription row, no tool access, no credits.
    //
    // Capacity handling for a paid checkout that loses the race:
    //   - tx rolls back → no subscription, no entitlement, no credits granted
    //   - provisionedAt stays NULL → purchase is NOT marked provisioned
    //   - Scheduler recovery sweep retries each cycle → logs ERROR each time
    //   - Ops must resolve manually (issue refund / waitlist entry)
    //
    // Step 1: create user account ONLY — no entitlement yet so no access leaks
    const result = await provisionUser({
      email,
      name:             fullName ?? email,
      toolAccessEndsAt: periodEnd,
      courseAccess:     true,
      source:           "stripe_subscription",
      planSlug,
      creditsToGrant:   0,
      skipEntitlement:  true, // entitlement set inside locked tx below
    });

    // Capture the user's PRE-EXISTING subscription (if any) BEFORE the upsert
    // below replaces its row. If the user was an active Basic/Pro subscriber,
    // the old Stripe subscription must be cancelled AFTER provisioning succeeds
    // so a failed Founder provision leaves the old plan intact.
    const [oldSub] = await db
      .select({
        stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
        stripeScheduleId:     subscriptionsTable.stripeScheduleId,
        status:               subscriptionsTable.status,
        planSlug:             subscriptionsTable.planSlug,
      })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, result.userId))
      .limit(1);

    // A user who already holds an ACTIVE Founder subscription must never be
    // provisioned a second Founder purchase (double charge). Leave the purchase
    // unprovisioned — recurring ERROR logs flag it for manual refund/resolution,
    // mirroring the seat-cap-exceeded handling.
    const oldSubIsActive = !!oldSub && ["active", "trialing", "past_due"].includes(oldSub.status);
    if (
      oldSubIsActive &&
      oldSub!.planSlug === "founder" &&
      oldSub!.stripeSubscriptionId &&
      oldSub!.stripeSubscriptionId !== stripeSubId
    ) {
      logger.error(
        { purchaseId: purchase.id, email, existingSubId: oldSub!.stripeSubscriptionId, newSubId: stripeSubId },
        "[provision-purchase] Duplicate Founder purchase for an already-Founder user — NOT provisioning; requires manual refund/resolution",
      );
      throw new Error(
        `Duplicate Founder purchase: user already has active Founder subscription. Purchase ${purchase.id} requires admin resolution.`,
      );
    }

    // Founder swap detection: an active Basic/Pro subscription is being replaced.
    const isSwap = !!(
      oldSubIsActive &&
      oldSub!.stripeSubscriptionId &&
      oldSub!.stripeSubscriptionId !== stripeSubId
    );

    // Step 2: one atomic tx — advisory lock + seat count + claim + subscription +
    //          entitlement + invoice pre-claim + credits
    await db.transaction(async (tx) => {
      // Acquire transaction-scoped advisory lock — serializes all concurrent
      // Founder provisioning calls; auto-released on commit or rollback
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${FOUNDER_SEAT_LOCK_KEY})`);

      // Count occupied Founder seats — this user's subscription row does NOT yet
      // exist (it is inserted later in this same tx), so the count is accurate.
      // Include trialing seats: they have full tool access and consume a seat.
      const [{ activeSeats }] = await tx
        .select({ activeSeats: count() })
        .from(subscriptionsTable)
        .where(and(
          eq(subscriptionsTable.planSlug, "founder"),
          or(eq(subscriptionsTable.status, "active"), eq(subscriptionsTable.status, "trialing")),
        ));

      const seats = Number(activeSeats ?? 0);
      if (seats >= FOUNDER_MAX_SEATS) {
        // No subscription row, no entitlement, no credits → clean failure
        logger.error(
          { purchaseId: purchase.id, email, activeSeats: seats, maxSeats: FOUNDER_MAX_SEATS },
          "[provision-purchase] Founder seat cap exceeded — purchase paid but seat unavailable; manual admin resolution required",
        );
        throw new Error(
          `Founder seat cap exceeded (${seats}/${FOUNDER_MAX_SEATS}). Purchase ${purchase.id} requires admin resolution.`,
        );
      }

      // Claim purchase (concurrent retry safe — only one caller sets provisionedAt)
      const claimed = await tx
        .update(purchases)
        .set({ userId: result.userId, provisionedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(purchases.id, purchase.id), isNull(purchases.provisionedAt)))
        .returning({ id: purchases.id });

      if (claimed.length === 0) {
        logger.info({ purchaseId: purchase.id }, "[provision-purchase] Founder: already claimed — concurrent retry, skipping");
        return;
      }

      // Upsert subscription row (status = active; inside tx so count sees it only after commit)
      await tx
        .insert(subscriptionsTable)
        .values({
          userId:               result.userId,
          stripeSubscriptionId: stripeSubId ?? undefined,
          stripeCustomerId:     providerCustomerId ?? undefined,
          planSlug:             "founder",
          status:               "active",
          currentPeriodStart:   new Date(),
          currentPeriodEnd:     periodEnd,
          founderMonthsGranted: planCredits > 0 ? 1 : 0,
          founderAnchorAt:      planCredits > 0 ? new Date() : undefined,
          founderLastGrantAt:   planCredits > 0 ? new Date() : undefined,
        })
        .onConflictDoUpdate({
          target: subscriptionsTable.userId,
          set: {
            stripeSubscriptionId: stripeSubId ?? undefined,
            stripeCustomerId:     providerCustomerId ?? undefined,
            status:               "active",
            currentPeriodEnd:     periodEnd,
            founderMonthsGranted: planCredits > 0 ? 1 : 0,
            founderAnchorAt:      planCredits > 0 ? new Date() : undefined,
            founderLastGrantAt:   planCredits > 0 ? new Date() : undefined,
            // Clear any leftover state from a previous Basic/Pro subscription
            planSlug:             "founder",
            cancelAtPeriodEnd:    false,
            pendingPlanSlug:      null,
            stripeScheduleId:     null,
            // Durable swap marker: the old Stripe subscription must be cancelled.
            // supersededCancelledAt stays NULL until Stripe confirms; the scheduler
            // sweep retries the cancellation every cycle until then.
            ...(isSwap
              ? { supersededStripeSubscriptionId: oldSub!.stripeSubscriptionId, supersededCancelledAt: null }
              : {}),
            updatedAt:            new Date(),
          },
        });

      // Grant tool access (entitlement) — inside tx so no access unless seat claim succeeds
      await tx
        .insert(userEntitlements)
        .values({
          userId:             result.userId,
          courseAccess:       true,
          toolAccessStatus:   "active",
          toolAccessStartsAt: new Date(),
          toolAccessEndsAt:   periodEnd,
          source:             "stripe_subscription",
          planSlug:           "founder",
          updatedAt:          new Date(),
        })
        .onConflictDoUpdate({
          target: userEntitlements.userId,
          set: {
            courseAccess:     true,
            toolAccessStatus: "active",
            toolAccessEndsAt: periodEnd,
            source:           "stripe_subscription",
            planSlug:         "founder",
            updatedAt:        new Date(),
          },
        });

      if (planCredits > 0) {
        // Pre-claim initial Stripe invoice (billing_reason gate is primary; this is defense-in-depth)
        if (initialInvoiceId) {
          await tx
            .insert(invoiceCreditGrantsTable)
            .values({ stripeInvoiceId: initialInvoiceId, userId: result.userId, planSlug: "founder", creditsGranted: planCredits })
            .onConflictDoNothing();
        }

        // Lock wallet row before computing new balances
        const [existing] = await tx
          .select().from(userCreditsTable).where(eq(userCreditsTable.userId, result.userId))
          .for("update").limit(1);

        const prevSubCredits   = existing?.subscriptionCredits ?? 0;
        const purchasedCredits = existing?.purchasedCredits    ?? 0;
        // Query unsettled reserved-from-sub so renewal does not overshoot planCredits on release.
        // Invariant: availableCredits = subscriptionCredits + purchasedCredits (always)
        // Renewal: newSub = planCredits - reservedFromSub → after release: sub = planCredits ✓
        const reservedResult   = await tx.execute(sql`
          SELECT COALESCE(SUM(COALESCE(subscription_amount, 0)), 0) AS rsub
          FROM credit_ledger r
          WHERE r.user_id = ${result.userId}
            AND r.type = 'reserve'
            AND NOT EXISTS (
              SELECT 1 FROM credit_ledger s
              WHERE s.related_ledger_id = r.id AND s.type IN ('consume', 'release')
            )
        `);
        const reservedFromSub  = Number((reservedResult.rows[0] as Record<string, unknown>)?.rsub ?? 0);
        const newSubCredits    = planCredits - reservedFromSub;
        const newAvailable     = newSubCredits + purchasedCredits;
        const balanceBefore    = existing?.availableCredits    ?? 0;

        if (existing) {
          await tx.update(userCreditsTable)
            .set({ subscriptionCredits: newSubCredits, availableCredits: newAvailable, updatedAt: new Date() })
            .where(eq(userCreditsTable.userId, result.userId));
        } else {
          await tx.insert(userCreditsTable).values({
            userId: result.userId, availableCredits: planCredits, subscriptionCredits: planCredits,
            purchasedCredits: 0, reservedCredits: 0, totalConsumed: 0,
          });
        }

        await tx.insert(creditLedgerTable).values({
          userId: result.userId, type: "provision", amount: planCredits - prevSubCredits,
          balanceBefore, balanceAfter: newAvailable, pool: "subscription",
          subscriptionAmount: newSubCredits,
          description: `Suscripción founder: ${planCredits} créditos del ciclo inicial`,
        });
      }
    });

    // Invalidate both caches after tx commits — entitlement and plan are now live
    invalidateAccessCache(result.userId);
    invalidatePlanCache(result.userId);

    // ── Founder swap: cancel the OLD Stripe subscription (if any) ─────────────
    // Runs only AFTER the Founder provision tx committed, so a failed provision
    // never cancels the user's existing plan. The swap marker persisted in the
    // tx above makes this durable: if this immediate attempt fails (crash,
    // Stripe error), the scheduler sweep retries every cycle until Stripe
    // confirms the cancellation (supersededCancelledAt stays NULL until then).
    if (isSwap) {
      await cancelSupersededStripeSubscription({
        userId: result.userId,
        oldSubscriptionId: oldSub!.stripeSubscriptionId!,
        stripe,
      });
    }

  } else {
    // ── NON-FOUNDER PATH (Basic / Pro) ───────────────────────────────────────
    //
    // No seat cap → entitlement granted as part of provisionUser (outside tx).
    // Atomic tail: claim purchase + invoice pre-claim + credits in one tx.

    // 1. Provision/find user account (entitlement set here)
    const result = await provisionUser({
      email,
      name:             fullName ?? email,
      toolAccessEndsAt: periodEnd,
      courseAccess:     true,
      source:           "stripe_subscription",
      planSlug,
      creditsToGrant:   0,
    });

    // 2. Upsert subscription row
    await db
      .insert(subscriptionsTable)
      .values({
        userId:               result.userId,
        stripeSubscriptionId: stripeSubId ?? undefined,
        stripeCustomerId:     providerCustomerId ?? undefined,
        planSlug,
        status:               "active",
        currentPeriodStart:   new Date(),
        currentPeriodEnd:     periodEnd,
      })
      .onConflictDoUpdate({
        target: subscriptionsTable.userId,
        set: {
          stripeSubscriptionId: stripeSubId ?? undefined,
          stripeCustomerId:     providerCustomerId ?? undefined,
          planSlug,
          status:               "active",
          currentPeriodEnd:     periodEnd,
          updatedAt:            new Date(),
        },
      });

    // 3. Atomic tail: claim + invoice pre-claim + credits
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(purchases)
        .set({ userId: result.userId, provisionedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(purchases.id, purchase.id), isNull(purchases.provisionedAt)))
        .returning({ id: purchases.id });

      if (claimed.length === 0) {
        logger.info({ purchaseId: purchase.id }, "[provision-purchase] Subscription: already claimed — concurrent retry, skipping");
        return;
      }

      if (planCredits <= 0) return;

      if (initialInvoiceId) {
        await tx.insert(invoiceCreditGrantsTable)
          .values({ stripeInvoiceId: initialInvoiceId, userId: result.userId, planSlug, creditsGranted: planCredits })
          .onConflictDoNothing();
        logger.info({ initialInvoiceId, userId: result.userId, planCredits }, "[provision-purchase] Initial invoice pre-claimed");
      } else {
        logger.warn({ planSlug, userId: result.userId }, "[provision-purchase] No initial invoice ID — invoice.paid may double-grant");
      }

      const [existing] = await tx
        .select().from(userCreditsTable).where(eq(userCreditsTable.userId, result.userId))
        .for("update").limit(1);

      const prevSubCredits   = existing?.subscriptionCredits ?? 0;
      const purchasedCredits = existing?.purchasedCredits    ?? 0;
      // Query unsettled reserved-from-sub (renewal safety — see pool model in credits.ts)
      const reservedResult2  = await tx.execute(sql`
        SELECT COALESCE(SUM(COALESCE(subscription_amount, 0)), 0) AS rsub
        FROM credit_ledger r
        WHERE r.user_id = ${result.userId}
          AND r.type = 'reserve'
          AND NOT EXISTS (
            SELECT 1 FROM credit_ledger s
            WHERE s.related_ledger_id = r.id AND s.type IN ('consume', 'release')
          )
      `);
      const reservedFromSub2 = Number((reservedResult2.rows[0] as Record<string, unknown>)?.rsub ?? 0);
      const newSubCredits2   = planCredits - reservedFromSub2;
      const newAvailable     = newSubCredits2 + purchasedCredits;
      const balanceBefore    = existing?.availableCredits    ?? 0;

      if (existing) {
        await tx.update(userCreditsTable)
          .set({ subscriptionCredits: newSubCredits2, availableCredits: newAvailable, updatedAt: new Date() })
          .where(eq(userCreditsTable.userId, result.userId));
      } else {
        await tx.insert(userCreditsTable).values({
          userId: result.userId, availableCredits: planCredits, subscriptionCredits: planCredits,
          purchasedCredits: 0, reservedCredits: 0, totalConsumed: 0,
        });
      }

      await tx.insert(creditLedgerTable).values({
        userId: result.userId, type: "provision", amount: planCredits - prevSubCredits,
        balanceBefore, balanceAfter: newAvailable, pool: "subscription",
        subscriptionAmount: newSubCredits2,
        description: `Suscripción ${planSlug}: ${planCredits} créditos del ciclo inicial`,
      });
    });
  }
}

// ── Founder swap: durable old-subscription cancellation ───────────────────────

/**
 * Cancel a superseded (replaced-by-Founder) Stripe subscription and stamp
 * supersededCancelledAt on success. Idempotent:
 *   - already-canceled or missing subscriptions count as success
 *   - any attached schedule is released first (Stripe requires it)
 * Returns true when Stripe has confirmed the subscription no longer bills.
 */
export async function cancelSupersededStripeSubscription(opts: {
  userId: number;
  oldSubscriptionId: string;
  stripe: Stripe;
}): Promise<boolean> {
  const { userId, oldSubscriptionId, stripe } = opts;

  const stampCancelled = async () => {
    await db
      .update(subscriptionsTable)
      .set({ supersededCancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptionsTable.supersededStripeSubscriptionId, oldSubscriptionId));
  };

  try {
    const remote = await stripe.subscriptions.retrieve(oldSubscriptionId);

    // Release any attached schedule (pending downgrade) so Stripe allows cancel
    const scheduleId = typeof remote.schedule === "string" ? remote.schedule : remote.schedule?.id;
    if (scheduleId) {
      try {
        await stripe.subscriptionSchedules.release(scheduleId);
        logger.info({ userId, scheduleId }, "[provision-purchase] Founder swap: released attached schedule");
      } catch (err: any) {
        logger.warn(
          { userId, scheduleId, err: err?.message },
          "[provision-purchase] Founder swap: schedule release failed (may already be released)",
        );
      }
    }

    if (remote.status !== "canceled") {
      await stripe.subscriptions.cancel(oldSubscriptionId);
    }
    await stampCancelled();
    logger.info(
      { userId, oldSubscriptionId },
      "[provision-purchase] Founder swap: old subscription cancelled ✓",
    );
    return true;
  } catch (err: any) {
    if (err?.code === "resource_missing") {
      // Subscription no longer exists in Stripe — nothing left to cancel
      await stampCancelled();
      logger.info(
        { userId, oldSubscriptionId },
        "[provision-purchase] Founder swap: old subscription already gone in Stripe — marked cancelled",
      );
      return true;
    }
    logger.error(
      { userId, oldSubscriptionId, err: err?.message },
      "[provision-purchase] Founder swap: cancellation failed — sweep will retry next cycle",
    );
    return false;
  }
}

/**
 * Scheduler sweep: retry pending superseded-subscription cancellations.
 * Rows with supersededStripeSubscriptionId set and supersededCancelledAt NULL
 * represent an old Basic/Pro subscription that is STILL BILLING the user after
 * a Founder swap — retried until Stripe confirms.
 */
export async function sweepSupersededSubscriptions(stripe: Stripe): Promise<void> {
  const pending = await db
    .select({
      userId: subscriptionsTable.userId,
      oldSubscriptionId: subscriptionsTable.supersededStripeSubscriptionId,
    })
    .from(subscriptionsTable)
    .where(and(
      sql`${subscriptionsTable.supersededStripeSubscriptionId} IS NOT NULL`,
      isNull(subscriptionsTable.supersededCancelledAt),
    ))
    .limit(5);

  for (const row of pending) {
    if (!row.oldSubscriptionId) continue;
    logger.warn(
      { userId: row.userId, oldSubscriptionId: row.oldSubscriptionId },
      "[FounderSwapRecovery] Reintentando cancelación de suscripción reemplazada",
    );
    await cancelSupersededStripeSubscription({
      userId: row.userId,
      oldSubscriptionId: row.oldSubscriptionId,
      stripe,
    });
  }
}

// ── Legacy program purchase ────────────────────────────────────────────────────

async function provisionLegacyProgram({
  purchase,
  email,
  fullName,
}: {
  purchase: typeof purchases.$inferSelect;
  email: string;
  fullName: string | null | undefined;
}): Promise<void> {
  const toolAccessDays = purchase.toolAccessDays ?? 30;
  const result = await provisionUser({
    email,
    name:           fullName ?? email,
    toolAccessDays,
    courseAccess:   true,
    source:         "stripe",
    creditsToGrant: 0,
  });
  await db
    .update(purchases)
    .set({ userId: result.userId })
    .where(eq(purchases.id, purchase.id));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultPeriodEnd(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}
