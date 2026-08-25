/**
 * Wallet and credit operations for Reelsona.
 *
 * Credit lifecycle:
 *   reserve -> consume (success) OR release (failure/cancel/timeout)
 *
 * Pools:
 *   - subscriptionCredits reset on every subscription grant.
 *   - purchasedCredits never expire.
 *   - availableCredits = subscriptionCredits + purchasedCredits.
 *
 * Important billing-cycle rule:
 * A reservation is paid from the cycle in which it was created. A new
 * subscription grant must never be reduced by work still in flight from an old
 * cycle. If an old-cycle reservation later fails, only its purchased-credit
 * portion may be restored; expired subscription credits cannot leak into the new
 * cycle.
 */

import { db } from "@workspace/db";
import { userCreditsTable, creditLedgerTable, videosTable, purchases } from "@workspace/db";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { computeRenewalBalances, computeReleaseRestore } from "./credit-cycle-policy";

export const REEL_CREDITS_PER_30S = 50;
export const WAVESPEED_CREDITS_PER_30S = REEL_CREDITS_PER_30S;
export const HEYGEN_CREDITS_PER_30S = REEL_CREDITS_PER_30S;
export const LOOK_CREDIT_COST = 2;
export const EXTRA_VOICE_CREDIT_COST = 10;

export const PLAN_CREDITS: Record<string, number> = {
  basic: 400,
  pro: 1500,
  founder: 1500,
};

export const FOUNDER_MAX_SEATS = 10;
export const FOUNDER_MAX_MONTHS = 12;

export function computeReelCreditCost(durationSec: number): number {
  return Math.max(15, Math.ceil(durationSec * REEL_CREDITS_PER_30S / 30));
}

export function computeWavespeedCost(durationSec: number): number {
  return computeReelCreditCost(durationSec);
}

export function computeHeygenCost(durationSec: number): number {
  return computeReelCreditCost(durationSec);
}

export function estimateDurationFromScript(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(10, Math.ceil(words / 2.5));
}

export const VIDEO_CREDIT_COST = REEL_CREDITS_PER_30S;

export interface WalletState {
  availableCredits: number;
  subscriptionCredits: number;
  purchasedCredits: number;
  reservedCredits: number;
  totalConsumed: number;
}

type Tx = any;

