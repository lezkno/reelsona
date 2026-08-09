/**
 * GET /api/config/public
 * Returns non-secret runtime config needed by the frontend (e.g. Stripe publishable key).
 */

import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

router.get("/config/public", (_req: Request, res: Response): void => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
  });
});

export default router;
