/**
 * WaveSpeed internal routes
 *
 * GET /wavespeed/status — health-check: reports whether WAVESPEED_API_KEY is
 *   configured and lists the supported model identifiers.
 *   Does NOT call the WaveSpeed API; safe to call with no quota impact.
 *
 * All routes require authentication (mounted under requireAuth in app.ts via
 * the main router in routes/index.ts).
 */

import { Router } from "express";
import { isWavespeedConfigured, WAVESPEED_MODELS } from "../lib/wavespeed";

const router = Router();

/**
 * GET /wavespeed/status
 * Returns whether the WaveSpeed API key is present and the supported models.
 * No WaveSpeed network call is made.
 */
router.get("/wavespeed/status", (req, res) => {
  const configured = isWavespeedConfigured();
  res.json({
    configured,
    models: Object.values(WAVESPEED_MODELS),
    note: configured
      ? "WAVESPEED_API_KEY is set — pipeline ready"
      : "WAVESPEED_API_KEY is not configured — add it to Replit Secrets to enable the WaveSpeed pipeline",
  });
});

export default router;
