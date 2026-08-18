/**
 * GET /api/config/public
 * Returns non-secret runtime config needed by the frontend.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { stripeKeyModesCompatible } from "./checkout-logic";

const router = Router();

router.get("/config/public", (_req: Request, res: Response): void => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? null;
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? null;
  const stripeConfigured = stripeKeyModesCompatible(secretKey, publishableKey);

  if (!stripeConfigured && (publishableKey || secretKey)) {
    console.error("[config/public] Stripe keys are missing or use different live/test modes");
  }

  res.json({
    stripePublishableKey: stripeConfigured ? publishableKey : null,
    stripeConfigured,
  });
});

export default router;