async function latestSubscriptionProvisionAt(tx: Tx, userId: number): Promise<Date | null> {
  const result = await tx.execute(sql`
    SELECT created_at
      FROM credit_ledger
     WHERE user_id = ${userId}
       AND type = 'provision'
       AND pool = 'subscription'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  const raw = (result.rows[0] as Record<string, unknown> | undefined)?.created_at;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function computeReservationRestore(tx: Tx, reservation: any) {
  const amount = Math.abs(reservation.amount);
  const latestProvision = await latestSubscriptionProvisionAt(tx, reservation.userId);
  return computeReleaseRestore({
    amount,
    reservationSubscriptionAmount: reservation.subscriptionAmount ?? 0,
    reservationPurchasedAmount: reservation.purchasedAmount ?? 0,
    reservationCreatedAt: reservation.createdAt instanceof Date
      ? reservation.createdAt
      : new Date(reservation.createdAt),
    latestSubscriptionProvisionAt: latestProvision,
  });
}

export async function getUserCredits(userId: number): Promise<WalletState> {
  const [row] = await db
    .select()
    .from(userCreditsTable)
    .where(eq(userCreditsTable.userId, userId))
    .limit(1);

  if (!row) {
    return {
      availableCredits: 0,
      subscriptionCredits: 0,
      purchasedCredits: 0,
      reservedCredits: 0,
      totalConsumed: 0,
    };
  }

  return {
    availableCredits: row.availableCredits,
    subscriptionCredits: row.subscriptionCredits,
    purchasedCredits: row.purchasedCredits,
    reservedCredits: row.reservedCredits,
    totalConsumed: row.totalConsumed,
  };
}

export async function hasEnoughCredits(userId: number, amount: number): Promise<boolean> {
  const wallet = await getUserCredits(userId);
  return wallet.availableCredits >= amount;
}

export async function provisionSubscriptionCredits(
  userId: number,
  amount: number,
  description: string,
): Promise<void> {
  if (amount <= 0) return;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const prevSubCredits = existing?.subscriptionCredits ?? 0;
    const purchasedCredits = existing?.purchasedCredits ?? 0;
    const balanceBefore = existing?.availableCredits ?? 0;
    const balances = computeRenewalBalances({ planCredits: amount, purchasedCredits });

    if (existing) {
      await tx
        .update(userCreditsTable)
        .set({
          subscriptionCredits: balances.subscriptionCredits,
          availableCredits: balances.availableCredits,
          updatedAt: new Date(),
        })
        .where(eq(userCreditsTable.userId, userId));
    } else {
      await tx.insert(userCreditsTable).values({
        userId,
        availableCredits: balances.availableCredits,
        subscriptionCredits: balances.subscriptionCredits,
        purchasedCredits: balances.purchasedCredits,
        reservedCredits: 0,
        totalConsumed: 0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId,
      type: "provision",
      amount: balances.subscriptionCredits - prevSubCredits,
      balanceBefore,
      balanceAfter: balances.availableCredits,
      pool: "subscription",
      subscriptionAmount: balances.subscriptionCredits,
      description,
    });
  });

  logger.info({ userId, amount, description }, "[Credits] Subscription credits provisioned (fresh cycle)");
}

export async function provisionPurchasedCredits(
  userId: number,
  amount: number,
  description: string,
): Promise<void> {
  if (amount <= 0) return;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const prevPurchased = existing?.purchasedCredits ?? 0;
    const subCredits = existing?.subscriptionCredits ?? 0;
    const newPurchased = prevPurchased + amount;
    const newAvailable = subCredits + newPurchased;
    const balanceBefore = existing?.availableCredits ?? 0;

    if (existing) {
      await tx
        .update(userCreditsTable)
        .set({
          purchasedCredits: newPurchased,
          availableCredits: newAvailable,
          updatedAt: new Date(),
        })
        .where(eq(userCreditsTable.userId, userId));
    } else {
      await tx.insert(userCreditsTable).values({
        userId,
        availableCredits: amount,
        subscriptionCredits: 0,
        purchasedCredits: amount,
        reservedCredits: 0,
        totalConsumed: 0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId,
      type: "provision",
      amount,
      balanceBefore,
      balanceAfter: newAvailable,
      pool: "purchased",
      purchasedAmount: amount,
      description,
    });
  });

  logger.info({ userId, amount, description }, "[Credits] Purchased credits provisioned");
}

export async function provisionCredits(userId: number, amount: number, description: string): Promise<void> {
  return provisionPurchasedCredits(userId, amount, description);
}

export function computeRefundCreditReversal(
  purchasedBalance: number,
  purchasedAmount: number,
): number {
  return Math.min(Math.max(0, purchasedBalance), Math.max(0, purchasedAmount));
}

/**
 * Reverses the still-available portion of a refunded credit package.
 *
 * The refund key is stored in the ledger description and checked inside the
 * wallet transaction, making repeated Stripe refund events harmless.
 */
export async function revertPurchasedCreditsForRefund(
  userId: number,
  purchasedAmount: number,
  refundKey: string,
): Promise<{ reversed: number; alreadyProcessed: boolean }> {
  if (purchasedAmount <= 0) return { reversed: 0, alreadyProcessed: false };

  return db.transaction(async (tx) => {
    const marker = `Stripe refund ${refundKey}`;
    const [alreadyProcessed] = await tx
      .select({ id: creditLedgerTable.id })
      .from(creditLedgerTable)
      .where(and(
        eq(creditLedgerTable.userId, userId),
        eq(creditLedgerTable.type, "adjustment"),
        eq(creditLedgerTable.description, marker),
      ))
      .limit(1);

    if (alreadyProcessed) return { reversed: 0, alreadyProcessed: true };

    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    if (!wallet) {
      throw new Error(`Refund ${refundKey}: wallet not found for user ${userId}`);
    }

    const reversed = computeRefundCreditReversal(wallet.purchasedCredits, purchasedAmount);
    const balanceAfter = wallet.availableCredits - reversed;

    await tx
      .update(userCreditsTable)
      .set({
        purchasedCredits: wallet.purchasedCredits - reversed,
        availableCredits: balanceAfter,
        updatedAt: new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    await tx.insert(creditLedgerTable).values({
      userId,
      type: "adjustment",
      amount: -reversed,
      balanceBefore: wallet.availableCredits,
      balanceAfter,
      pool: "purchased",
      purchasedAmount: -reversed,
      description: marker,
    });

    return { reversed, alreadyProcessed: false };
  });
}

/**
 * Apply a Stripe refund to the exact purchase that produced the credits.
 * Refund progress is stored on the purchase so repeated/out-of-order
 * charge.refunded events only apply the newly refundable portion.
 */
export async function reconcilePurchasedCreditsRefund({
  purchaseId,
  userId,
  refundAmountCents,
  refundKey,
}: {
  purchaseId: number;
  userId: number;
  refundAmountCents: number;
  refundKey: string;
}): Promise<{ reversed: number; alreadyProcessed: boolean; shortfall: number }> {
  return db.transaction(async (tx) => {
    const [purchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .for("update")
      .limit(1);
    if (!purchase || purchase.userId !== userId || purchase.purchaseType !== "topup") {
      throw new Error(`Refund ${refundKey}: purchase ${purchaseId} is not a matching topup`);
    }

    const packageCredits = purchase.creditsPurchased ?? 0;
    const paidCents = purchase.amountTotal ?? 0;
    if (packageCredits <= 0 || paidCents <= 0 || refundAmountCents <= 0) {
      return { reversed: 0, alreadyProcessed: false, shortfall: 0 };
    }

    const cappedRefundCents = Math.min(refundAmountCents, paidCents);
    const targetRefundedCredits = computeRefundedCredits(
      packageCredits,
      paidCents,
      cappedRefundCents,
    );
    const delta = Math.max(0, targetRefundedCredits - purchase.refundedCredits);
    if (delta === 0) {
      return { reversed: 0, alreadyProcessed: true, shortfall: 0 };
    }

    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);
    if (!wallet) throw new Error(`Refund ${refundKey}: wallet not found for user ${userId}`);

    const reversed = Math.min(delta, wallet.purchasedCredits);
    const balanceAfter = wallet.availableCredits - reversed;
    await tx.update(userCreditsTable)
      .set({
        purchasedCredits: wallet.purchasedCredits - reversed,
        availableCredits: balanceAfter,
        updatedAt: new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    await tx.update(purchases)
      .set({
        refundedAmountCents: Math.max(purchase.refundedAmountCents, cappedRefundCents),
        refundedCredits: targetRefundedCredits,
        updatedAt: new Date(),
      })
      .where(eq(purchases.id, purchaseId));

    await tx.insert(creditLedgerTable).values({
      userId,
      type: "adjustment",
      amount: -reversed,
      balanceBefore: wallet.availableCredits,
      balanceAfter,
      pool: "purchased",
      purchasedAmount: -reversed,
      description: `Stripe refund ${refundKey} · purchase ${purchaseId}${reversed < delta ? ` · shortfall ${delta - reversed}` : ""}`,
    });

    return { reversed, alreadyProcessed: false, shortfall: delta - reversed };
  });
}

/** Convert a partial Stripe refund into the package's refundable credit count. */
export function computeRefundedCredits(
  packageCredits: number,
  paidAmountCents: number,
  refundAmountCents: number,
): number {
  if (packageCredits <= 0 || paidAmountCents <= 0 || refundAmountCents <= 0) return 0;
  return Math.min(
    packageCredits,
    Math.floor((packageCredits * Math.min(refundAmountCents, paidAmountCents)) / paidAmountCents),
  );
}

export type CreditReconciliationIssue = {
  userId: number;
  walletAvailable: number;
  ledgerAvailable: number;
  difference: number;
};

/**
 * Reconcile the wallet's spendable balance against the append-only ledger.
 * Consumption does not change available credits, so consume rows are excluded.
 * This is intentionally read-only: historical discrepancies need an explicit
 * operator decision rather than an automatic destructive correction.
 */
export async function findCreditReconciliationIssues(): Promise<CreditReconciliationIssue[]> {
  const result = await db.execute(sql`
    SELECT
      w.user_id AS "userId",
      w.available_credits AS "walletAvailable",
      COALESCE(SUM(
        CASE WHEN l.type IN ('provision', 'reserve', 'release', 'adjustment')
             THEN l.amount ELSE 0 END
      ), 0) AS "ledgerAvailable"
    FROM user_credits w
    LEFT JOIN credit_ledger l ON l.user_id = w.user_id
    GROUP BY w.user_id, w.available_credits
    HAVING w.available_credits <> COALESCE(SUM(
      CASE WHEN l.type IN ('provision', 'reserve', 'release', 'adjustment')
           THEN l.amount ELSE 0 END
    ), 0)
    ORDER BY w.user_id
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    const walletAvailable = Number(row.walletAvailable ?? 0);
    const ledgerAvailable = Number(row.ledgerAvailable ?? 0);
    return {
      userId: Number(row.userId),
      walletAvailable,
      ledgerAvailable,
      difference: walletAvailable - ledgerAvailable,
    };
  });
}

