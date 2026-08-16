/**
 * WaveSpeed Voice Director — routes
 *
 * Routes (all under /api prefix via Express):
 *
 *   POST /wavespeed/voice-director/analyze
 *     Pure segmentation preview — no WaveSpeed calls, zero credits.
 *     Requires auth + requireToolAccess (applied at mount in routes/index.ts).
 *
 *   POST /wavespeed/voice-director/preview-audio
 *     Generates a real audio preview by submitting minimax/speech-2.6-turbo jobs
 *     per segment, polling for completion, and concatenating with FFmpeg.
 *     Requires auth + requireToolAccess. Consumes WaveSpeed credits.
 *     Returns JSON including per-segment job info and a local audio file path.
 *
 *   GET /wavespeed/voice-director/audio/:filename
 *     Serves a generated preview .mp3 from /tmp/contentpilot-vd-audio/.
 *     Requires auth only (no tool-access check — user must already have
 *     generated the file in a previous preview-audio call).
 *     Filename is a UUID-based name — unguessable without prior API access.
 *
 * SCOPE NOTE
 * ----------
 * All routes are exclusively for WaveSpeed/MiniMax. No connection to HeyGen
 * voice generation, SSML, resolveVoiceId, generateVideo, or HeyGen scheduling.
 */

import { Router, type Request, type Response } from "express";
import { createReadStream, existsSync }         from "node:fs";
import { basename }                             from "node:path";

import {
  VOICE_DIRECTOR_PRESET_IDS,
  type VoiceDirectorPresetId,
  isWavespeedConfigured,
  getJobStatus,
} from "../lib/wavespeed.js";
import { analyzeScriptForWavespeed }    from "../lib/wavespeed-voice-director.js";
import { prepareForTts }               from "../lib/spoken-script-normalizer.js";
import {
  generateVdAudioPreview,
  VD_AUDIO_DIR,
}                                       from "../lib/wavespeed-voice-director-audio.js";
import { generateVdVideoPreview }       from "../lib/wavespeed-voice-director-video.js";

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// ── Auth helper (same pattern as wavespeed.ts) ────────────────────────────────

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
 * Pure script segmentation — NO WaveSpeed calls, zero credits.
 *
 * Body:   { text: string; preset?: "natural" | "energetico" | "dramatico" }
 * Returns: { preset, segments, ttsScript, summary, meta: { previewOnly: true } }
 */
