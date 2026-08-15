/**
 * WaveSpeed Voice Director — video preview generation engine
 *
 * PURPOSE
 * -------
 * Generates a preview video by chaining:
 *   1. Expressive audio via analyzeScriptForWavespeed + generateVdAudioPreview
 *      (minimax/speech-2.6-turbo, per-segment speed/pitch, FFmpeg concat)
 *   2. Upload of the concatenated MP3 to Object Storage (signed GET URL
 *      for WaveSpeed to download — bypasses the mTLS proxy)
 *   3. Talking-head video via wavespeed-ai/infinitetalk-fast
 *      (look image + audio → lip-synced vertical presenter video)
 *
 * SCOPE
 * -----
 * Exclusively for WaveSpeed/MiniMax/InfiniteTalk.
 * ZERO imports from or modifications to HeyGen modules.
 * HeyGen voice generation, SSML, resolveVoiceId, generateVideo, and the
 * scheduler's HeyGen pipeline remain completely untouched.
 *
 * The generated video is NOT connected to the existing videos table or the
 * content-plan pipeline — it is a standalone preview only.
 *
 * PURE vs I/O split
 * -----------------
 * buildInfiniteTalkPrompt, buildVideoJobInputPayload — pure (unit-testable).
 * uploadAudioForWavespeed, generateVdVideoPreview — I/O.
 */

import { readFile }                from "node:fs/promises";
import { randomUUID }              from "node:crypto";
import { basename }                from "node:path";

import { eq }                      from "drizzle-orm";
import { db }                      from "@workspace/db";
import { wavespeedJobsTable }       from "@workspace/db/schema";

import {
  objectStorageClient,
  getSignedObjectUrl,
}                                  from "./objectStorage.js";
import {
  submitTalkingHead,
  getJobStatus,
  WAVESPEED_MODELS,
  type WavespeedJobResult,
}                                  from "./wavespeed.js";
import {
  analyzeScriptForWavespeed,
  type WavespeedVoiceSegment,
}                                  from "./wavespeed-voice-director.js";
import {
  generateVdAudioPreview,
  type SegmentJobRecord,
}                                  from "./wavespeed-voice-director-audio.js";
import type { VoiceDirectorPresetId } from "./wavespeed.js";

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * GCS object prefix for uploaded audio previews.
 * Files are auto-named with a UUID so they are unguessable.
 */
const GCS_AUDIO_PREFIX = "vd-audio-previews";

/**
 * How long the signed GET URL remains valid.
 * WaveSpeed downloads the file shortly after submission; 2 h is ample.
 */
const AUDIO_SIGNED_URL_TTL_SEC = 2 * 3600;

/**
 * How long to poll InfiniteTalk before returning "still processing".
 * Audio generation already consumes ≤60 s; this leaves headroom before
 * the HTTP proxy times out (~90 s total).
 */
const VIDEO_POLL_TIMEOUT_MS = 25_000;

/** InfiniteTalk polling intervals (ms). Sum ≈ 22 s. */
const VIDEO_POLL_INTERVALS_MS = [2000, 3000, 3000, 4000, 5000, 5000];

// ── Result type ────────────────────────────────────────────────────────────────

export interface VdVideoPreviewResult {
  /** Ordered segments from the Voice Director analysis */
  segments: WavespeedVoiceSegment[];
  /** Per-segment TTS speech jobs */
  audioJobs: SegmentJobRecord[];
  /** Basename of the local MP3 (served from /tmp via GET audio route) */
  audioFilename: string | null;
  /** Signed GCS URL used as the `audio` input to InfiniteTalk */
  audioSignedUrl: string | null;
  /** WaveSpeed requestId for the InfiniteTalk video job */
  videoRequestId: string | null;
  /** Current status of the InfiniteTalk job */
  videoStatus: "queued" | "processing" | "completed" | "failed" | "not_started";
  /** Output video URL — only present when status is "completed" */
  videoUrl: string | null;
  /** wavespeed_jobs row id for the video job, or null if insert failed */
  videoDbJobId: number | null;
  videoErrorMessage: string | null;
  allAudioCompleted: boolean;
  anyAudioFailed: boolean;
}

// ── Pure functions (unit-testable) ─────────────────────────────────────────────

/**
 * Build the motion prompt for InfiniteTalk that produces a natural,
 * conservative vertical presenter video without extreme movements.
 *
 * Kept intentionally brief — the model reads it as a style directive,
 * not a script.
 */
export function buildInfiniteTalkPrompt(): string {
  return (
    "Natural Spanish-speaking presenter, realistic lip sync, " +
    "subtle asymmetric hand gestures, confident and human delivery, " +
    "slight natural head movement, no extreme movement or unnatural poses, " +
    "professional content creator speaking directly to camera, " +
    "vertical 9:16 framing."
  );
}

