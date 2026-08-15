/**
 * WaveSpeed Voice Director — preview/debug route
 *
 * POST /api/wavespeed/voice-director/analyze
 *
 * Receives a script + preset and returns the full segmentation analysis
 * as JSON. NO WaveSpeed or MiniMax calls are made — this is a pure
 * preview/debug endpoint that costs zero credits.
 *
 * Protected by:
 *   1. requireAuth   — must be logged in
 *   2. requireToolAccess (applied at router mount in routes/index.ts)
 *
 * SCOPE NOTE
 * ----------
 * This route is exclusively for WaveSpeed/MiniMax. It has no connection to
 * HeyGen voice generation, SSML, resolveVoiceId, or HeyGen video pipelines.
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { VOICE_DIRECTOR_PRESET_IDS, type VoiceDirectorPresetId } from "../lib/wavespeed.js";
import { analyzeScriptForWavespeed } from "../lib/wavespeed-voice-director.js";

const router = Router();

// ── Local auth helper (same pattern as wavespeed.ts) ──────────────────────────

function requireAuth(req: Request, res: Response): number | null {
  const userId = (req.session as any)?.userId as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return userId;
}

// ── POST /wavespeed/voice-director/analyze ────────────────────────────────────

/**
 * Body:
 *   { text: string; preset?: "natural" | "energetico" | "dramatico" }
 *
 * Returns:
 *   {
 *     preset: VoiceDirectorPreset;
 *     segments: WavespeedVoiceSegment[];
 *     ttsScript: string;          // MiniMax-ready with <#N#> pause tokens
 *     summary: Record<SegmentIntent, number>;
 *     meta: { charCount, segmentCount, previewOnly: true }
 *   }
 */
router.post("/wavespeed/voice-director/analyze", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { text, preset: presetId = "natural" } = req.body as {
    text?: string;
    preset?: string;
  };

  // Validate text
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Field 'text' is required and must be a non-empty string" });
    return;
  }
  if (text.length > 5000) {
    res.status(400).json({ error: "Field 'text' must be 5000 characters or fewer" });
    return;
  }

  // Validate preset
  if (!VOICE_DIRECTOR_PRESET_IDS.includes(presetId as VoiceDirectorPresetId)) {
    res.status(400).json({
      error: `Field 'preset' must be one of: ${VOICE_DIRECTOR_PRESET_IDS.join(", ")}`,
    });
    return;
  }

  try {
    const analysis = analyzeScriptForWavespeed(text.trim(), presetId as VoiceDirectorPresetId);

    req.log.info(
      {
        userId,
        preset: presetId,
        segmentCount: analysis.segments.length,
        summary: analysis.summary,
      },
      "[WaveSpeed VoiceDirector] Script analyzed (preview only — no TTS generated)",
    );

    res.json({
      ...analysis,
      meta: {
        charCount: text.trim().length,
        segmentCount: analysis.segments.length,
        /**
         * Always true — this endpoint is a preview/debug tool.
         * No WaveSpeed or MiniMax credits were consumed.
         */
        previewOnly: true,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed VoiceDirector] Analysis failed");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

export default router;