async function reserveGeneric(
  userId: number,
  amount: number,
  ledgerFields: Record<string, unknown>,
  description: string,
): Promise<number> {
  let reservationId = 0;

  await db.transaction(async (tx) => {
    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const available = wallet?.availableCredits ?? 0;
    if (available < amount) {
      throw new Error(`Saldo insuficiente: ${available} créditos disponibles, se requieren ${amount}`);
    }

    const subCr = wallet?.subscriptionCredits ?? 0;
    const purCr = wallet?.purchasedCredits ?? 0;
    const fromSub = Math.min(subCr, amount);
    const fromPur = amount - fromSub;
    const pool = fromSub > 0 && fromPur > 0 ? "mixed" : fromSub > 0 ? "subscription" : "purchased";

    await tx
      .update(userCreditsTable)
      .set({
        availableCredits: available - amount,
        subscriptionCredits: subCr - fromSub,
        purchasedCredits: purCr - fromPur,
        reservedCredits: (wallet?.reservedCredits ?? 0) + amount,
        updatedAt: new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    const [row] = await tx.insert(creditLedgerTable).values({
      userId,
      type: "reserve",
      amount: -amount,
      balanceBefore: available,
      balanceAfter: available - amount,
      pool,
      subscriptionAmount: fromSub > 0 ? fromSub : undefined,
      purchasedAmount: fromPur > 0 ? fromPur : undefined,
      ...ledgerFields,
      description,
    }).returning({ id: creditLedgerTable.id });

    reservationId = row.id;
  });

  return reservationId;
}

async function settleGenericInTransaction(
  tx: Tx,
  reservation: any,
  mode: "consume" | "release",
  reason: string,
  ledgerFields: Record<string, unknown>,
): Promise<boolean> {
  const amount = Math.abs(reservation.amount);
  const userId = reservation.userId;
  let settled = false;

  const [lockedReservation] = await tx
      .select()
      .from(creditLedgerTable)
      .where(eq(creditLedgerTable.id, reservation.id))
      .for("update")
      .limit(1);

  if (!lockedReservation || lockedReservation.type !== "reserve") return settled;

  const [alreadySettled] = await tx
      .select({ id: creditLedgerTable.id })
      .from(creditLedgerTable)
      .where(and(
        eq(creditLedgerTable.relatedLedgerId, lockedReservation.id),
        inArray(creditLedgerTable.type, ["consume", "release"]),
      ))
      .limit(1);
  if (alreadySettled) return settled;

  const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);
  if (!wallet) return settled;

  if (mode === "consume") {
    await tx
        .update(userCreditsTable)
        .set({
          reservedCredits: Math.max(0, wallet.reservedCredits - amount),
          totalConsumed: wallet.totalConsumed + amount,
          updatedAt: new Date(),
        })
        .where(eq(userCreditsTable.userId, userId));

    await tx.insert(creditLedgerTable).values({
        userId,
        type: "consume",
        amount: -amount,
        balanceBefore: wallet.availableCredits,
        balanceAfter: wallet.availableCredits,
        pool: lockedReservation.pool ?? undefined,
        subscriptionAmount: lockedReservation.subscriptionAmount ?? undefined,
        purchasedAmount: lockedReservation.purchasedAmount ?? undefined,
        ...ledgerFields,
        relatedLedgerId: lockedReservation.id,
        description: reason,
      });
    settled = true;
    return settled;
  }

  const restore = await computeReservationRestore(tx, lockedReservation);
  const restoredAmount = restore.restoreSubscription + restore.restorePurchased;

  await tx
      .update(userCreditsTable)
      .set({
        availableCredits: wallet.availableCredits + restoredAmount,
        subscriptionCredits: wallet.subscriptionCredits + restore.restoreSubscription,
        purchasedCredits: wallet.purchasedCredits + restore.restorePurchased,
        reservedCredits: Math.max(0, wallet.reservedCredits - amount),
        updatedAt: new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

  await tx.insert(creditLedgerTable).values({
      userId,
      type: "release",
      amount: restoredAmount,
      balanceBefore: wallet.availableCredits,
      balanceAfter: wallet.availableCredits + restoredAmount,
      pool: lockedReservation.pool ?? undefined,
      subscriptionAmount: restore.restoreSubscription || undefined,
      purchasedAmount: restore.restorePurchased || undefined,
      ...ledgerFields,
      relatedLedgerId: lockedReservation.id,
      description: restore.expiredSubscriptionAmount > 0
        ? `${reason} · ${restore.expiredSubscriptionAmount} créditos de suscripción pertenecían a un ciclo vencido y no se trasladaron`
        : reason,
    });
  settled = true;
  return settled;
}

async function settleGeneric(
  reservation: any,
  mode: "consume" | "release",
  reason: string,
  ledgerFields: Record<string, unknown>,
): Promise<boolean> {
  return db.transaction((tx) => settleGenericInTransaction(
    tx,
    reservation,
    mode,
    reason,
    ledgerFields,
  ));
}

export async function reserveCredits(
  userId: number,
  amount: number,
  videoId: number,
  description: string,
): Promise<void> {
  await reserveGeneric(userId, amount, { videoId }, description);
  logger.info({ userId, amount, videoId }, "[Credits] Reserved");
}

export async function consumeVideoCredits(videoId: number): Promise<void> {
  const [reservation] = await db
    .select()
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.videoId, videoId),
      eq(creditLedgerTable.type, "reserve"),
      isNull(creditLedgerTable.feature),
    ))
    .limit(1);
  if (!reservation) return;
  const consumed = await settleGeneric(reservation, "consume", `Video ${videoId} completado`, { videoId });
  if (consumed) logger.info({ videoId }, "[Credits] Consumed");
}