/**
 * Build the metadata object stored in wavespeed_jobs.inputPayload
 * for the InfiniteTalk video preview job.
 * Pure: no I/O.
 */
export function buildVideoJobInputPayload(opts: {
  lookImageUrl: string;
  audioSignedUrl: string;
  presetId: string;
  voiceId: string;
  segmentCount: number;
  userId: number;
}): string {
  return JSON.stringify({
    source:        "voice_director_video_preview",
    model:         WAVESPEED_MODELS.TALKING_HEAD,
    lookImageUrl:  opts.lookImageUrl,
    audioSignedUrl: opts.audioSignedUrl,
    presetId:      opts.presetId,
    voiceId:       opts.voiceId,
    segmentCount:  opts.segmentCount,
    userId:        opts.userId,
  });
}

/**
 * Extract the video URL from a WaveSpeed InfiniteTalk job result.
 * Handles both string[] outputs and object shapes.
 * Pure: no I/O.
 */
export function extractVideoUrl(outputs: unknown): string | null {
  if (!outputs) return null;
  if (Array.isArray(outputs)) {
    const first = (outputs as unknown[])[0];
    return typeof first === "string" ? first : null;
  }
  const obj = outputs as Record<string, unknown>;
  const url = obj["video_url"] ?? obj["video"] ?? obj["url"];
  return typeof url === "string" ? url : null;
}

// ── I/O helpers ────────────────────────────────────────────────────────────────

/**
 * Upload a local audio file to GCS and return a short-lived signed GET URL.
 *
 * The signed URL is valid for AUDIO_SIGNED_URL_TTL_SEC (2 h) — long enough
 * for WaveSpeed to download the file, short enough to limit exposure.
 *
 * Requires DEFAULT_OBJECT_STORAGE_BUCKET_ID to be set.
 *
 * @param localPath  Absolute path to the local MP3 file
 * @param userId     Used in the object name for traceability
 */
export async function uploadAudioForWavespeed(
  localPath: string,
  userId: number,
): Promise<string> {
  const bucketName = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketName) {
    throw new Error(
      "DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set — cannot upload audio to Object Storage",
    );
  }

  const objectName = `${GCS_AUDIO_PREFIX}/user_${userId}_${randomUUID()}.mp3`;
  const buffer     = await readFile(localPath);

  const bucket = objectStorageClient.bucket(bucketName);
  await bucket.file(objectName).save(buffer, { contentType: "audio/mpeg" });

  return getSignedObjectUrl(objectName, AUDIO_SIGNED_URL_TTL_SEC);
}

// ── InfiniteTalk polling ───────────────────────────────────────────────────────

/**
 * Poll an InfiniteTalk job for up to VIDEO_POLL_TIMEOUT_MS.
 * Returns the final result, or the last seen result if still processing
 * when the timeout expires.
 *
 * No automatic resubmission on failure — per spec.
 */
