/**
 * Wallet and credit operations for Reelsona — Phase 1.
 *
 * Credit lifecycle for a video generation:
 *   1. reserveCredits()       — before HeyGen submission (deducts from available)
 *   2. consumeVideoCredits()  — when video status → ready (settles the reservation)
 *   3. releaseVideoCredits()  — when video fails/times out (returns credits to available)
 *
 * All write operations run inside a transaction and are idempotent.
 */

import { db } from "@workspace/db";
import { userCreditsTable, creditLedgerTable } from "@workspace/db";
import { eq, and, inArray, lt, isNull } from "drizzle-orm";
import { logger } from "./logger";

// ── Constants ────────────────────────────────────────────────────────────────

/** Credits deducted per video generation. Adjust here to change pricing across the board. */
export const VIDEO_CREDIT_COST = 10;

/** Credits granted per day of tool access when provisioning a user. */
export const CREDITS_PER_DAY = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WalletState {
  availableCredits: number;
  reservedCredits:  number;
  totalConsumed:    number;
}

// ── Read helpers ─────────────────────────────────────────────────────────────

export async function getUserCredits(userId: number): Promise<WalletState> {
  const [row] = await db
    .select()
    .from(userCreditsTable)
    .where(eq(userCreditsTable.userId, userId))
    .limit(1);

  if (!row) return { availableCredits: 0, reservedCredits: 0, totalConsumed: 0 };
  return {
    availableCredits: row.availableCredits,
    reservedCredits:  row.reservedCredits,
    totalConsumed:    row.totalConsumed,
  };
}

export async function hasEnoughCredits(userId: number, amount: number): Promise<boolean> {
  const wallet = await getUserCredits(userId);
  return wallet.availableCredits >= amount;
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Add credits to a user's wallet.
 * Creates the wallet row if it doesn't exist yet.
 * Accumulates (does not overwrite) so re-provisioning a user stacks credits.
 */
export async function provisionCredits(
  userId:      number,
  amount:      number,
  description: string,
): Promise<void> {
  if (amount <= 0) return;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: userCreditsTable.id, available: userCreditsTable.availableCredits })
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .limit(1);

    const balanceBefore = existing?.available ?? 0;
    const balanceAfter  = balanceBefore + amount;

    if (existing) {
      await tx
        .update(userCreditsTable)
        .set({ availableCredits: balanceAfter, updatedAt: new Date() })
        .where(eq(userCreditsTable.userId, userId));
    } else {
      await tx.insert(userCreditsTable).values({
        userId,
        availableCredits: amount,
        reservedCredits:  0,
        totalConsumed:    0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId,
      type:          "provision",
      amount,
      balanceBefore,
      balanceAfter,
      description,
    });
  });

  logger.info({ userId, amount, description }, "[Credits] Provisioned");
}

/**
 * Reserve credits for a video about to be submitted to HeyGen.
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
    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .limit(1);

    const available = wallet?.availableCredits ?? 0;

    if (available < amount) {
      throw new Error(
        `Saldo insuficiente: ${available} créditos disponibles, se requieren ${amount}`,
      );
    }

    await tx
      .update(userCreditsTable)
      .set({
        availableCredits: available - amount,
        reservedCredits:  (wallet?.reservedCredits ?? 0) + amount,
        updatedAt:        new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    await tx.insert(creditLedgerTable).values({
      userId,
      type:          "reserve",
      amount:        -amount,
      balanceBefore: available,
      balanceAfter:  available - amount,
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
    // Find the reserve entry for this video
    const [reservation] = await tx
      .select()
      .from(creditLedgerTable)
      .where(and(eq(creditLedgerTable.videoId, videoId), eq(creditLedgerTable.type, "reserve")))
      .limit(1);

    if (!reservation) {
      logger.debug({ videoId }, "[Credits] No reserve entry found — skipping consume");
      return;
    }

    // Idempotency: skip if already consumed or released
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

    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
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
      type:            "consume",
      amount:          -amount,
      balanceBefore:   wallet.availableCredits,
      balanceAfter:    wallet.availableCredits, // available doesn't change on consume
      videoId,
      relatedLedgerId: reservation.id,
      description:     `Video ${videoId} completado`,
    });
  });

  logger.info({ videoId }, "[Credits] Consumed");
}

/**
 * Release the reservation for a video that failed, timed out, or was cancelled.
 * Returns reserved credits to available. Idempotent: safe to call more than once.
 */
