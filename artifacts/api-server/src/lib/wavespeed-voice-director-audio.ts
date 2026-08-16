/**
 * WaveSpeed / MiniMax Voice Director — audio generation engine
 *
 * PURPOSE
 * -------
 * Generates expressive audio previews by:
 *   1. Receiving pre-analysed WavespeedVoiceSegment[] from analyzeScriptForWavespeed()
 *   2. Submitting one minimax/speech-2.6-turbo job per segment (in parallel)
 *      with per-segment speed/pitch/language_boost params
 *   3. Polling until all jobs complete or the timeout expires
 *   4. Downloading audio files to /tmp
 *   5. Concatenating them with FFmpeg, inserting silence via `apad` between segments
 *   6. Saving job metadata to wavespeed_jobs
 *
 * SCOPE
 * -----
 * Exclusively for WaveSpeed/MiniMax audio. No imports from or references to
 * HeyGen modules. HeyGen voice generation, SSML, resolveVoiceId, generateVideo,
 * and the scheduler's HeyGen pipeline are completely unchanged and untouched.
 *
 * PURE vs I/O split
 * -----------------
 * buildSpeechInputs, extractAudioUrl, buildConcatFilterComplex — pure (unit-testable).
 * All other functions touch the network, filesystem, DB, or FFmpeg.
 */

import { execFile }        from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm }       from "node:fs/promises";
import { promisify }       from "node:util";
import { join }            from "node:path";
import { randomUUID }      from "node:crypto";
import { pipeline }        from "node:stream/promises";
import { Readable }        from "node:stream";

import { eq }              from "drizzle-orm";
import { db }              from "@workspace/db";
import { wavespeedJobsTable } from "@workspace/db/schema";

import {
  submitJob,
  getJobStatus,
  WAVESPEED_MODELS,
  type WavespeedJobResult,
} from "./wavespeed.js";
import type {
  WavespeedVoiceSegment,
  WavespeedSegmentParams,
  SegmentIntent,
} from "./wavespeed-voice-director.js";
import type { VoiceDirectorPreset } from "./wavespeed.js";

const execFileAsync = promisify(execFile);

// ── Constants ──────────────────────────────────────────────────────────────────

/** Temporary directory for generated audio preview files */
export const VD_AUDIO_DIR = "/tmp/contentpilot-vd-audio";

/**
 * Maximum time (ms) to wait for ALL speech jobs to complete.
 * Must stay well under the HTTP proxy timeout (~90 s).
 */
export const POLL_TIMEOUT_MS = 60_000;

/** Polling back-off intervals in ms. Sum ≈ 42 s — leaves headroom under 60 s. */
const POLL_INTERVALS_MS = [2000, 2000, 3000, 3000, 5000, 5000, 5000, 5000, 6000, 6000];

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SegmentJobRecord {
  segmentIndex: number;
  intent: SegmentIntent;
  text: string;
  params: WavespeedSegmentParams;
  requestId: string;
  status: "queued" | "processing" | "completed" | "failed" | "timeout";
  audioUrl: string | null;
  /** Row id in wavespeed_jobs, or null if the insert failed */
  dbJobId: number | null;
  errorMessage: string | null;
}

export interface VdAudioPreviewResult {
  jobs: SegmentJobRecord[];
  /**
   * Absolute path of the concatenated .mp3 file under VD_AUDIO_DIR.
   * Null if no segment completed or FFmpeg concat failed.
   */
  concatenatedAudioPath: string | null;
  allCompleted: boolean;
  anyFailed: boolean;
}

// ── Pure functions (unit-testable, no I/O) ─────────────────────────────────────

/**
 * Build the WaveSpeed API inputs object for a single speech segment.
 *
 * • Always sends language_boost so MiniMax applies the correct acoustic model.
 * • Omits speed when it is exactly 1.0 (neutral default) to keep payload minimal.
 * • Forwards emotion directly to the MiniMax API for expressive delivery.
 *   Valid values: "neutral" | "happy" | "sad" | "angry" | "fearful" | "surprised"
 * • Pitch is never sent — pitch shift distorts cloned voice identity.
 */