async function pollVideoJob(
  requestId: string,
  apiKey: string,
): Promise<WavespeedJobResult> {
  let lastResult: WavespeedJobResult = { id: requestId, status: "processing" };

  for (const interval of VIDEO_POLL_INTERVALS_MS) {
    await new Promise((r) => setTimeout(r, interval));

    try {
      const result = await getJobStatus(requestId, apiKey);
      lastResult = result;
      if (result.status === "completed" || result.status === "failed") {
        return result;
      }
    } catch {
      // Network hiccup — keep last known status and try next interval
    }
  }

  return lastResult; // Still processing after timeout
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Generate a Voice Director video preview using InfiniteTalk.
 *
 * Full flow (all WaveSpeed/MiniMax — no HeyGen):
 *   1. analyzeScriptForWavespeed(text, preset) → segments
 *   2. generateVdAudioPreview() → concatenated MP3 (minimax/speech-2.6-turbo)
 *   3. uploadAudioForWavespeed() → signed GCS URL
 *   4. submitTalkingHead(lookImageUrl, signedAudioUrl) → InfiniteTalk requestId
 *   5. Save to wavespeed_jobs with source="voice_director_video_preview"
 *   6. Poll ≤VIDEO_POLL_TIMEOUT_MS → return result (or requestId if still processing)
 *
 * Throws immediately with a clear message if WAVESPEED_API_KEY is missing.
 *
 * @param text          Script text to analyze and synthesize
 * @param voiceId       WaveSpeed cloned voice id
 * @param lookImageUrl  Portrait image URL for InfiniteTalk
 * @param presetId      Voice Director preset
 * @param apiKey        Resolved WAVESPEED_API_KEY
 * @param userId        DB user id (for wavespeed_jobs records)
 */
export async function generateVdVideoPreview(opts: {
  text: string;
  voiceId: string;
  lookImageUrl: string;
  presetId: VoiceDirectorPresetId;
  apiKey: string;
  userId: number;
}): Promise<VdVideoPreviewResult> {
  const { text, voiceId, lookImageUrl, presetId, apiKey, userId } = opts;

  // ── 1. Analyze script ──────────────────────────────────────────────────────
  const analysis = analyzeScriptForWavespeed(text, presetId);

  // ── 2. Generate expressive audio (minimax/speech-2.6-turbo per segment) ───
  const audioResult = await generateVdAudioPreview({
    segments: analysis.segments,
    voiceId,
    presetId,
    apiKey,
    userId,
  });

  const audioFilename = audioResult.concatenatedAudioPath
    ? basename(audioResult.concatenatedAudioPath)
    : null;

  const baseResult: Omit<
    VdVideoPreviewResult,
    "audioSignedUrl" | "videoRequestId" | "videoStatus" | "videoUrl" | "videoDbJobId" | "videoErrorMessage"
  > = {
    segments:          analysis.segments,
    audioJobs:         audioResult.jobs,
    audioFilename,
    allAudioCompleted: audioResult.allCompleted,
    anyAudioFailed:    audioResult.anyFailed,
  };

  // ── 3. Abort if no audio was produced ─────────────────────────────────────
  if (!audioResult.concatenatedAudioPath) {
    return {
      ...baseResult,
      audioSignedUrl:    null,
      videoRequestId:    null,
      videoStatus:       "not_started",
      videoUrl:          null,
      videoDbJobId:      null,
      videoErrorMessage: "Audio generation failed or timed out — cannot proceed to video",
    };
  }

  // ── 4. Upload MP3 to Object Storage ───────────────────────────────────────
  let audioSignedUrl: string;
  try {
    audioSignedUrl = await uploadAudioForWavespeed(audioResult.concatenatedAudioPath, userId);
  } catch (err: any) {
    return {
      ...baseResult,
      audioSignedUrl:    null,
      videoRequestId:    null,
      videoStatus:       "not_started",
      videoUrl:          null,
      videoDbJobId:      null,
      videoErrorMessage: `Audio upload failed: ${err.message ?? "Unknown error"}`,
    };
  }

  // ── 5. Submit InfiniteTalk ─────────────────────────────────────────────────
  let videoRequestId: string;
  try {
    const { requestId } = await submitTalkingHead(
      lookImageUrl,
      audioSignedUrl,
      { prompt: buildInfiniteTalkPrompt() },
      apiKey,
    );
    videoRequestId = requestId;
  } catch (err: any) {
    return {
      ...baseResult,
      audioSignedUrl,
      videoRequestId:    null,
      videoStatus:       "not_started",
      videoUrl:          null,
      videoDbJobId:      null,
      videoErrorMessage: `InfiniteTalk submission failed: ${err.message ?? "Unknown error"}`,
    };
  }

  // ── 6. Persist to wavespeed_jobs ───────────────────────────────────────────
  let videoDbJobId: number | null = null;
  try {
    const [row] = await db
      .insert(wavespeedJobsTable)
      .values({
        userId,
        model:              WAVESPEED_MODELS.TALKING_HEAD,
        status:             "queued",
        wavespeedRequestId: videoRequestId,
        inputPayload:       buildVideoJobInputPayload({
          lookImageUrl,
          audioSignedUrl,
          presetId,
          voiceId,
          segmentCount: analysis.segments.length,
          userId,
        }),
      })
      .returning({ id: wavespeedJobsTable.id });
    videoDbJobId = row?.id ?? null;
  } catch {
    // Non-fatal — preview works without the DB row
  }

  // ── 7. Poll (short window — return requestId if still processing) ──────────
  const pollResult = await pollVideoJob(videoRequestId, apiKey);

  const videoStatus = (
    pollResult.status === "completed" ||
    pollResult.status === "failed" ||
    pollResult.status === "queued" ||
    pollResult.status === "processing"
      ? pollResult.status
      : "processing"
  ) as VdVideoPreviewResult["videoStatus"];

  const videoUrl = pollResult.status === "completed"
    ? (extractVideoUrl(pollResult.outputs) ?? null)
    : null;

  // ── 8. Update DB row with final status (best-effort) ──────────────────────
  if (videoDbJobId || videoRequestId) {
    try {
      await db
        .update(wavespeedJobsTable)
        .set({
          status:        pollResult.status === "processing" || pollResult.status === "queued"
                           ? "processing"
                           : pollResult.status,
          outputUrl:     videoUrl ?? undefined,
          outputPayload: pollResult.outputs ? JSON.stringify(pollResult.outputs) : undefined,
          errorMessage:  pollResult.error ?? undefined,
          updatedAt:     new Date(),
        })
        .where(eq(wavespeedJobsTable.wavespeedRequestId, videoRequestId));
    } catch { /* non-fatal */ }
  }

  return {
    ...baseResult,
    audioSignedUrl,
    videoRequestId,
    videoStatus,
    videoUrl,
    videoDbJobId,
    videoErrorMessage: pollResult.error ?? null,
  };
}
