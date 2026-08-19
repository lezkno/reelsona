/**
 * B-Roll Engine — AI-generated photorealistic vertical images composited
 * onto the video at script-driven moments, before caption compositing.
 *
 * Pipeline position:
 *   [zoom pre-pass] → [B-roll overlay] → [caption compositing]
 *
 * Each B-roll image is:
 *   • Generated via WaveSpeed (Seedream text-to-image) at 1024×1536 (portrait 2:3)
 *   • Guided by a per-video visual direction (shared lighting, palette, atmosphere)
 *   • Selected for scroll-stopping impact, not literal illustration
 *   • Animated with stable Ken Burns-style pan motion using scale+crop (no zoompan)
 *   • Duration varies per segment based on sentence length (2.5 – 4.5 s)
 *   • Faded in (0.3 s) and out (0.3 s) over the avatar video
 *
 * Graceful degradation: any per-segment failure is skipped; if all fail
 * or there are no assets to composite, the source video is returned unchanged.
 */

import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { makeOpenAIClient } from "./openai-client";
import { submitJob, getJobStatus, WAVESPEED_MODELS } from "./wavespeed";
import {
  reserveBRollImageCredits,
  consumeBRollImageCredits,
  releaseBRollImageCredits,
} from "./credits";
import { logger } from "./logger";
import type { PunchWordTiming } from "./caption-engine";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

export interface BRollSegment {
  /** Start time in seconds within the video */
  startSec: number;
  /** Hold duration in seconds (not counting fade in/out) */
  durationSec: number;
  /** English image generation prompt — concise, cinematic, impact-first */
  imagePrompt: string;
}

export interface BRollImageAsset {
  segment: BRollSegment;
  /** Absolute path to the downloaded PNG on disk */
  tmpPath: string;
}

/** Optional caller-supplied context for richer visual direction generation. */
export interface BRollVisualContext {
  niche?: string | null;
  topic?: string | null;
}

/**
 * Billing context: when set, each AI-generated image reserves 2 credits before
 * submission, consumes on success, releases on failure. When absent (e.g. a
 * free caption-style re-render), no credits are charged.
 */
export interface BRollBillingContext {
  userId:  number;
  videoId: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const FADE_DUR        = 0.3;   // seconds for fade in and fade out
const MIN_GAP_SEC     = 10;    // minimum gap between B-roll segments
const MIN_START_SEC   = 4;     // don't start in the first N seconds (hook / opening)
const MIN_END_MARGIN  = 5;     // don't start within last N seconds
const MOTION_OVERSCAN = 1.10;  // enlarge stills so crop can pan without exposing edges

/**
 * Safety suffix appended to every image prompt.
 * People and human subjects are ALLOWED — only text/logos are excluded.
 */
const PHOTO_SAFETY_SUFFIX =
  "9:16 portrait vertical photograph, ultra-detailed, professional photography. " +
  "No text overlays, no watermarks, no brand logos, no recognizable trademarks. " +
  "Anonymous people and human subjects are allowed when natural to the scene. ";

/** Count of B-roll segments scaled to video duration */
function bRollCount(durationSec: number): number {
  if (durationSec <= 15) return 2;
  if (durationSec <= 40) return 3;
  if (durationSec <= 60) return 4;
  return 5;
}

/** Estimate hold duration from sentence complexity (word count). */
function estimateHoldDuration(sentence: string): number {
  const wordCount = sentence.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount <= 8)  return 2.5;
  if (wordCount <= 14) return 3.5;
  return 4.5;
}

// ── Step 0: Visual direction generation ──────────────────────────────────────

async function generateVisualDirection(
  visualSuggestions: string | null,
  visualContext?: BRollVisualContext | null,
  openaiApiKey?: string | null,
): Promise<string> {
  try {
    const client = makeOpenAIClient({ timeout: 30_000 });

    const contextLines = [
      visualContext?.niche  ? `Niche: ${visualContext.niche}` : "",
      visualContext?.topic  ? `Topic: ${visualContext.topic}` : "",
      visualSuggestions     ? `Visual context: ${visualSuggestions}` : "",
    ].filter(Boolean).join("\n");

    if (!contextLines) return "";

    const { choices } = await client.chat.completions.create({
      model: "gpt-5.4-mini",
      temperature: 0.8,
      max_completion_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "You are a cinematographer directing Instagram Reels. " +
            "Write a concise visual direction in 1–2 English sentences. " +
            "Specify: lighting mood, color temperature, atmosphere, and photographic style. " +
            "Make it striking and scroll-stopping. Reply ONLY with the visual direction text, no labels.",
        },
        {
          role: "user",
          content:
            contextLines +
            "\n\nGenerate a cohesive cinematographic visual direction so that every B-roll image " +
            "in this video feels intentional and visually consistent. " +
            "Think: what lighting and atmosphere would make a viewer stop scrolling?",
        },
      ],
    });

    const result = choices[0]?.message?.content?.trim() ?? "";
    logger.info({ result: result.slice(0, 80) }, "[BRoll] Visual direction generated");
    return result;
  } catch (err) {
    logger.warn({ err }, "[BRoll] Visual direction generation failed — using prompt-only images");
    return "";
  }
}

