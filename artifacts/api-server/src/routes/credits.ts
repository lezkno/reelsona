/**
 * GET /api/credits/balance
 *
 * Returns the authenticated user's credit wallet.
 * Mounted after requireAuth, before requireToolAccess so users can always
 * check their balance even when tool access is expired.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { getUserCredits, VIDEO_CREDIT_COST } from "../lib/credits";

const router = Router();

router.get("/credits/balance", async (req: Request, res: Response): Promise<void> => {
  const { userId, role } = req.session.user!;

  try {
    if (role === "admin") {
      // Admins bypass credit checks entirely — return unlimited indicator
      res.json({
        availableCredits: null,
        reservedCredits:  0,
        totalConsumed:    0,
        videosRemaining:  null,
        creditCost:       VIDEO_CREDIT_COST,
        isAdmin:          true,
      });
      return;
    }

    const wallet = await getUserCredits(userId);
    res.json({
      availableCredits: wallet.availableCredits,
      reservedCredits:  wallet.reservedCredits,
      totalConsumed:    wallet.totalConsumed,
      videosRemaining:  Math.floor(wallet.availableCredits / VIDEO_CREDIT_COST),
      creditCost:       VIDEO_CREDIT_COST,
      isAdmin:          false,
    });
  } catch (err) {
    console.error("[credits/balance]", err);
    res.status(500).json({ error: "Error al obtener el saldo de créditos" });
  }
});

export default router;
