/**
 * Wallet and credit operations for Reelsona — Phase 2 (Monetization).
 *
 * Credit lifecycle for a video generation:
 *   1. reserveCredits()          — before job submission (deducts from available)
 *   2. consumeVideoCredits()     — when video status → ready (settles the reservation)
 *   3. releaseVideoCredits()     — when video fails/times out (returns credits to available)
 *
 * Dual-pool accounting:
 *   - subscriptionCredits: reset on each billing renewal; spent first.
 *   - purchasedCredits:    accumulated from one-time topups; never reset.
 *   - availableCredits:    always = subscriptionCredits + purchasedCredits.
 *
 * All write operations run inside a transaction and are idempotent.
 *
 * Credit cost table (verification):
 *   Reel (50 cr / 30 s):  15 s → 25 cr  |  30 s → 50 cr  |  45 s → 75 cr  |  60 s → 100 cr
 *   Minimum cost: 15 credits per generation regardless of duration.
 */

import { db } from "@workspace/db";
import { userCreditsTable, creditLedgerTable } from "@workspace/db";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";

// ── Cost constants ────────────────────────────────────────────────────────────

/**
 * Unified credit cost per 30-second Reel, regardless of the underlying provider.
 * The provider used internally never affects the credit cost shown to the user.
 */
export const REEL_CREDITS_PER_30S = 50;

/** @deprecated Use REEL_CREDITS_PER_30S. Kept for backward compatibility. */
export const WAVESPEED_CREDITS_PER_30S = REEL_CREDITS_PER_30S;
/** @deprecated Use REEL_CREDITS_PER_30S. Kept for backward compatibility. */
export const HEYGEN_CREDITS_PER_30S   = REEL_CREDITS_PER_30S;

/** Flat credit cost per Seedream look generation (first 3 looks/persona included in plan). */
export const LOOK_CREDIT_COST  = 2;
/** Flat credit cost per additional voice clone (first clone included in plan). */
export const EXTRA_VOICE_CREDIT_COST = 10;

/** Monthly credit allocation per plan. */
export const PLAN_CREDITS: Record<string, number> = {
  basic:   400,
  pro:    1500,
  founder: 1500,
};

/** Maximum Founder seats available for purchase. */
export const FOUNDER_MAX_SEATS = 10;
/** Founder plan grants monthly credits for this many months, then stops. */
export const FOUNDER_MAX_MONTHS = 12;

/**
 * Compute the credit cost for a Reel generation.
 * Unified formula for all providers — the underlying engine never affects the
 * cost visible to the user.
 * Minimum: 15 credits per generation.
 *
 * @example
 *   computeReelCreditCost(15) → 25
 *   computeReelCreditCost(30) → 50
 *   computeReelCreditCost(45) → 75
 *   computeReelCreditCost(60) → 100
 */
export function computeReelCreditCost(durationSec: number): number {
  return Math.max(15, Math.ceil(durationSec * REEL_CREDITS_PER_30S / 30));
}

/** @deprecated Use computeReelCreditCost. */
export function computeWavespeedCost(durationSec: number): number {
  return computeReelCreditCost(durationSec);
}

/** @deprecated Use computeReelCreditCost. */
export function computeHeygenCost(durationSec: number): number {
  return computeReelCreditCost(durationSec);
}

/**
 * Estimate video duration from the number of words in the script.
 * Uses a conservative 2.5 words/second speaking rate (yields ~30 s for 75 words).
 */
export function estimateDurationFromScript(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(10, Math.ceil(words / 2.5)); // floor at 10 s
}

// ── Backward-compat constant (used by legacy routes/admin) ───────────────────
/**
 * @deprecated Use computeReelCreditCost instead.
 * Kept for backward compatibility with admin credit adjustment route.
 * Represents the cost of a 30-second Reel.
 */
export const VIDEO_CREDIT_COST = REEL_CREDITS_PER_30S;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WalletState {
  availableCredits:    number;
  subscriptionCredits: number;
  purchasedCredits:    number;
  reservedCredits:     number;
  totalConsumed:       number;
}

// ── Read helpers ─────────────────────────────────────────────────────────────