router.post("/wavespeed/voice-director/analyze", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const { text, preset: presetId = "natural" } = req.body as {
    text?: string;
    preset?: string;
  };

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Field 'text' is required and must be a non-empty string" });
    return;
  }
  if (text.length > 5000) {
    res.status(400).json({ error: "Field 'text' must be 5000 characters or fewer" });
    return;
  }
  if (!VOICE_DIRECTOR_PRESET_IDS.includes(presetId as VoiceDirectorPresetId)) {
    res.status(400).json({
      error: `Field 'preset' must be one of: ${VOICE_DIRECTOR_PRESET_IDS.join(", ")}`,
    });
    return;
  }

  try {
    const analysis = analyzeScriptForWavespeed(text.trim(), presetId as VoiceDirectorPresetId);
    req.log.info(
      { userId, preset: presetId, segmentCount: analysis.segments.length },
      "[WaveSpeed VoiceDirector] Script analyzed (no TTS — free preview)",
    );
    res.json({
      ...analysis,
      meta: {
        charCount:   text.trim().length,
        segmentCount: analysis.segments.length,
        previewOnly:  true,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed VoiceDirector] Analyze failed");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── POST /wavespeed/voice-director/preview-audio ──────────────────────────────

/**
 * Generate a real audio preview using WaveSpeed/MiniMax.
 * Submits one minimax/speech-2.6-turbo job per segment (parallel),
 * polls until all complete (≤60 s), downloads, and FFmpeg-concatenates into
 * a single MP3.
 *
 * COSTS WAVESPEED CREDITS — one TTS job per script segment.
 *
 * Body:
 *   {
 *     text:    string               // script to synthesize (≤ 2000 chars)
 *     voiceId: string               // WaveSpeed voice id (cloned voice)
 *     preset?: "natural" | "energetico" | "dramatico"   // default: "natural"
 *   }
 *
 * Returns:
 *   {
 *     preset, segments, ttsScript, summary,
 *     jobs: SegmentJobRecord[],
 *     audioFilename: string | null,   // basename of the /tmp mp3 — use to GET it
 *     allCompleted: boolean,
 *     anyFailed: boolean,
 *     meta: { segmentCount, creditNote }
 *   }
 */
router.post("/wavespeed/voice-director/preview-audio", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  // Guard: WAVESPEED_API_KEY must be configured
  if (!isWavespeedConfigured()) {
    res.status(503).json({
      error:
        "WAVESPEED_API_KEY is not configured. Add it to Replit Secrets to enable the WaveSpeed pipeline.",
    });
    return;
  }

  const {
    text,
    voiceId,
    preset: presetId = "natural",
  } = req.body as {
    text?:    string;
    voiceId?: string;
    preset?:  string;
  };

  // Validation
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Field 'text' is required and must be a non-empty string" });
    return;
  }
  if (text.trim().length > 2000) {
    res.status(400).json({
      error: "Field 'text' must be 2000 characters or fewer for audio preview to avoid long wait times",
    });
    return;
  }
  if (!voiceId || typeof voiceId !== "string" || voiceId.trim().length === 0) {
    res.status(400).json({
      error: "Field 'voiceId' is required — provide the WaveSpeed voice id of a cloned voice",
    });
    return;
  }
  if (!VOICE_DIRECTOR_PRESET_IDS.includes(presetId as VoiceDirectorPresetId)) {
    res.status(400).json({
      error: `Field 'preset' must be one of: ${VOICE_DIRECTOR_PRESET_IDS.join(", ")}`,
    });
    return;
  }

  try {
    const originalScript = text.trim();

    // ── Normalize to spoken audio copy ──────────────────────────────────────
    // Strips emojis, hashtags, markdown, symbols and expands acronyms/currency
    // so the avatar reads natural spoken Spanish instead of written social copy.
    const { spokenScript, issues: normalizeIssues } = prepareForTts(originalScript);

    const analysis = analyzeScriptForWavespeed(spokenScript, presetId as VoiceDirectorPresetId);

    req.log.info(
      { userId, preset: presetId, voiceId, segmentCount: analysis.segments.length, normalizeIssues },
      "[WaveSpeed VoiceDirector] Starting audio preview generation",
    );

    const apiKey = process.env.WAVESPEED_API_KEY!;

    const audioResult = await generateVdAudioPreview({
      segments: analysis.segments,
      voiceId:  voiceId.trim(),
      presetId,
      apiKey,
      userId,
    });

    const audioFilename = audioResult.concatenatedAudioPath
      ? basename(audioResult.concatenatedAudioPath)
      : null;

    req.log.info(
      { userId, preset: presetId, allCompleted: audioResult.allCompleted, anyFailed: audioResult.anyFailed, audioFilename },
      "[WaveSpeed VoiceDirector] Audio preview complete",
    );

    res.json({
      originalScript,
      spokenScript,
      normalizeIssues,
      ...analysis,
      jobs:         audioResult.jobs,
      audioFilename,
      allCompleted: audioResult.allCompleted,
      anyFailed:    audioResult.anyFailed,
      meta: {
        segmentCount: analysis.segments.length,
        creditNote:
          `${analysis.segments.length} minimax/speech-2.6-turbo job(s) submitted. ` +
          "Credits consumed from your WaveSpeed balance.",
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed VoiceDirector] Audio preview failed");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── GET /wavespeed/voice-director/audio/:filename ─────────────────────────────

/**
 * Serve a generated preview MP3 from /tmp/contentpilot-vd-audio/.
 *
 * Auth: session required (checked inline — no requireToolAccess needed
 * since the user already consumed credits in the preview-audio call).
 *
 * The filename contains a UUID — not guessable without a prior API call.
 * Only .mp3 files are served. Path traversal is prevented by basename() check.
 */
// ── POST /wavespeed/voice-director/preview-video ──────────────────────────────

/**
 * Generate a full voice-director video preview (audio + InfiniteTalk).
 * Exclusively WaveSpeed/MiniMax — no HeyGen code touched.
 *
 * Flow:
 *   1. analyzeScriptForWavespeed → segments with per-intent speed/pitch
 *   2. minimax/speech-2.6-turbo per segment → concat MP3
 *   3. Upload MP3 to Object Storage → signed GCS URL
 *   4. wavespeed-ai/infinitetalk-fast (lookImageUrl + audio) → video
 *   5. Poll ≤25 s; return requestId if still processing so caller can check later
 *
 * COSTS WAVESPEED CREDITS — N speech jobs + 1 video job.
 *
 * Body:
 *   {
 *     text:         string   // script (≤ 2000 chars)
 *     voiceId:      string   // WaveSpeed cloned voice id
 *     lookImageUrl: string   // portrait image URL for InfiniteTalk
 *     preset?:      "natural" | "energetico" | "dramatico"  // default: "natural"
 *   }
 *
 * Returns:
 *   {
 *     preset, segments, ttsScript, summary,
 *     audioJobs, audioFilename,
 *     videoRequestId,           // poll this with GET /job/:requestId
 *     videoStatus,              // "queued"|"processing"|"completed"|"failed"|"not_started"
 *     videoUrl,                 // non-null when completed
 *     videoDbJobId,
 *     allAudioCompleted, anyAudioFailed,
 *     meta: { segmentCount, pollUrl, creditNote }
 *   }
 */
router.post("/wavespeed/voice-director/preview-video", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  if (!isWavespeedConfigured()) {
    res.status(503).json({
      error:
        "WAVESPEED_API_KEY is not configured. Add it to Replit Secrets to enable the WaveSpeed pipeline.",
    });
    return;
  }

  const {
    text,
    voiceId,
    lookImageUrl,
    preset: presetId = "natural",
  } = req.body as {
    text?:         string;
    voiceId?:      string;
    lookImageUrl?: string;
    preset?:       string;
  };

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "Field 'text' is required and must be a non-empty string" });
    return;
  }
  if (text.trim().length > 2000) {
    res.status(400).json({ error: "Field 'text' must be 2000 characters or fewer" });
    return;
  }
  if (!voiceId || typeof voiceId !== "string" || voiceId.trim().length === 0) {
    res.status(400).json({ error: "Field 'voiceId' is required — provide a WaveSpeed cloned voice id" });
    return;
  }
  if (!lookImageUrl || typeof lookImageUrl !== "string" || lookImageUrl.trim().length === 0) {
    res.status(400).json({ error: "Field 'lookImageUrl' is required — provide a portrait image URL" });
    return;
  }
  if (!VOICE_DIRECTOR_PRESET_IDS.includes(presetId as VoiceDirectorPresetId)) {
    res.status(400).json({
      error: `Field 'preset' must be one of: ${VOICE_DIRECTOR_PRESET_IDS.join(", ")}`,
    });
    return;
  }

  try {
    const originalScript = text.trim();

    // ── Normalize to spoken audio copy ──────────────────────────────────────
    const { spokenScript, issues: normalizeIssues } = prepareForTts(originalScript);

    req.log.info(
      { userId, preset: presetId, voiceId, lookImageUrl, normalizeIssues },
      "[WaveSpeed VoiceDirector] Starting video preview generation",
    );

    const result = await generateVdVideoPreview({
      text:         spokenScript,
      voiceId:      voiceId.trim(),
      lookImageUrl: lookImageUrl.trim(),
      presetId:     presetId as VoiceDirectorPresetId,
      apiKey:       process.env.WAVESPEED_API_KEY!,
      userId,
    });

    req.log.info(
      { userId, videoRequestId: result.videoRequestId, videoStatus: result.videoStatus, allAudioOk: result.allAudioCompleted },
      "[WaveSpeed VoiceDirector] Video preview request complete",
    );

    const segmentCount = result.segments.length;

    res.json({
      originalScript,
      spokenScript,
      normalizeIssues,
      ...result,
      meta: {
        segmentCount,
        pollUrl: result.videoRequestId
          ? `/api/wavespeed/voice-director/job/${result.videoRequestId}`
          : null,
        creditNote:
          `${segmentCount} minimax/speech-2.6-turbo job(s) + ` +
          (result.videoRequestId ? "1 wavespeed-ai/infinitetalk-fast job submitted." : "0 video jobs (audio failed).") +
          " Credits consumed from your WaveSpeed balance.",
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "[WaveSpeed VoiceDirector] Video preview failed");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── GET /wavespeed/voice-director/job/:requestId ──────────────────────────────

/**
 * Check the current status of any WaveSpeed job by its requestId.
 * Use this to poll a preview-video job that returned status="processing".
 *
 * Does NOT resubmit anything — read-only status check.
 * Requires auth + requireToolAccess (applied at mount).
 *
 * Returns:
 *   {
 *     requestId: string;
 *     status: "queued" | "processing" | "completed" | "failed";
 *     videoUrl: string | null;
 *     error: string | null;
 *   }
 */
router.get("/wavespeed/voice-director/job/:requestId", async (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  if (!isWavespeedConfigured()) {
    res.status(503).json({ error: "WAVESPEED_API_KEY is not configured" });
    return;
  }

  const { requestId } = req.params;
  if (!requestId || typeof requestId !== "string" || requestId.trim().length === 0) {
    res.status(400).json({ error: "requestId path parameter is required" });
    return;
  }

  try {
    const result = await getJobStatus(requestId.trim(), process.env.WAVESPEED_API_KEY!);

    // Extract URL — works for both audio and video outputs
    const outputUrl: string | null = (() => {
      if (!result.outputs) return null;
      if (Array.isArray(result.outputs)) {
        const first = (result.outputs as unknown[])[0];
        return typeof first === "string" ? first : null;
      }
      const obj = result.outputs as Record<string, unknown>;
      const url = obj["video_url"] ?? obj["audio_url"] ?? obj["video"] ?? obj["audio"] ?? obj["url"];
      return typeof url === "string" ? url : null;
    })();

    res.json({
      requestId,
      status:   result.status,
      outputUrl,
      error:    result.error ?? null,
    });
  } catch (err: any) {
    req.log.error({ err, requestId }, "[WaveSpeed VoiceDirector] Job status check failed");
    res.status(500).json({ error: err.message ?? "Internal error" });
  }
});

// ── GET /wavespeed/voice-director/audio/:filename ─────────────────────────────

router.get("/wavespeed/voice-director/audio/:filename", (req: Request, res: Response) => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const rawParam = req.params.filename;
  const raw      = (Array.isArray(rawParam) ? rawParam[0] : rawParam) ?? "";
  const filename = basename(raw); // strip any path components

  // Only serve .mp3 files with UUID-style names (prevent path traversal and type confusion)
  if (
    !filename.endsWith(".mp3") ||
    filename.includes("..") ||
    !/^[a-z0-9-]+\.mp3$/i.test(filename)
  ) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }

  const fullPath = `${VD_AUDIO_DIR}/${filename}`;
  if (!existsSync(fullPath)) {
    res.status(404).json({ error: "Audio file not found or has expired" });
    return;
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, max-age=300"); // 5-min browser cache
  createReadStream(fullPath).pipe(res);
});

export default router;