export async function releaseVideoCredits(videoId: number, reason: string): Promise<boolean> {
  const [reservation] = await db
    .select()
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.videoId, videoId),
      eq(creditLedgerTable.type, "reserve"),
      isNull(creditLedgerTable.feature),
    ))
    .limit(1);
  if (!reservation) return false;
  const released = await settleGeneric(reservation, "release", reason, { videoId });
  if (released) logger.info({ videoId, reason }, "[Credits] Released");
  return released;
}

export async function adjustCredits(
  userId: number,
  amount: number,
  description: string,
): Promise<void> {
  if (amount === 0) throw new Error("El monto debe ser distinto de 0");

  await db.transaction(async (tx) => {
    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const currentAvailable = wallet?.availableCredits ?? 0;
    const currentSub = wallet?.subscriptionCredits ?? 0;
    const currentPurchased = wallet?.purchasedCredits ?? 0;
    const newAvailable = currentAvailable + amount;

    if (newAvailable < 0) {
      throw new Error(`No se puede descontar ${Math.abs(amount)} créditos: el usuario solo tiene ${currentAvailable} disponibles.`);
    }

    let newSub = currentSub;
    let newPurchased = currentPurchased;

    if (amount > 0) {
      newPurchased += amount;
    } else {
      const deduct = Math.abs(amount);
      const fromPurchased = Math.min(currentPurchased, deduct);
      newPurchased -= fromPurchased;
      newSub -= deduct - fromPurchased;
    }

    if (newSub < 0 || newPurchased < 0) {
      throw new Error(`Internal: pool balance would go negative (sub=${newSub}, purchased=${newPurchased})`);
    }

    if (wallet) {
      await tx
        .update(userCreditsTable)
        .set({
          availableCredits: newAvailable,
          subscriptionCredits: newSub,
          purchasedCredits: newPurchased,
          updatedAt: new Date(),
        })
        .where(eq(userCreditsTable.userId, userId));
    } else {
      await tx.insert(userCreditsTable).values({
        userId,
        availableCredits: newAvailable,
        subscriptionCredits: 0,
        purchasedCredits: newPurchased,
        reservedCredits: 0,
        totalConsumed: 0,
      });
    }

    await tx.insert(creditLedgerTable).values({
      userId,
      type: "adjustment",
      amount,
      balanceBefore: currentAvailable,
      balanceAfter: newAvailable,
      pool: amount > 0
        ? "purchased"
        : (Math.min(currentPurchased, Math.abs(amount)) === Math.abs(amount) ? "purchased" : "subscription"),
      subscriptionAmount: newSub,
      purchasedAmount: newPurchased,
      description,
    });
  });

  logger.info({ userId, amount, description }, "[Credits] Adjusted");
}