export async function releaseVideoCredits(videoId: number, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Find the reserve entry for this video
    const [reservation] = await tx
      .select()
      .from(creditLedgerTable)
      .where(and(eq(creditLedgerTable.videoId, videoId), eq(creditLedgerTable.type, "reserve")))
      .limit(1);

    if (!reservation) {
      logger.debug({ videoId }, "[Credits] No reserve entry found — skipping release");
      return;
    }

    // Idempotency: skip if already consumed or released
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

    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .limit(1);

    if (!wallet) return;

    await tx
      .update(userCreditsTable)
      .set({
        availableCredits: wallet.availableCredits + amount,
        reservedCredits:  Math.max(0, wallet.reservedCredits - amount),
        updatedAt:        new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    await tx.insert(creditLedgerTable).values({
      userId,
      type:            "release",
      amount,
      balanceBefore:   wallet.availableCredits,
      balanceAfter:    wallet.availableCredits + amount,
      videoId,
      relatedLedgerId: reservation.id,
      description:     reason,
    });
  });

  logger.info({ videoId, reason }, "[Credits] Released");
}

/**
 * Adjust a user's available credits by a signed amount.
 *
 *   amount > 0  → add credits   (admin top-up)
 *   amount < 0  → deduct credits (admin correction)
 *
 * Validation:
 *   - amount must be non-zero (caller should already enforce this, but we guard too)
 *   - a deduction that would drive availableCredits below 0 is rejected with a
 *     descriptive error so the caller can return a 422 to the client
 *
 * Records a ledger entry with type = "adjustment" (distinct from "provision",
 * which comes from purchases).
 */
export async function adjustCredits(
  userId:      number,
  amount:      number,
  description: string,
): Promise<void> {
  if (amount === 0) throw new Error("El monto debe ser distinto de 0");

  await db.transaction(async (tx) => {
    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .limit(1);

    const currentAvailable = wallet?.availableCredits ?? 0;
    const newAvailable      = currentAvailable + amount;

    if (newAvailable < 0) {
      throw new Error(
        `No se puede descontar ${Math.abs(amount)} créditos: el alumno solo tiene ${currentAvailable} disponibles.`,
      );
    }

    if (wallet) {
      await tx
        .update(userCreditsTable)
        .set({ availableCredits: newAvailable, updatedAt: new Date() })
        .where(eq(userCreditsTable.userId, userId));
    } else {
      // User has no wallet yet — only reachable when amount > 0 (negative would have thrown above)
      await tx.insert(userCreditsTable).values({
        userId,
        availableCredits: newAvailable,
        reservedCredits:  0,
        totalConsumed:    0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId,
      type:          "adjustment",
      amount,                          // positive = added, negative = deducted
      balanceBefore: currentAvailable,
      balanceAfter:  newAvailable,
      description,
    });
  });

  logger.info({ userId, amount, description }, "[Credits] Adjusted");
}

// ── Recovery ──────────────────────────────────────────────────────────────────

/**
 * Find videos that have an unsettled reserve entry (status=failed but credits
 * were never released). Call from the polling cycle to clean up orphaned reserves.
 */
export async function releaseOrphanedReserves(): Promise<void> {
  // Find reserve entries that have no corresponding consume/release
  // AND whose video is in a terminal state (failed/published)
  const orphanedReserves = await db
    .select({
      reserveId: creditLedgerTable.id,
      videoId:   creditLedgerTable.videoId,
    })
    .from(creditLedgerTable)
    .where(
      and(
        eq(creditLedgerTable.type, "reserve"),
        isNull(creditLedgerTable.relatedLedgerId), // self-reference check not possible this way
      ),
    )
    .limit(20);

  // This is handled inline in the polling loop instead — see scheduler.ts
  // This function is a placeholder for future batch recovery if needed.
  void orphanedReserves;
}