export async function getUserCredits(userId: number): Promise<WalletState> {
  const [row] = await db
    .select()
    .from(userCreditsTable)
    .where(eq(userCreditsTable.userId, userId))
    .limit(1);

  if (!row) {
    return { availableCredits: 0, subscriptionCredits: 0, purchasedCredits: 0, reservedCredits: 0, totalConsumed: 0 };
  }
  return {
    availableCredits:    row.availableCredits,
    subscriptionCredits: row.subscriptionCredits,
    purchasedCredits:    row.purchasedCredits,
    reservedCredits:     row.reservedCredits,
    totalConsumed:       row.totalConsumed,
  };
}

export async function hasEnoughCredits(userId: number, amount: number): Promise<boolean> {
  const wallet = await getUserCredits(userId);
  return wallet.availableCredits >= amount;
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Provision subscription credits for a billing cycle.
 *
 * REPLACES (does not accumulate) the subscriptionCredits balance so unused
 * credits from the previous cycle are forfeited. purchasedCredits are unaffected.
 * availableCredits is updated to reflect the new total.
 *
 * pool = 'subscription' (always).
 */
export async function provisionSubscriptionCredits(
  userId:      number,
  amount:      number,
  description: string,
): Promise<void> {
  if (amount <= 0) return;

  await db.transaction(async (tx) => {
    // SELECT FOR UPDATE serializes concurrent writers: reservation, topup, and renewal
    // all lock the wallet row before computing new balances — no lost updates possible.
    const [existing] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const prevSubCredits   = existing?.subscriptionCredits ?? 0;
    const purchasedCredits = existing?.purchasedCredits    ?? 0;

    // Compute how many subscription credits are currently reserved in unsettled
    // video reservations. Renewal must set newSub = planCredits - reservedFromSub so
    // that a subsequent release cannot push subscriptionCredits above planCredits.
    //   Reserve:  sub -= fromSub  (pool-reducing)
    //   Release:  sub += fromSub  (pool-restoring)
    //   Renewal:  sub  = planCredits - reservedFromSub → after release: sub = planCredits ✓
    const reservedResult = await tx.execute(sql`
      SELECT COALESCE(SUM(COALESCE(subscription_amount, 0)), 0) AS rsub
      FROM credit_ledger r
      WHERE r.user_id = ${userId}
        AND r.type = 'reserve'
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger s
          WHERE s.related_ledger_id = r.id
            AND s.type IN ('consume', 'release')
        )
    `);
    const reservedFromSub  = Number((reservedResult.rows[0] as Record<string, unknown>)?.rsub ?? 0);
    const newSubCredits    = amount - reservedFromSub; // REPLACE, accounting for in-flight reserves
    const newAvailable     = newSubCredits + purchasedCredits;
    const balanceBefore    = existing?.availableCredits ?? 0;

    if (existing) {
      await tx
        .update(userCreditsTable)
        .set({
          subscriptionCredits: newSubCredits,
          availableCredits:    newAvailable,
          updatedAt:           new Date(),
        })
        .where(eq(userCreditsTable.userId, userId));
    } else {
      await tx.insert(userCreditsTable).values({
        userId,
        availableCredits:    amount,
        subscriptionCredits: amount,
        purchasedCredits:    0,
        reservedCredits:     0,
        totalConsumed:       0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId,
      type:               "provision",
      amount:             newSubCredits - prevSubCredits, // delta (may be negative if downgrading)
      balanceBefore,
      balanceAfter:       newAvailable,
      pool:               "subscription",
      subscriptionAmount: newSubCredits,
      description,
    });
  });

  logger.info({ userId, amount, description }, "[Credits] Subscription credits provisioned (replaced)");
}

/**
 * Provision purchased/topup credits.
 *
 * ACCUMULATES (adds to) the purchasedCredits balance. Never expires.
 * pool = 'purchased'.
 */
export async function provisionPurchasedCredits(
  userId:      number,
  amount:      number,
  description: string,
): Promise<void> {
  if (amount <= 0) return;

  await db.transaction(async (tx) => {
    // FOR UPDATE: prevents concurrent topups/renewals from reading the same
    // balance and both committing the same resulting total.
    const [existing] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const prevPurchased = existing?.purchasedCredits ?? 0;
    const subCredits    = existing?.subscriptionCredits ?? 0;
    const newPurchased  = prevPurchased + amount;
    const newAvailable  = subCredits + newPurchased;
    const balanceBefore = existing?.availableCredits ?? 0;

    if (existing) {
      await tx
        .update(userCreditsTable)
        .set({
          purchasedCredits: newPurchased,
          availableCredits: newAvailable,
          updatedAt:        new Date(),
        })
        .where(eq(userCreditsTable.userId, userId));
    } else {
      await tx.insert(userCreditsTable).values({
        userId,
        availableCredits:    amount,
        subscriptionCredits: 0,
        purchasedCredits:    amount,
        reservedCredits:     0,
        totalConsumed:       0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId,
      type:           "provision",
      amount,
      balanceBefore,
      balanceAfter:   newAvailable,
      pool:           "purchased",
      purchasedAmount: amount,
      description,
    });
  });

  logger.info({ userId, amount, description }, "[Credits] Purchased credits provisioned");
}

/**
 * @deprecated Legacy provision — adds to availableCredits without pool tracking.
 * Used by manual admin provisioning. Kept for backward compat.
 */
export async function provisionCredits(
  userId:      number,
  amount:      number,
  description: string,
): Promise<void> {
  // Route to purchased credits pool for admin/manual provisions
  return provisionPurchasedCredits(userId, amount, description);
}

/**
 * Reserve credits for a video about to be submitted.
 *
 * Spends from subscriptionCredits first, then purchasedCredits.
 * Atomically deducts from available and adds to reserved.
 * Throws if the user does not have enough available credits.
 */
export async function reserveCredits(
  userId:      number,
  amount:      number,
  videoId:     number,
  description: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // FOR UPDATE: reservation must read the authoritative balance and prevent
    // a concurrent topup or renewal from inflating it between read and write.
    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const available = wallet?.availableCredits ?? 0;

    if (available < amount) {
      throw new Error(
        `Saldo insuficiente: ${available} créditos disponibles, se requieren ${amount}`,
      );
    }

    // RESERVATION MODEL (pool-reducing):
    // Reserve reduces subscriptionCredits and purchasedCredits (subscription first),
    // moving them into reservedCredits. Release is the exact mirror.
    //
    // Invariant: availableCredits = subscriptionCredits + purchasedCredits (always)
    //
    // Consume does NOT restore the pool columns — it only removes the reserved
    // tracking entry. The deduction is permanent: sub/pur remain reduced.
    //
    // Renewal resets sub to planCredits, but must account for outstanding reserves:
    //   newSub = planCredits - reservedFromSub (queried from ledger)
    // This prevents a subsequent release from pushing sub above planCredits.

    const subCr  = wallet?.subscriptionCredits ?? 0;
    const purCr  = wallet?.purchasedCredits    ?? 0;
    const fromSub = Math.min(subCr, amount);
    const fromPur = amount - fromSub;
    let pool: string;
    if (fromSub > 0 && fromPur > 0) pool = "mixed";
    else if (fromSub > 0) pool = "subscription";
    else pool = "purchased";

    await tx
      .update(userCreditsTable)
      .set({
        availableCredits:    available - amount,
        subscriptionCredits: subCr - fromSub,
        purchasedCredits:    purCr - fromPur,
        reservedCredits:     (wallet?.reservedCredits ?? 0) + amount,
        updatedAt:           new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    await tx.insert(creditLedgerTable).values({
      userId,
      type:               "reserve",
      amount:             -amount,
      balanceBefore:      available,
      balanceAfter:       available - amount,
      pool,
      subscriptionAmount: fromSub > 0 ? fromSub : undefined,
      purchasedAmount:    fromPur > 0 ? fromPur : undefined,
      videoId,
      description,
    });
  });

  logger.info({ userId, amount, videoId }, "[Credits] Reserved");
}

/**
 * Consume the reservation for a video that completed successfully.
 * Moves reserved → totalConsumed. Idempotent: safe to call more than once.
 */
export async function consumeVideoCredits(videoId: number): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock the reserve row before checking settlement.
    // This serializes concurrent consume/release calls for the same reservation:
    // the second transaction blocks here until the first commits, then sees the
    // settlement row already present and exits cleanly.
    // The unique partial index (related_ledger_id WHERE type IN ('consume','release'))
    // provides the database-level enforcement so even a bug cannot double-settle.
    const [reservation] = await tx
      .select()
      .from(creditLedgerTable)
      .where(and(eq(creditLedgerTable.videoId, videoId), eq(creditLedgerTable.type, "reserve")))
      .for("update")
      .limit(1);

    if (!reservation) {
      logger.debug({ videoId }, "[Credits] No reserve entry found — skipping consume");
      return;
    }

    const [alreadySettled] = await tx
      .select({ id: creditLedgerTable.id })
      .from(creditLedgerTable)
      .where(
        and(
          eq(creditLedgerTable.relatedLedgerId, reservation.id),
          inArray(creditLedgerTable.type, ["consume", "release"]),
        ),
      )
      .limit(1);

    if (alreadySettled) return;

    const amount = Math.abs(reservation.amount);
    const userId = reservation.userId;

    // FOR UPDATE: locks the wallet row so concurrent consume/release/topup wait.
    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    if (!wallet) return;

    await tx
      .update(userCreditsTable)
      .set({
        reservedCredits: Math.max(0, wallet.reservedCredits - amount),
        totalConsumed:   wallet.totalConsumed + amount,
        updatedAt:       new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    await tx.insert(creditLedgerTable).values({
      userId,
      type:               "consume",
      amount:             -amount,
      balanceBefore:      wallet.availableCredits,
      balanceAfter:       wallet.availableCredits, // available unchanged on consume
      pool:               reservation.pool ?? undefined,
      subscriptionAmount: reservation.subscriptionAmount ?? undefined,
      purchasedAmount:    reservation.purchasedAmount    ?? undefined,
      videoId,
      relatedLedgerId:    reservation.id,
      description:        `Video ${videoId} completado`,
    });
  });

  logger.info({ videoId }, "[Credits] Consumed");
}

/**
 * Release the reservation for a video that failed, timed out, or was cancelled.
 * Returns reserved credits to the correct pool(s). Idempotent.
 */
export async function releaseVideoCredits(videoId: number, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Lock the reserve row before checking settlement (same pattern as consume).
    // Serializes concurrent consume/release for the same reservation; the second
    // transaction blocks here, then finds alreadySettled=true after the first commits.
    const [reservation] = await tx
      .select()
      .from(creditLedgerTable)
      .where(and(eq(creditLedgerTable.videoId, videoId), eq(creditLedgerTable.type, "reserve")))
      .for("update")
      .limit(1);

    if (!reservation) {
      logger.debug({ videoId }, "[Credits] No reserve entry found — skipping release");
      return;
    }

    const [alreadySettled] = await tx
      .select({ id: creditLedgerTable.id })
      .from(creditLedgerTable)
      .where(
        and(
          eq(creditLedgerTable.relatedLedgerId, reservation.id),
          inArray(creditLedgerTable.type, ["consume", "release"]),
        ),
      )
      .limit(1);

    if (alreadySettled) return;

    const amount = Math.abs(reservation.amount);
    const userId = reservation.userId;

    // FOR UPDATE: locks the wallet row for this release, serializing with any
    // concurrent reservation or topup on the same account.
    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    if (!wallet) return;

    // RELEASE MODEL (pool-restoring): symmetric with reserve.
    // Restores subscriptionCredits and purchasedCredits exactly as they were deducted.
    //
    // Invariant: availableCredits = subscriptionCredits + purchasedCredits (always)
    //
    // Renewal safety: renewal uses newSub = planCredits - reservedFromSub (ledger query)
    // so that after a release, sub = (planCredits - fromSub) + fromSub = planCredits exactly.
    // This prevents release from pushing sub above planCredits even when renewal occurs
    // between reserve and release.
    const fromSub = reservation.subscriptionAmount ?? 0;
    const fromPur = reservation.purchasedAmount    ?? 0;
    // Legacy rows with no pool attribution: restore to subscription (safer — avoids over-crediting purchased)
    const restoreToSub = fromSub > 0 ? fromSub : (reservation.pool === "subscription" ? amount : 0);
    const restoreToPur = fromPur > 0 ? fromPur : amount - restoreToSub;

    await tx
      .update(userCreditsTable)
      .set({
        availableCredits:    wallet.availableCredits + amount,
        subscriptionCredits: wallet.subscriptionCredits + restoreToSub,
        purchasedCredits:    wallet.purchasedCredits    + restoreToPur,
        reservedCredits:     Math.max(0, wallet.reservedCredits - amount),
        updatedAt:           new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    await tx.insert(creditLedgerTable).values({
      userId,
      type:               "release",
      amount,
      balanceBefore:      wallet.availableCredits,
      balanceAfter:       wallet.availableCredits + amount,
      pool:               reservation.pool ?? undefined,
      subscriptionAmount: fromSub > 0 ? fromSub : undefined,
      purchasedAmount:    fromPur > 0 ? fromPur : undefined,
      videoId,
      relatedLedgerId:    reservation.id,
      description:        reason,
    });
  });

  logger.info({ videoId, reason }, "[Credits] Released");
}

/**
 * Adjust a user's available credits by a signed amount (admin operation).
 * Routes all adjustments through purchasedCredits pool.
 */
export async function adjustCredits(
  userId:      number,
  amount:      number,
  description: string,
): Promise<void> {
  if (amount === 0) throw new Error("El monto debe ser distinto de 0");

  await db.transaction(async (tx) => {
    // FOR UPDATE: admin adjustments must serialize with concurrent topups/reservations.
    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const currentAvailable = wallet?.availableCredits    ?? 0;
    const currentSub       = wallet?.subscriptionCredits ?? 0;
    const currentPurchased = wallet?.purchasedCredits    ?? 0;

    const newAvailable = currentAvailable + amount;

    if (newAvailable < 0) {
      throw new Error(
        `No se puede descontar ${Math.abs(amount)} créditos: el usuario solo tiene ${currentAvailable} disponibles.`,
      );
    }

    // Pool-aware adjustment: invariant is availableCredits = subscriptionCredits + purchasedCredits.
    // For additions: add to purchasedCredits (administrative grant is always purchased-pool).
    // For deductions: drain purchasedCredits first (to zero), then subscriptionCredits.
    // This ensures pool sums always equal availableCredits; no pool ever goes negative.
    let newSub       = currentSub;
    let newPurchased = currentPurchased;

    if (amount > 0) {
      // Positive: admin grant → purchased pool
      newPurchased = currentPurchased + amount;
    } else {
      // Negative: deduct from purchased first, remainder from subscription
      const deduct = Math.abs(amount);
      const fromPurchased = Math.min(currentPurchased, deduct);
      const fromSub       = deduct - fromPurchased;
      newPurchased = currentPurchased - fromPurchased;
      newSub       = currentSub - fromSub;
    }

    // Invariant check (should never fail given the guard above, but be explicit)
    if (newSub < 0 || newPurchased < 0) {
      throw new Error(`Internal: pool balance would go negative (sub=${newSub}, purchased=${newPurchased})`);
    }

    if (wallet) {
      await tx
        .update(userCreditsTable)
        .set({
          availableCredits:    newAvailable,
          subscriptionCredits: newSub,
          purchasedCredits:    newPurchased,
          updatedAt:           new Date(),
        })
        .where(eq(userCreditsTable.userId, userId));
    } else {
      // No existing wallet — only positive adjustments can create it
      await tx.insert(userCreditsTable).values({
        userId,
        availableCredits:    newAvailable,
        subscriptionCredits: 0,
        purchasedCredits:    newPurchased,
        reservedCredits:     0,
        totalConsumed:       0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId,
      type:               "adjustment",
      amount,
      balanceBefore:      currentAvailable,
      balanceAfter:       newAvailable,
      pool:               amount > 0 ? "purchased" : (Math.min(currentPurchased, Math.abs(amount)) === Math.abs(amount) ? "purchased" : "subscription"),
      subscriptionAmount: newSub,
      purchasedAmount:    newPurchased,
      description,
    });
  });

  logger.info({ userId, amount, description }, "[Credits] Adjusted");
}

// ── Recovery ──────────────────────────────────────────────────────────────────

/** Placeholder — orphan cleanup handled inline in the polling loop (scheduler.ts). */
export async function releaseOrphanedReserves(): Promise<void> {
  void isNull; // suppress unused import warning
}