// ── Step 1: Segment analysis ─────────────────────────────────────────────────

interface RawAISegment {
  sentenceIdx: number;
  imagePrompt: string;
}

async function analyzeScriptForBRoll(
  sentences: string[],
  count: number,
  visualSuggestions: string | null,
  openaiApiKey?: string | null,
): Promise<RawAISegment[]> {
  if (count <= 0 || sentences.length === 0) return [];

  const client = makeOpenAIClient({ timeout: 60_000 });

  const cap = Math.min(sentences.length, 50);
  const numbered = sentences.slice(0, cap).map((s, i) => `${i}: ${s}`).join("\n");
  const suggestionsBlock = visualSuggestions
    ? `\nVisual style context for this topic (use as inspiration):\n${visualSuggestions}\n`
    : "";

  const { choices } = await client.chat.completions.create({
    model: "gpt-5.4-mini",
    temperature: 0.7,
    max_completion_tokens: 500,
    messages: [
      {
        role: "system",
        content:
          "You select moments in video scripts for scroll-stopping B-roll images. " +
          "Reply ONLY with a valid JSON array — no markdown, no code block.",
      },
      {
        role: "user",
        content:
          `Select exactly ${count} moments from this script for B-roll images that would stop scrolling.\n\n` +
          `SELECTION CRITERIA — prioritize moments that:\n` +
          `• Represent a peak emotional beat, surprising revelation, or key tension point\n` +
          `• Describe a situation with strong visual potential (human drama, striking contrast, powerful context)\n` +
          `• Are spread across the script — do NOT cluster near the beginning or end\n` +
          `• Are NOT the most predictable or generic lines in the script\n\n` +
          `For each selected moment write a CINEMATOGRAPHIC image prompt that:\n` +
          `• Describes a scene designed to STOP scrolling — dramatic, atmospheric, or emotionally resonant\n` +
          `• Uses strong composition (depth, contrast, foreground/background, leading lines)\n` +
          `• Specifies mood, lighting, and atmosphere — not just subject matter\n` +
          `• Can include anonymous people in authentic situations when natural\n` +
          `• Is specific and visual — NOT a literal illustration of the spoken words\n` +
          `• Is written in English\n` +
          suggestionsBlock +
          `\nScript sentences (numbered):\n${numbered}\n\n` +
          `Reply with ONLY a JSON array of exactly ${count} objects:\n` +
          `[{"sentenceIdx": <number>, "imagePrompt": "<english cinematic prompt>"}, ...]`,
      },
    ],
  });

  const raw = choices[0]?.message?.content?.trim() ?? "[]";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  let parsed: unknown[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn({ raw }, "[BRoll] AI response not valid JSON — skipping");
    return [];
  }

  return (parsed as RawAISegment[])
    .filter(
      (x): x is RawAISegment =>
        typeof x === "object" &&
        x !== null &&
        typeof x.sentenceIdx === "number" &&
        Number.isInteger(x.sentenceIdx) &&
        x.sentenceIdx >= 0 &&
        x.sentenceIdx < cap &&
        typeof x.imagePrompt === "string" &&
        x.imagePrompt.length > 5,
    )
    .slice(0, count);
}

function sentenceToTimestamp(
  sentences: string[],
  idx: number,
  wordTimings: PunchWordTiming[],
  totalChars: number,
  videoDuration: number,
): number | null {
  const sentence = sentences[idx];
  if (!sentence) return null;

  const sentenceStart = sentences.slice(0, idx).reduce((s, x) => s + x.length, 0);
  const expectedMs = (sentenceStart / totalChars) * videoDuration * 1000;
  const windowMs = videoDuration * 350;

  const candidates = sentence
    .replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6);

  let bestHit: PunchWordTiming | null = null;
  let bestDist = Infinity;

  for (const word of candidates) {
    const norm = word.toLowerCase().replace(/[^a-záéíóúüñ0-9]/g, "");
    for (const wt of wordTimings) {
      if (wt.text.toLowerCase().replace(/[^a-záéíóúüñ0-9]/g, "") !== norm) continue;
      const dist = Math.abs(wt.startMs - expectedMs);
      if (dist < windowMs && dist < bestDist) {
        bestDist = dist;
        bestHit = wt;
      }
    }
  }

  if (bestHit) {
    const t = bestHit.startMs / 1000;
    return t >= MIN_START_SEC && t < videoDuration - MIN_END_MARGIN ? t : null;
  }

  const t = expectedMs / 1000;
  return t >= MIN_START_SEC && t < videoDuration - MIN_END_MARGIN ? t : null;
}