export async function reserveLookCredits(
  userId: number,
  amount: number,
  lookId: number,
  description: string,
): Promise<void> {
  await reserveGeneric(userId, amount, { lookId }, description);
  logger.info({ userId, amount, lookId }, "[Credits] Look reserve");
}

export async function consumeLookCredits(lookId: number): Promise<void> {
  const [reservation] = await db
    .select()
    .from(creditLedgerTable)
    .where(and(eq(creditLedgerTable.lookId, lookId), eq(creditLedgerTable.type, "reserve")))
    .limit(1);
  if (!reservation) return;
  await settleGeneric(reservation, "consume", `Look ${lookId} completado`, { lookId });
  logger.info({ lookId }, "[Credits] Look consumed");
}

export async function releaseLookCredits(lookId: number, reason: string): Promise<void> {
  const [reservation] = await db
    .select()
    .from(creditLedgerTable)
    .where(and(eq(creditLedgerTable.lookId, lookId), eq(creditLedgerTable.type, "reserve")))
    .limit(1);
  if (!reservation) return;
  await settleGeneric(reservation, "release", reason, { lookId });
  logger.info({ lookId, reason }, "[Credits] Look released");
}

export async function reserveVoiceCredits(
  userId: number,
  amount: number,
  voiceCloneId: number,
  voiceCloneType: "wavespeed" | "heygen",
  description: string,
): Promise<void> {
  await reserveGeneric(userId, amount, { voiceCloneId, voiceCloneType }, description);
  logger.info({ userId, amount, voiceCloneId, voiceCloneType }, "[Credits] Voice reserve");
}