export function buildSpeechInputs(
  text: string,
  voiceId: string,
  params: WavespeedSegmentParams,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {
    text,
    voice_id: voiceId,
    language_boost: params.languageBoost, // "Spanish"
    emotion: "happy",                     // tono alegre fijo en toda la síntesis
  };
  if (params.speed !== 1.0) inputs.speed = parseFloat(params.speed.toFixed(2));
  return inputs;
}

/**
 * Extract the audio URL from a WaveSpeed job result's `outputs` field.
 *
 * WaveSpeed returns outputs as either:
 *   • string[]                    → first element is the URL
 *   • { audio_url | audio | url } → one of those string fields
 *
 * Returns null for any other shape or missing/falsy input.
 */
export function extractAudioUrl(outputs: unknown): string | null {
  if (!outputs) return null;
  if (Array.isArray(outputs)) {
    const first = (outputs as unknown[])[0];
    return typeof first === "string" ? first : null;
  }
  const obj = outputs as Record<string, unknown>;
  const url = obj["audio_url"] ?? obj["audio"] ?? obj["url"];
  return typeof url === "string" ? url : null;
}

/**
 * Build the FFmpeg -filter_complex string to concatenate N audio segments,
 * resampling each to 44100 Hz and appending per-segment silence via `apad`.
 *
 * Returns null for ≤ 1 segment — no concatenation is needed in that case.
 *
 * @param segmentCount  Number of input audio streams
 * @param pauseAfterSec Per-segment pause duration (seconds).
 *                      pauseAfterSec[i] is the silence added AFTER segment i.
 *
 * Example output for 3 segments with pauses [0.4, 0.3, 0]:
 *   "[0:a]aresample=44100,apad=pad_dur=0.4[a0];
 *    [1:a]aresample=44100,apad=pad_dur=0.3[a1];
 *    [2:a]aresample=44100[a2];
 *    [a0][a1][a2]concat=n=3:v=0:a=1[out]"
 */
export function buildConcatFilterComplex(
  segmentCount: number,
  pauseAfterSec: number[],
): string | null {
  if (segmentCount <= 1) return null;

  const parts: string[] = [];
  const labels: string[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const label = `a${i}`;
    labels.push(`[${label}]`);
    const pause = pauseAfterSec[i] ?? 0;
    if (pause > 0) {
      parts.push(`[${i}:a]aresample=44100,apad=pad_dur=${pause}[${label}]`);
    } else {
      parts.push(`[${i}:a]aresample=44100[${label}]`);
    }
  }

  parts.push(`${labels.join("")}concat=n=${segmentCount}:v=0:a=1[out]`);
  return parts.join(";");
}

// ── I/O helpers ────────────────────────────────────────────────────────────────

