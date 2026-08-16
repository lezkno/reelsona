/**
 * GET /api/credits/balance
 *
 * Returns the authenticated user's credit wallet.
 * Mounted after requireAuth, before requireToolAccess so users can always
 * check their balance even when tool access is expired.
 */

import { Router } from "express";
import type { Request, Response } from "express";
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

export default router;