export async function consumeVoiceCredits(
  voiceCloneId: number,
  voiceCloneType: "wavespeed" | "heygen",
): Promise<void> {
  const [reservation] = await db
    .select()
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.voiceCloneId, voiceCloneId),
      eq(creditLedgerTable.voiceCloneType, voiceCloneType),
      eq(creditLedgerTable.type, "reserve"),
    ))
    .limit(1);
  if (!reservation) return;
  await settleGeneric(
    reservation,
    "consume",
    `Voz ${voiceCloneType}-${voiceCloneId} lista`,
    { voiceCloneId, voiceCloneType },
  );
  logger.info({ voiceCloneId, voiceCloneType }, "[Credits] Voice consumed");
}

export async function releaseVoiceCredits(
  voiceCloneId: number,
  voiceCloneType: "wavespeed" | "heygen",
  reason: string,
): Promise<void> {
  const [reservation] = await db
    .select()
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.voiceCloneId, voiceCloneId),
      eq(creditLedgerTable.voiceCloneType, voiceCloneType),
      eq(creditLedgerTable.type, "reserve"),
    ))
    .limit(1);
  if (!reservation) return;
  await settleGeneric(reservation, "release", reason, { voiceCloneId, voiceCloneType });
  logger.info({ voiceCloneId, voiceCloneType, reason }, "[Credits] Voice released");
}

export const BROLL_IMAGE_CREDIT_COST = 2;