export async function analyzeBRollSegments(
  script: string,
  wordTimings: PunchWordTiming[],
  videoDuration: number,
  visualSuggestions?: string | null,
  openaiApiKey?: string | null,
  visualContext?: BRollVisualContext | null,
): Promise<{ segments: BRollSegment[]; visualDirection: string }> {
  const count = bRollCount(videoDuration);

  const sentences = (script.match(/[^.!?\n]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);

  if (sentences.length < 3) {
    logger.warn({ sentenceCount: sentences.length }, "[BRoll] Script too short for B-roll analysis");
    return { segments: [], visualDirection: "" };
  }

  const totalChars = sentences.reduce((s, x) => s + x.length, 0) || 1;
  const visualDirection = await generateVisualDirection(
    visualSuggestions ?? null,
    visualContext,
    openaiApiKey,
  );

  const bodyStart = Math.min(2, sentences.length - 1);
  const bodySentences = sentences.slice(bodyStart);

  let rawSegments: RawAISegment[] = [];
  try {
    rawSegments = await analyzeScriptForBRoll(bodySentences, count, visualSuggestions ?? null, openaiApiKey);
    logger.info({ count: rawSegments.length }, "[BRoll] AI selected segments");
  } catch (err) {
    logger.warn({ err }, "[BRoll] AI analysis failed — no B-roll");
    return { segments: [], visualDirection };
  }

  const segments: BRollSegment[] = [];
  for (const raw of rawSegments) {
    const globalIdx = raw.sentenceIdx + bodyStart;
    const startSec = sentenceToTimestamp(sentences, globalIdx, wordTimings, totalChars, videoDuration);
    if (startSec === null) continue;
    segments.push({
      startSec,
      durationSec: estimateHoldDuration(sentences[globalIdx] ?? ""),
      imagePrompt: raw.imagePrompt,
    });
  }

  segments.sort((a, b) => a.startSec - b.startSec);
  const result: BRollSegment[] = [];
  for (const seg of segments) {
    if (result.length === 0) {
      result.push(seg);
      continue;
    }
    const prev = result[result.length - 1];
    if (seg.startSec - (prev.startSec + prev.durationSec) >= MIN_GAP_SEC) {
      result.push(seg);
    }
  }

  logger.info(
    { segments: result.map((s) => ({ startSec: s.startSec, dur: s.durationSec, prompt: s.imagePrompt.slice(0, 60) })) },
    "[BRoll] Final segments",
  );
  return { segments: result, visualDirection };
}

// ── Step 2: Image generation ─────────────────────────────────────────────────

async function pollBRollJob(requestId: string, maxMs = 120_000): Promise<string | null> {
  const start = Date.now();
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  while (Date.now() - start < maxMs) {
    const result = await getJobStatus(requestId);
    if (result.status === "completed") {
      const outputs = Array.isArray(result.outputs) ? (result.outputs as string[]) : [];
      return outputs[0] ?? null;
    }
    if (result.status === "failed") {
      logger.warn({ requestId, error: result.error }, "[BRoll] WaveSpeed job failed");
      return null;
    }
    await delay(3_000);
  }
  logger.warn({ requestId }, "[BRoll] WaveSpeed job timed out after 120 s");
  return null;
}

export async function generateBRollImages(
  segments: BRollSegment[],
  tmpDir: string,
  visualDirection: string,
  openaiApiKey?: string | null,
  billing?: BRollBillingContext | null,
): Promise<BRollImageAsset[]> {
  const directionPrefix = visualDirection ? `${visualDirection}. ` : "";

  type Submission = { segment: BRollSegment; i: number; requestId: string; reservationId: number | null };
  const submissions: (Submission | null)[] = await Promise.all(
    segments.map(async (segment, i) => {
      // Reserve credits BEFORE submitting to the provider. If the balance is
      // insufficient, skip this segment — never generate an unpaid image.
      let reservationId: number | null = null;
      if (billing) {
        let reserved: number | "already_paid" | null;
        try {
          reserved = await reserveBRollImageCredits(billing.userId, billing.videoId, i);
        } catch (err) {
          logger.warn({ idx: i, err }, "[BRoll] Credit reservation failed — skipping segment");
          return null;
        }
        if (reserved === null) {
          logger.warn({ idx: i, userId: billing.userId }, "[BRoll] Saldo insuficiente — segmento omitido");
          return null;
        }
        // "already_paid" → prior attempt charged this segment; regenerate free
        reservationId = reserved === "already_paid" ? null : reserved;
      }

      const prompt = directionPrefix + PHOTO_SAFETY_SUFFIX + segment.imagePrompt;
      try {
        logger.info({ idx: i, prompt: prompt.slice(0, 100) }, "[BRoll] Submitting image job…");
        const { requestId } = await submitJob(
          WAVESPEED_MODELS.TEXT_TO_IMAGE,
          { prompt, size: "1024x1536" },
        );
        return { segment, i, requestId, reservationId };
      } catch (err) {
        logger.warn({ idx: i, err }, "[BRoll] Job submission failed — skipping segment");
        if (reservationId !== null) {
          await releaseBRollImageCredits(reservationId, "B-roll: fallo al enviar el job al proveedor").catch((e) =>
            logger.error({ reservationId, e }, "[BRoll] Credit release failed after submit error"),
          );
        }
        return null;
      }
    }),
  );

  const results: BRollImageAsset[] = [];
  await Promise.all(
    submissions.map(async (sub) => {
      if (!sub) return;
      const { segment, i, requestId, reservationId } = sub;
      try {
        const imageUrl = await pollBRollJob(requestId);
        if (!imageUrl) {
          logger.warn({ idx: i, requestId }, "[BRoll] No image URL — skipping segment");
          if (reservationId !== null) {
            await releaseBRollImageCredits(reservationId, "B-roll: la generación de imagen falló o expiró");
          }
          return;
        }
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} downloading B-roll image`);
        const buf = Buffer.from(await res.arrayBuffer());
        const tmpPath = path.join(tmpDir, `broll_${i}.png`);
        await fs.writeFile(tmpPath, buf);
        results.push({ segment, tmpPath });
        logger.info({ idx: i, path: tmpPath }, "[BRoll] Image generated ✓");
        if (reservationId !== null && billing) {
          await consumeBRollImageCredits(reservationId, billing.videoId).catch((e) =>
            logger.error({ reservationId, e }, "[BRoll] Credit consume failed after successful image"),
          );
        }
      } catch (err) {
        logger.warn({ idx: i, requestId, err }, "[BRoll] Image generation failed — skipping segment");
        if (reservationId !== null) {
          await releaseBRollImageCredits(reservationId, "B-roll: fallo al descargar/procesar la imagen").catch((e) =>
            logger.error({ reservationId, e }, "[BRoll] Credit release failed after image error"),
          );
        }
      }
    }),
  );

  return results;
}

// ── Step 3: FFmpeg compositing with stable Ken Burns-style motion ─────────────

/**
 * Build a crop expression for one B-roll asset.
 *
 * We intentionally avoid FFmpeg's zoompan filter because it has been unstable in
 * the deployment image. Instead each still is overscaled by 10% and the crop
 * window moves smoothly during the segment. This produces a subtle cinematic
 * Ken Burns-style movement while staying on the reliable scale+crop path.
 */
function motionCropExpressions(index: number, segment: BRollSegment): { x: string; y: string } {
  const start = segment.startSec.toFixed(3);
  const dur = Math.max(segment.durationSec, 0.5).toFixed(3);
  const progress = `min(max((t-${start})/${dur},0),1)`;

  switch (index % 4) {
    case 0:
      return { x: `(in_w-out_w)*${progress}`, y: `(in_h-out_h)/2` };
    case 1:
      return { x: `(in_w-out_w)*(1-${progress})`, y: `(in_h-out_h)/2` };
    case 2:
      return { x: `(in_w-out_w)/2`, y: `(in_h-out_h)*${progress}` };
    default:
      return { x: `(in_w-out_w)/2`, y: `(in_h-out_h)*(1-${progress})` };
  }
}

export async function composeBRoll(
  sourcePath: string,
  assets: BRollImageAsset[],
  videoWidth: number,
  videoHeight: number,
  videoDuration: number,
  tmpDir: string,
): Promise<string> {
  if (assets.length === 0) return sourcePath;

  const outputPath = path.join(tmpDir, "broll_composited.mp4");

  const inputArgs: string[] = [];
  for (const asset of assets) {
    inputArgs.push("-loop", "1", "-t", String(Math.ceil(videoDuration + 1)), "-i", asset.tmpPath);
  }

  const filterParts: string[] = [];
  let prevLabel = "[0:v]";
  const overscanW = Math.ceil(videoWidth * MOTION_OVERSCAN);
  const overscanH = Math.ceil(videoHeight * MOTION_OVERSCAN);

  for (let i = 0; i < assets.length; i++) {
    const { segment } = assets[i];
    const inputIdx = i + 1;
    const bvLabel  = `[bv${i}]`;
    const outLabel = i === assets.length - 1 ? "[vout]" : `[ov${i}]`;
    const motion = motionCropExpressions(i, segment);

    const fadeInSt  = segment.startSec.toFixed(3);
    const fadeOutSt = Math.max(
      segment.startSec + FADE_DUR,
      segment.startSec + segment.durationSec - FADE_DUR,
    ).toFixed(3);

    filterParts.push(
      `[${inputIdx}:v]` +
        `scale=${overscanW}:${overscanH}:force_original_aspect_ratio=increase,` +
        `crop=${videoWidth}:${videoHeight}:x='${motion.x}':y='${motion.y}',` +
        `setsar=1,` +
        `format=yuva420p,` +
        `fade=t=in:st=${fadeInSt}:d=${FADE_DUR}:alpha=1,` +
        `fade=t=out:st=${fadeOutSt}:d=${FADE_DUR}:alpha=1` +
        `${bvLabel}`,
    );
    filterParts.push(`${prevLabel}${bvLabel}overlay=0:0:eof_action=pass${outLabel}`);
    prevLabel = outLabel;
  }

  const filterComplex = filterParts.join(";");

  logger.info(
    { assetCount: assets.length, videoWidth, videoHeight, videoDuration, motionOverscan: MOTION_OVERSCAN },
    "[BRoll] Running FFmpeg B-roll compositing with motion...",
  );

  // Timeout: ~10× real-time for a fast-preset encode is generous even on autoscale.
  // Without a timeout, an OOM-killed or hung FFmpeg process leaves the promise
  // permanently unresolved, blocking the entire caption pipeline indefinitely.
  const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000; // 10 min ceiling

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-i", sourcePath,
        ...inputArgs,
        "-filter_complex", filterComplex,
        "-map", "[vout]",
        "-map", "0:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "21",
        "-c:a", "copy",
        "-movflags", "+faststart",
        "-y", outputPath,
      ],
      { maxBuffer: 500 * 1024 * 1024, timeout: FFMPEG_TIMEOUT_MS },
    );

    logger.info({ outputPath }, "[BRoll] B-roll compositing done ✓");
    return outputPath;
  } catch (err: any) {
    const isTimeout = err?.killed === true || err?.code === "ETIMEDOUT" || err?.signal === "SIGTERM";
    if (isTimeout) {
      logger.error(
        { videoDuration, videoWidth, videoHeight, assetCount: assets.length },
        "[BRoll] FFmpeg compositing timed out — returning source video unchanged",
      );
    } else {
      logger.warn({ err }, "[BRoll] FFmpeg compositing failed — returning source video unchanged");
    }
    return sourcePath;
  }
}

// ── Convenience: full B-roll pipeline ────────────────────────────────────────

export async function applyBRoll(
  sourcePath: string,
  script: string,
  wordTimings: PunchWordTiming[],
  videoWidth: number,
  videoHeight: number,
  videoDuration: number,
  tmpDir: string,
  visualSuggestions?: string | null,
  openaiApiKey?: string | null,
  visualContext?: BRollVisualContext | null,
  billing?: BRollBillingContext | null,
): Promise<string> {
  try {
    const { segments, visualDirection } = await analyzeBRollSegments(
      script,
      wordTimings,
      videoDuration,
      visualSuggestions,
      openaiApiKey,
      visualContext,
    );
    if (segments.length === 0) {
      logger.info("[BRoll] No segments to composite — skipping");
      return sourcePath;
    }

    const assets = await generateBRollImages(segments, tmpDir, visualDirection, openaiApiKey, billing);
    if (assets.length === 0) {
      logger.warn(
        { hasPersonalKey: !!openaiApiKey },
        "[BRoll] No images generated — skipping compositing. Check above warn logs for per-segment errors.",
      );
      return sourcePath;
    }

    return await composeBRoll(sourcePath, assets, videoWidth, videoHeight, videoDuration, tmpDir);
  } catch (err) {
    logger.warn({ err }, "[BRoll] B-roll pipeline failed — returning source video unchanged");
    return sourcePath;
  }
}
