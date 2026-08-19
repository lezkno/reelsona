/**
 * GET /api/credits/balance
 *
 * Returns the authenticated user's credit wallet.
 * Mounted after requireAuth, before requireToolAccess so users can always
 * check their balance even when tool access is expired.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { creditLedgerTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql, type SQL } from "drizzle-orm";
import { getUserCredits, REEL_CREDITS_PER_30S } from "../lib/credits";

const router = Router();

router.get("/credits/balance", async (req: Request, res: Response): Promise<void> => {
  const { userId, role } = req.session.user!;

  try {
    if (role === "admin") {
      // Admins bypass credit checks entirely — return unlimited indicator
      res.json({
        availableCredits:    null,
        subscriptionCredits: null,
        purchasedCredits:    null,
        reservedCredits:     0,
        totalConsumed:       0,
        isAdmin:             true,
        costTable: {
          reelPer30s: REEL_CREDITS_PER_30S,
        },
      });
      return;
    }

    const wallet = await getUserCredits(userId);
    res.json({
      availableCredits:    wallet.availableCredits,
      subscriptionCredits: wallet.subscriptionCredits,
      purchasedCredits:    wallet.purchasedCredits,
      reservedCredits:     wallet.reservedCredits,
      totalConsumed:       wallet.totalConsumed,
      isAdmin:             false,
      costTable: {
        reelPer30s: REEL_CREDITS_PER_30S,
      },
    });
  } catch (err) {
    console.error("[credits/balance]", err);
    res.status(500).json({ error: "Error al obtener el saldo de créditos" });
  }
});

/**
 * GET /api/credits/history
 *
 * Paginated credit ledger for the authenticated user.
 * Query params: page (1-based, default 1), from (ISO date), to (ISO date).
 * Fixed page size of 20.
 */
const HISTORY_PAGE_SIZE = 20;

router.get("/credits/history", async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.session.user!;

  try {
    const pageRaw = parseInt(String(req.query.page ?? "1"), 10);
    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

    const conditions: SQL[] = [eq(creditLedgerTable.userId, userId)];

    const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
    if (fromRaw) {
      const from = new Date(fromRaw);
      if (isNaN(from.getTime())) {
        res.status(400).json({ error: "Fecha 'desde' inválida" });
        return;
      }
      conditions.push(gte(creditLedgerTable.createdAt, from));
    }

    const toRaw = typeof req.query.to === "string" ? req.query.to : null;
    if (toRaw) {
      const to = new Date(toRaw);
      if (isNaN(to.getTime())) {
        res.status(400).json({ error: "Fecha 'hasta' inválida" });
        return;
      }
      // Make 'to' inclusive of the whole day when a bare date is passed
      if (/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) to.setUTCHours(23, 59, 59, 999);
      conditions.push(lte(creditLedgerTable.createdAt, to));
    }

    const where = and(...conditions);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(creditLedgerTable)
      .where(where);

    const rows = await db
      .select({
        id:          creditLedgerTable.id,
        type:        creditLedgerTable.type,
        amount:      creditLedgerTable.amount,
        description: creditLedgerTable.description,
        feature:     creditLedgerTable.feature,
        videoId:     creditLedgerTable.videoId,
        createdAt:   creditLedgerTable.createdAt,
      })
      .from(creditLedgerTable)
      .where(where)
      .orderBy(desc(creditLedgerTable.createdAt), desc(creditLedgerTable.id))
      .limit(HISTORY_PAGE_SIZE)
      .offset((page - 1) * HISTORY_PAGE_SIZE);

    res.json({
      entries:  rows,
      total,
      page,
      pageSize: HISTORY_PAGE_SIZE,
    });
  } catch (err) {
    console.error("[credits/history]", err);
    res.status(500).json({ error: "Error al obtener el historial de créditos" });
  }
});

export default router;