export function canUseBRollCredits(videoStatus: string | null | undefined): boolean {
  return videoStatus !== "cancelled";
}

export async function reserveBRollImageCredits(
  userId: number,
  videoId: number,
  segmentIdx: number,
): Promise<number | "already_paid" | null> {
  const amount = BROLL_IMAGE_CREDIT_COST;
  const idempotencyKey = `B-roll imagen ${segmentIdx + 1} (video ${videoId})`;
  let reservationId: number | "already_paid" | null = null;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'broll:' + videoId + ':' + segmentIdx}))`);

    const [video] = await tx
      .select({ status: videosTable.status })
      .from(videosTable)
      .where(and(eq(videosTable.id, videoId), eq(videosTable.userId, userId)))
      .for("update")
      .limit(1);
    if (!video || !canUseBRollCredits(video.status)) {
      logger.info({ userId, videoId, segmentIdx }, "[Credits] B-roll reserve skipped for cancelled or unavailable video");
      return;
    }

    const [prior] = await tx
      .select({ id: creditLedgerTable.id })
      .from(creditLedgerTable)
      .where(and(
        eq(creditLedgerTable.userId, userId),
        eq(creditLedgerTable.videoId, videoId),
        eq(creditLedgerTable.type, "reserve"),
        eq(creditLedgerTable.feature, "broll"),
        eq(creditLedgerTable.description, idempotencyKey),
        sql`NOT EXISTS (
          SELECT 1 FROM credit_ledger s
          WHERE s.related_ledger_id = ${creditLedgerTable.id} AND s.type = 'release'
        )`,
      ))
      .limit(1);

    if (prior) {
      reservationId = "already_paid";
      return;
    }

    const [wallet] = await tx
      .select()
      .from(userCreditsTable)
      .where(eq(userCreditsTable.userId, userId))
      .for("update")
      .limit(1);

    const available = wallet?.availableCredits ?? 0;
    if (available < amount) {
      logger.warn({ userId, videoId, segmentIdx, available }, "[Credits] Saldo insuficiente para imagen B-roll — se omite");
      return;
    }

    const subCr = wallet?.subscriptionCredits ?? 0;
    const purCr = wallet?.purchasedCredits ?? 0;
    const fromSub = Math.min(subCr, amount);
    const fromPur = amount - fromSub;
    const pool = fromSub > 0 && fromPur > 0 ? "mixed" : fromSub > 0 ? "subscription" : "purchased";

    await tx
      .update(userCreditsTable)
      .set({
        availableCredits: available - amount,
        subscriptionCredits: subCr - fromSub,
        purchasedCredits: purCr - fromPur,
        reservedCredits: (wallet?.reservedCredits ?? 0) + amount,
        updatedAt: new Date(),
      })
      .where(eq(userCreditsTable.userId, userId));

    const [row] = await tx.insert(creditLedgerTable).values({
      userId,
      type: "reserve",
      amount: -amount,
      balanceBefore: available,
      balanceAfter: available - amount,
      pool,
      subscriptionAmount: fromSub > 0 ? fromSub : undefined,
      purchasedAmount: fromPur > 0 ? fromPur : undefined,
      videoId,
      feature: "broll",
      description: idempotencyKey,
    }).returning({ id: creditLedgerTable.id });

    reservationId = row.id;
  });

  if (typeof reservationId === "number") {
    logger.info({ userId, videoId, segmentIdx, reservationId }, "[Credits] B-roll reserve");
  }
  return reservationId;
}

async function settleBRollReservation(
  reservationId: number,
  mode: "consume" | "release",
  reason: string,
  tx?: Tx,
): Promise<boolean> {
  const executor = tx ?? db;
  const [reservation] = await executor
    .select()
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.id, reservationId),
      eq(creditLedgerTable.type, "reserve"),
      eq(creditLedgerTable.feature, "broll"),
    ))
    .limit(1);
  if (!reservation) return false;
  if (tx) {
    return settleGenericInTransaction(
      tx,
      reservation,
      mode,
      reason,
      { videoId: reservation.videoId ?? undefined, feature: "broll" },
    );
  }
  return settleGeneric(
    reservation,
    mode,
    reason,
    { videoId: reservation.videoId ?? undefined, feature: "broll" },
  );
}

export async function consumeBRollImageCredits(reservationId: number, videoId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [video] = await tx
      .select({ status: videosTable.status })
      .from(videosTable)
      .where(eq(videosTable.id, videoId))
      .for("update")
      .limit(1);

    if (!video || !canUseBRollCredits(video.status)) {
      await settleBRollReservation(
        reservationId,
        "release",
        "B-roll: video cancelado antes de liquidar la imagen",
        tx,
      );
      logger.info({ reservationId, videoId }, "[Credits] B-roll consume fenced by cancellation");
      return false;
    }

    return settleBRollReservation(
      reservationId,
      "consume",
      `B-roll imagen generada (video ${videoId})`,
      tx,
    );
  });
}

export async function releaseBRollImageCredits(reservationId: number, reason: string): Promise<boolean> {
  return settleBRollReservation(reservationId, "release", reason);
}

export interface ReleasedVideoReservation {
  reservationId: number;
  feature: string | null;
}

export function shouldReleaseCancelledVideoReservation(
  feature: string | null,
  includeGenerationReservation: boolean,
): boolean {
  return includeGenerationReservation || feature !== null;
}

/**
 * Release only the unsettled reservations belonging to one cancelled video.
 * The underlying ledger settlement locks each reservation and no-ops if another
 * worker consumed or released it first, which makes retries safe.
 */
export async function releaseOpenVideoReservations(input: {
  userId: number;
  videoId: number;
  includeGenerationReservation: boolean;
  reason: string;
}): Promise<ReleasedVideoReservation[]> {
  const reservations = await db
    .select({
      id: creditLedgerTable.id,
      feature: creditLedgerTable.feature,
      userId: creditLedgerTable.userId,
      videoId: creditLedgerTable.videoId,
      amount: creditLedgerTable.amount,
      pool: creditLedgerTable.pool,
      subscriptionAmount: creditLedgerTable.subscriptionAmount,
      purchasedAmount: creditLedgerTable.purchasedAmount,
    })
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.userId, input.userId),
      eq(creditLedgerTable.videoId, input.videoId),
      eq(creditLedgerTable.type, "reserve"),
      sql`NOT EXISTS (
        SELECT 1 FROM credit_ledger settlement
        WHERE settlement.related_ledger_id = ${creditLedgerTable.id}
          AND settlement.type IN ('consume', 'release')
      )`,
    ));

  const released: ReleasedVideoReservation[] = [];
  for (const reservation of reservations) {
    if (!shouldReleaseCancelledVideoReservation(
      reservation.feature,
      input.includeGenerationReservation,
    )) continue;

    const didRelease = await settleGeneric(
      reservation,
      "release",
      input.reason,
      {
        videoId: input.videoId,
        ...(reservation.feature ? { feature: reservation.feature } : {}),
      },
    );
    if (didRelease) {
      released.push({ reservationId: reservation.id, feature: reservation.feature });
    }
  }

  return released;
}

export async function releaseStaleBRollReserves(maxAgeMinutes = 60): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
  const stale = await db
    .select({ id: creditLedgerTable.id })
    .from(creditLedgerTable)
    .where(and(
      eq(creditLedgerTable.type, "reserve"),
      eq(creditLedgerTable.feature, "broll"),
      sql`${creditLedgerTable.createdAt} < ${cutoff}`,
      sql`NOT EXISTS (
        SELECT 1 FROM credit_ledger s
        WHERE s.related_ledger_id = ${creditLedgerTable.id}
          AND s.type IN ('consume', 'release')
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM videos v
        WHERE v.id = ${creditLedgerTable.videoId}
          AND v.caption_status = 'processing'
          AND v.updated_at > NOW() - INTERVAL '6 hours'
      )`,
    ));

  for (const row of stale) {
    await releaseBRollImageCredits(row.id, "B-roll: reserva huérfana liberada por barrido de recuperación");
  }

  if (stale.length > 0) {
    logger.warn({ count: stale.length }, "[Credits] Stale B-roll reserves released");
  }
}

export async function releaseOrphanedReserves(): Promise<void> {
  void isNull;
}
