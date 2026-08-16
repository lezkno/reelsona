/**
 * GET /api/credits/balance
 *
 * Returns the authenticated user's credit wallet.
 * Mounted after requireAuth, before requireToolAccess so users can always
 * check their balance even when tool access is expired.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { getUserCredits, VIDEO_CREDIT_COST, WAVESPEED_CREDITS_PER_30S, HEYGEN_CREDITS_PER_30S } from "../lib/credits";

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
        videosRemaining:     null,
        isAdmin:             true,
        costTable: {
          wavespeedPer30s: WAVESPEED_CREDITS_PER_30S,
          heygenPer30s:    HEYGEN_CREDITS_PER_30S,
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
      // Approximate videos remaining using WaveSpeed 30 s cost as a reference unit
      videosRemaining: Math.floor(wallet.availableCredits / WAVESPEED_CREDITS_PER_30S),
      isAdmin:         false,
      costTable: {
        wavespeedPer30s: WAVESPEED_CREDITS_PER_30S,
        heygenPer30s:    HEYGEN_CREDITS_PER_30S,
      },
    });
  } catch (err) {
    console.error("[credits/balance]", err);
    res.status(500).json({ error: "Error al obtener el saldo de créditos" });
  }
});

export default router;