/** Ensure the temporary audio directory exists (idempotent). */
async function ensureAudioDir(): Promise<void> {
  await mkdir(VD_AUDIO_DIR, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download a remote URL to a local file path.
 * Throws if the HTTP response is not 2xx.
 */
export async function downloadToTmp(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download audio (HTTP ${res.status}): ${url}`);
  }
  const writer = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), writer);
}

/**
 * Concatenate ordered audio files into a single 128 kbps stereo MP3.
 * Inserts silence via FFmpeg `apad` according to pauseAfterSec.
 *
 * For a single file, just re-encodes to ensure a consistent MP3 format.
 */
export async function concatAudioWithFfmpeg(
  inputPaths: string[],
  pauseAfterSec: number[],
  outputPath: string,
): Promise<void> {
  if (inputPaths.length === 0) throw new Error("No audio files to concatenate");

  if (inputPaths.length === 1) {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inputPaths[0],
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-ac", "2",
      outputPath,
    ]);
    return;
  }

  const filterComplex = buildConcatFilterComplex(inputPaths.length, pauseAfterSec);
  if (!filterComplex) {
    throw new Error("buildConcatFilterComplex returned null for multi-segment input");
  }

  const inputArgs: string[] = [];
  for (const p of inputPaths) inputArgs.push("-i", p);

  await execFileAsync("ffmpeg", [
    "-y",
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    "-ac", "2",
    outputPath,
  ]);
}

// ── Job submission ─────────────────────────────────────────────────────────────

/**
 * Submit a single speech job for one Voice Director segment.
 * Saves a "queued" row to wavespeed_jobs (best-effort) and returns a job record.
 * Does NOT poll — caller handles polling.
 */
async function submitSegmentJob(
  segment: WavespeedVoiceSegment,
  segmentIndex: number,
  voiceId: string,
  presetId: string,
  apiKey: string,
  userId: number,
): Promise<SegmentJobRecord> {
  const inputs = buildSpeechInputs(segment.text, voiceId, segment.params);

  let requestId: string;
  try {
    const result = await submitJob(WAVESPEED_MODELS.SPEECH, inputs, apiKey);
    requestId = result.requestId;
  } catch (err: any) {
    return {
      segmentIndex,
      intent: segment.intent,
      text: segment.text,
      params: segment.params,
      requestId: "",
      status: "failed",
      audioUrl: null,
      dbJobId: null,
      errorMessage: err.message ?? "Submission failed",
    };
  }

  // Persist to wavespeed_jobs — best-effort, non-fatal
  let dbJobId: number | null = null;
  try {
    const [row] = await db
      .insert(wavespeedJobsTable)
      .values({
        userId,
        model: WAVESPEED_MODELS.SPEECH,
        status: "queued",
        wavespeedRequestId: requestId,
        inputPayload: JSON.stringify({
          segmentIndex,
          intent: segment.intent,
          presetId,
          text: segment.text,
          voiceId,
          speed: segment.params.speed,
          pitch: 0, // Always 0 — pitch shift distorts cloned voice identity
          languageBoost: segment.params.languageBoost,
          source: "voice_director_preview",
        }),
      })
      .returning({ id: wavespeedJobsTable.id });
    dbJobId = row?.id ?? null;
  } catch {
    // Non-fatal — preview works without DB persistence
  }

  return {
    segmentIndex,
    intent: segment.intent,
    text: segment.text,
    params: segment.params,
    requestId,
    status: "queued",
    audioUrl: null,
    dbJobId,
    errorMessage: null,
  };
}

// ── Polling ────────────────────────────────────────────────────────────────────

/**
 * Poll all pending jobs concurrently until every one reaches a terminal state
 * (completed or failed) or POLL_TIMEOUT_MS elapses.
 *
 * Jobs with an empty requestId (submission failed before reaching WaveSpeed)
 * are left in their "failed" state and skipped.
 *
 * No automatic retries — failed jobs stay failed per the spec.
 */
export async function pollJobsToCompletion(
  jobs: SegmentJobRecord[],
  apiKey: string,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<SegmentJobRecord[]> {
  const records = jobs.map((j) => ({ ...j }));
  let elapsed = 0;

  const isPending = (r: SegmentJobRecord) =>
    !!r.requestId && r.status !== "completed" && r.status !== "failed";

  for (const interval of POLL_INTERVALS_MS) {
    if (!records.some(isPending)) break;

    await sleep(interval);
    elapsed += interval;

    await Promise.all(
      records.filter(isPending).map(async (record) => {
        let result: WavespeedJobResult;
        try {
          result = await getJobStatus(record.requestId, apiKey);
        } catch {
          return; // Network hiccup — retry next interval
        }

        if (result.status === "completed") {
          record.status   = "completed";
          record.audioUrl = extractAudioUrl(result.outputs) ?? null;

          // Best-effort DB update
          try {
            await db
              .update(wavespeedJobsTable)
              .set({
                status:        "completed",
                outputUrl:     record.audioUrl ?? undefined,
                outputPayload: JSON.stringify(result.outputs),
                updatedAt:     new Date(),
              })
              .where(eq(wavespeedJobsTable.wavespeedRequestId, record.requestId));
          } catch { /* non-fatal */ }

        } else if (result.status === "failed") {
          record.status       = "failed";
          record.errorMessage = result.error ?? "WaveSpeed job failed";

          try {
            await db
              .update(wavespeedJobsTable)
              .set({
                status:       "failed",
                errorMessage: record.errorMessage,
                updatedAt:    new Date(),
              })
              .where(eq(wavespeedJobsTable.wavespeedRequestId, record.requestId));
          } catch { /* non-fatal */ }
        }
        // queued | processing → wait for the next interval
      }),
    );

    if (elapsed >= timeoutMs) break;
  }

  // Mark anything still pending as timeout
  for (const r of records) {
    if (isPending(r)) r.status = "timeout";
  }

  return records;
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Generate an expressive audio preview for a set of Voice Director segments.
 *
 * Flow:
 *   submit all jobs (parallel) → poll → download → FFmpeg concat → return
 *
 * Does NOT call InfiniteTalk or produce any video output.
 * Throws immediately with a clear message if WAVESPEED_API_KEY is missing.
 *
 * @param segments  From analyzeScriptForWavespeed()
 * @param voiceId   WaveSpeed voice id (cloned or preset)
 * @param presetId  Voice Director preset name (stored in job metadata)
 * @param apiKey    Resolved WAVESPEED_API_KEY
 * @param userId    DB user id for wavespeed_jobs records
 */
export async function generateVdAudioPreview(opts: {
  segments: WavespeedVoiceSegment[];
  voiceId: string;
  presetId: string;
  apiKey: string;
  userId: number;
}): Promise<VdAudioPreviewResult> {
  const { segments, voiceId, presetId, apiKey, userId } = opts;

  await ensureAudioDir();

  if (segments.length === 0) {
    return { jobs: [], concatenatedAudioPath: null, allCompleted: true, anyFailed: false };
  }

  // 1. Submit all jobs in parallel
  const submittedJobs = await Promise.all(
    segments.map((seg, i) =>
      submitSegmentJob(seg, i, voiceId, presetId, apiKey, userId),
    ),
  );

  // 2. Poll until all reach a terminal state (or timeout)
  const finalJobs = await pollJobsToCompletion(submittedJobs, apiKey, POLL_TIMEOUT_MS);

  const allCompleted = finalJobs.every((j) => j.status === "completed");
  const anyFailed    = finalJobs.some((j) => j.status === "failed" || j.status === "timeout");

  // 3. Download completed audio files
  const sessionId = randomUUID();
  const downloadedPaths: Array<string | null> = await Promise.all(
    finalJobs.map(async (job, i) => {
      if (job.status !== "completed" || !job.audioUrl) return null;
      const ext  = job.audioUrl.toLowerCase().includes(".wav") ? "wav" : "mp3";
      const dest = join(VD_AUDIO_DIR, `${sessionId}-seg${i}.${ext}`);
      try {
        await downloadToTmp(job.audioUrl, dest);
        return dest;
      } catch {
        return null;
      }
    }),
  );

  // 4. Concatenate with FFmpeg
  const validPaths    = downloadedPaths.filter((p): p is string => p !== null);
  const pauseDurations = finalJobs
    .filter((_, i) => downloadedPaths[i] !== null)
    .map((j) => segments[j.segmentIndex].pauseAfter);

  let concatenatedAudioPath: string | null = null;

  if (validPaths.length > 0) {
    const outPath = join(VD_AUDIO_DIR, `preview-${sessionId}.mp3`);
    try {
      await concatAudioWithFfmpeg(validPaths, pauseDurations, outPath);
      concatenatedAudioPath = outPath;
    } catch {
      // Concat failed — caller can degrade to per-segment audioUrls
    }
    // Clean up intermediate segment files (keep only the final concat)
    await Promise.allSettled(validPaths.map((p) => rm(p, { force: true })));
  }

  return { jobs: finalJobs, concatenatedAudioPath, allCompleted, anyFailed };
}
