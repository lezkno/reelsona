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
 *   3. Talking-head video via alibaba/wan-3.0/reference-to-video (default:
 *      look image + ≤10 s voice reference + dialogue, one job per ≤36-word
 *      segment, joined with FFmpeg) or wavespeed-ai/infinitetalk (fallback /
 *      WAVESPEED_TALKING_MODEL=infinitetalk: look image + audio → video)
 *
 * SCOPE
 * -----
 * Exclusively for WaveSpeed/MiniMax/WAN 3.0/InfiniteTalk.
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

import { readFile, rm }            from "node:fs/promises";
import { randomUUID, createHash }  from "node:crypto";
import { basename }                from "node:path";

import { inArray }                 from "drizzle-orm";
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
import {
  isWan3Enabled,
  isWavespeedRejection,
  splitScriptIntoWan3Segments,
  submitWan3Segments,
  prepareSegmentVoiceReferences,
  trimAudioToFile,
  concatWan3Clips,
}                                  from "./wan3-talking.js";

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * GCS object prefix for uploaded audio previews.
 * Files are auto-named with a UUID so they are unguessable.
 */
const GCS_AUDIO_PREFIX = "vd-audio-previews";

/** GCS object prefix for joined multi-segment WAN 3.0 preview videos. */
const GCS_VIDEO_PREFIX = "vd-video-previews";

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
  /**
   * WaveSpeed requestId of the video job. For a multi-segment WAN 3.0 video
   * the ids are comma-separated; GET /job/:requestId accepts the same string.
   */
  videoRequestId: string | null;
  /** Current status of the video job(s) */
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
  model?: string;
  lookImageUrl: string;
  audioSignedUrl: string;
  presetId: string;
  voiceId: string;
  segmentCount: number;
  userId: number;
}): string {
  return JSON.stringify({
    source:        "voice_director_video_preview",
    model:         opts.model ?? WAVESPEED_MODELS.TALKING_HEAD,
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

// ── Video job polling ──────────────────────────────────────────────────────────

/**
 * Combined status of one or more video jobs (comma-separated ids):
 * failed if any failed, completed only when all completed (outputs = the
 * clip URLs in order), otherwise processing.
 */
export async function getVideoJobsStatus(
  requestIds: string,
  apiKey: string,
): Promise<WavespeedJobResult> {
  const ids = requestIds.split(",").map((id) => id.trim()).filter(Boolean);
  const results = await Promise.all(ids.map((id) => getJobStatus(id, apiKey)));
  const failed = results.find((r) => r.status === "failed");
  if (failed) return { ...failed, id: requestIds };
  if (results.every((r) => r.status === "completed")) {
    const urls = results.map((r) => extractVideoUrl(r.outputs));
    if (urls.some((u) => !u)) {
      return { id: requestIds, status: "failed", error: "Video job completed without an output URL" };
    }
    return { id: requestIds, status: "completed", outputs: urls };
  }
  return { id: requestIds, status: results.some((r) => r.status === "processing") ? "processing" : "queued" };
}

/**
 * Final playable URL for completed video jobs. A single clip is returned as
 * is; several WAN 3.0 segments are joined once, stored in Object Storage
 * under a name derived from the ids, and returned as a signed URL.
 */
export async function resolveVideoJobsUrl(
  requestIds: string,
  clipUrls: string[],
): Promise<string> {
  if (clipUrls.length === 1) return clipUrls[0]!;

  const bucketName = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketName) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set — cannot join video segments");
  const hash = createHash("sha1").update(requestIds).digest("hex").slice(0, 24);
  const objectName = `${GCS_VIDEO_PREFIX}/${hash}.mp4`;
  const file = objectStorageClient.bucket(bucketName).file(objectName);

  const [exists] = await file.exists();
  if (!exists) {
    const tmpPath = `/tmp/vd-wan3-${hash}-${randomUUID()}.mp4`;
    try {
      await concatWan3Clips(clipUrls, tmpPath);
      await file.save(await readFile(tmpPath), { contentType: "video/mp4" });
    } finally {
      await rm(tmpPath, { force: true });
    }
  }
  return getSignedObjectUrl(objectName, 24 * 3600);
}

/**
 * Poll the video job(s) for up to VIDEO_POLL_TIMEOUT_MS.
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
      const result = await getVideoJobsStatus(requestId, apiKey);
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

/**
 * WAN generates the speech itself, so the preset's per-segment speed/pitch
 * cannot be replayed from the TTS audio; describe the intended delivery in
 * the prompt instead (the ≤10 s reference still carries the cloned voice).
 */
const WAN3_PRESET_DELIVERY: Record<VoiceDirectorPresetId, string> = {
  natural:    "calm, natural and conversational, like talking to a friend.",
  energetico: "high-energy, upbeat and enthusiastic, with a lively pace and emphatic key words.",
  dramatico:  "dramatic and intense, with deliberate pauses before key ideas and strong emphasis.",
};

type VdWan3Outcome =
  | { kind: "submitted"; requestIds: string }
  /** WaveSpeed definitively refused the first request: nothing was created or billed. */
  | { kind: "rejected"; error: string }
  /** Ambiguous (timeout / 5xx) or partial: a billed job may exist — never submit another video. */
  | { kind: "failed"; error: string };

/**
 * Submit the WAN 3.0 segments for a preview and persist each accepted job.
 * Only a definitive rejection lets the caller fall back to InfiniteTalk.
 */
async function submitVdWan3(opts: {
  text: string;
  lookImageUrl: string;
  audioPath: string;
  audioSignedUrl: string;
  presetId: VoiceDirectorPresetId;
  voiceId: string;
  apiKey: string;
  userId: number;
}): Promise<VdWan3Outcome> {
  const segments = splitScriptIntoWan3Segments(opts.text);
  if (segments.length === 0) return { kind: "rejected", error: "Empty script" };

  // ≤10 s voice reference (WaveSpeed recommends 3–10 s); full audio on failure.
  let voiceReferenceUrl = opts.audioSignedUrl;
  const refPath = `/tmp/vd-wan3-voice-${randomUUID()}.mp3`;
  try {
    await trimAudioToFile(opts.audioPath, refPath);
    voiceReferenceUrl = await uploadAudioForWavespeed(refPath, opts.userId);
  } catch {
    // keep the full audio as reference
  } finally {
    await rm(refPath, { force: true });
  }

  // One reference per segment (the audio slice saying that segment's words).
  const voiceReferenceUrls = await prepareSegmentVoiceReferences({
    audioSource: opts.audioPath,
    segments,
    fallbackUrl: voiceReferenceUrl,
    upload: (localPath) => uploadAudioForWavespeed(localPath, opts.userId),
  });

  const { requestIds, error } = await submitWan3Segments({
    imageUrl: opts.lookImageUrl,
    voiceReferenceUrl,
    voiceReferenceUrls: voiceReferenceUrls ?? undefined,
    segments,
    delivery: WAN3_PRESET_DELIVERY[opts.presetId],
    apiKey: opts.apiKey,
    onAccepted: async (requestId) => {
      try {
        await db.insert(wavespeedJobsTable).values({
          userId:             opts.userId,
          model:              WAVESPEED_MODELS.WAN3_TALKING,
          status:             "queued",
          wavespeedRequestId: requestId,
          inputPayload:       buildVideoJobInputPayload({
            model:          WAVESPEED_MODELS.WAN3_TALKING,
            lookImageUrl:   opts.lookImageUrl,
            audioSignedUrl: voiceReferenceUrl,
            presetId:       opts.presetId,
            voiceId:        opts.voiceId,
            segmentCount:   segments.length,
            userId:         opts.userId,
          }),
        });
      } catch { /* non-fatal — preview works without the DB row */ }
    },
  });

  if (!error) return { kind: "submitted", requestIds: requestIds.join(",") };
  if (requestIds.length === 0 && isWavespeedRejection(error)) {
    return { kind: "rejected", error: error.message };
  }
  return {
    kind: "failed",
    error: requestIds.length > 0
      ? `WAN 3.0 accepted ${requestIds.length}/${segments.length} segments: ${error.message}`
      : `WAN 3.0 submission could not be confirmed (not retried to avoid a duplicate charge): ${error.message}`,
  };
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Generate a Voice Director video preview using WAN 3.0 (InfiniteTalk fallback).
 *
 * Full flow (all WaveSpeed/MiniMax — no HeyGen):
 *   1. analyzeScriptForWavespeed(text, preset) → segments
 *   2. generateVdAudioPreview() → concatenated MP3 (minimax/speech-2.6-turbo)
 *   3. uploadAudioForWavespeed() → signed GCS URL
 *   4. WAN 3.0 segments (look + ≤10 s voice reference + dialogue) → requestIds,
 *      or submitTalkingHead(lookImageUrl, signedAudioUrl) → InfiniteTalk requestId
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

  // ── 5. Submit WAN 3.0 (default) or InfiniteTalk (fallback) ─────────────────
  let videoRequestId: string | null = null;
  let videoDbJobId: number | null = null;
  if (isWan3Enabled()) {
    const wan = await submitVdWan3({
      text,
      lookImageUrl,
      audioPath: audioResult.concatenatedAudioPath,
      audioSignedUrl,
      presetId,
      voiceId,
      apiKey,
      userId,
    });
    if (wan.kind === "submitted") {
      videoRequestId = wan.requestIds;
    } else if (wan.kind === "failed") {
      // A billed WAN job may exist: never add an InfiniteTalk job on top.
      return {
        ...baseResult,
        audioSignedUrl,
        videoRequestId:    null,
        videoStatus:       "failed",
        videoUrl:          null,
        videoDbJobId:      null,
        videoErrorMessage: wan.error,
      };
    }
    // "rejected" → nothing was created; fall back to InfiniteTalk below.
  }

  if (!videoRequestId) {
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

    // ── 6. Persist to wavespeed_jobs ─────────────────────────────────────────
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
  }

  // ── 7. Poll (short window — return requestId if still processing) ──────────
  const pollResult = await pollVideoJob(videoRequestId, apiKey);

  let videoUrl: string | null = null;
  let joinPending = false;
  if (pollResult.status === "completed" && Array.isArray(pollResult.outputs)) {
    try {
      videoUrl = await resolveVideoJobsUrl(videoRequestId, pollResult.outputs as string[]);
    } catch {
      // Joining failed (transient download/storage error). Report the preview
      // as still processing so the client keeps polling GET /job/:requestId,
      // which retries the join — "completed" always carries a playable URL.
      joinPending = true;
    }
  }

  const videoStatus = (
    joinPending
      ? "processing"
      : pollResult.status === "completed" ||
        pollResult.status === "failed" ||
        pollResult.status === "queued" ||
        pollResult.status === "processing"
        ? pollResult.status
        : "processing"
  ) as VdVideoPreviewResult["videoStatus"];

  // ── 8. Update DB row with final status (best-effort) ──────────────────────
  if (videoDbJobId || videoRequestId) {
    try {
      await db
        .update(wavespeedJobsTable)
        .set({
          status:        videoStatus === "processing" || videoStatus === "queued"
                           ? "processing"
                           : videoStatus,
          outputUrl:     videoUrl ?? undefined,
          outputPayload: pollResult.outputs ? JSON.stringify(pollResult.outputs) : undefined,
          errorMessage:  pollResult.error ?? undefined,
          updatedAt:     new Date(),
        })
        .where(inArray(wavespeedJobsTable.wavespeedRequestId, videoRequestId.split(",")));
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
