/**
 * GET /api/billing
 *
 * Returns the authenticated user's current plan, subscription status, credit
 * balances, and available topup options.  Read-only endpoint — safe to call
 * frequently from the frontend.
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
import { PLAN_CREDITS, FOUNDER_MAX_SEATS, FOUNDER_MAX_MONTHS } from "../lib/credits";
import { getActiveFounderCount } from "../lib/stripe";

const router = Router();

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

export default router;
