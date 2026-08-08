/**
 * Browser Caption Engine — experimental renderer using @napi-rs/canvas (Skia).
 *
 * Architecture:
 *  1. Parse SRT → WordTiming[]  (same data as the standard engine)
 *  2. Build CaptionCues from the shared caption-templates package
 *  3. Render each cue as a transparent PNG using Canvas 2D API
 *  4. Composite all PNG overlays onto the video using FFmpeg
 *     (FFmpeg is only for encoding — no ASS, no drawtext)
 *  5. Upload to object storage; return URL
 *
 * Fallback: if @napi-rs/canvas fails to load, returns { url: null, error } so
 * the scheduler falls through to the standard ASS engine transparently.
 *
 * Word-timestamp readiness: CaptionCue.words already accepts per-word startMs/endMs.
 * In phase 1 we use SRT-block timing; in phase 2, AI transcription fills per-word times.
 */

import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";
import type { CaptionResult } from "./caption-engine";
import { CAPTION_DIR } from "./caption-engine";
import {
  BROWSER_CAPTION_TEMPLATES,
  getBrowserTemplate,
  buildCaptionCues,
  formatWord,
  getBaselineY,
  getSafeMarginX,
  scaleToHeight,
} from "@workspace/caption-templates";
import type { CaptionTemplate, CaptionCue } from "@workspace/caption-templates";

const execFileAsync = promisify(execFile);

// ── Constants ─────────────────────────────────────────────────────────────────

const FONTS_DIR = path.join(__dirname, "../assets/fonts");

/**
 * Default/fallback video dimensions — used only if ffprobe cannot determine
 * the actual video size. The real dimensions are probed from every video before
 * rendering so PNGs are always composited at native resolution.
 */
const VIDEO_WIDTH_DEFAULT  = 1080;
const VIDEO_HEIGHT_DEFAULT = 1920;

/** Word gap = N% of font-size */
const WORD_GAP_FACTOR = 0.18;

/** Maximum cues to composite in a single FFmpeg run (prevents filter_complex overflow) */
const MAX_CUES = 400;

// ── Canvas lazy-loader ────────────────────────────────────────────────────────

type CanvasModule = typeof import("@napi-rs/canvas");

/**
 * Promise singleton — all concurrent callers share the same load attempt.
 * Using a flag + null module caused a race condition: a second caller that
 * arrived while the first was still awaiting `import(...)` would see
 * _loadAttempted=true but _canvasModule=null and immediately return null,
 * marking the engine as unavailable even though the load was in flight.
 */
let _loadPromise: Promise<CanvasModule | null> | null = null;

async function loadCanvas(): Promise<CanvasModule | null> {
  if (_loadPromise !== null) return _loadPromise;
  _loadPromise = _doLoadCanvas();
  return _loadPromise;
}

async function _doLoadCanvas(): Promise<CanvasModule | null> {
  try {
    // Dynamic import — if native binary is missing this throws and we fall back
    const mod = await import("@napi-rs/canvas");

    // Register all bundled fonts
    const fontFiles = [
      { file: "Oswald-Bold.ttf",       family: "Oswald" },
      { file: "Oswald.ttf",            family: "Oswald" },
      { file: "Poppins-ExtraBold.ttf", family: "Poppins" },
      { file: "Bangers-Regular.ttf",   family: "Bangers" },
    ];

    for (const { file, family } of fontFiles) {
      const fontPath = path.join(FONTS_DIR, file);
      try {
        await fs.access(fontPath);
        mod.GlobalFonts.registerFromPath(fontPath, family);
        logger.debug({ family, file }, "[BrowserEngine] Font registered");
      } catch {
        logger.warn({ fontPath }, "[BrowserEngine] Font file not found — skipping");
      }
    }

    logger.info("[BrowserEngine] @napi-rs/canvas loaded ✓");
    return mod;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err },
      `[BrowserEngine] @napi-rs/canvas unavailable (${msg}) — browser render disabled, standard engine will be used as fallback`
    );
    return null;
  }
}

/** Returns true once canvas has been loaded successfully. */
export async function isBrowserEngineAvailable(): Promise<boolean> {
  const mod = await loadCanvas();
  return mod !== null;
}

export { BROWSER_CAPTION_TEMPLATES };

// ── Video dimension probe ─────────────────────────────────────────────────────

/**
 * Probe the actual width × height of a local video file using ffprobe.
 * Returns the video stream dimensions, or the HeyGen portrait defaults if
 * the probe fails (e.g. corrupt file or ffprobe not available).
 *
 * WHY this matters: PNGs must be rendered at exactly the same dimensions as the
 * source video. If we render at 1080×1920 but the video is 720×1280, the FFmpeg
 * overlay clips the PNG at 720 × 1280 — text at y=83% of 1920 = 1593px falls
 * entirely outside the 1280px frame and is invisible.
 */
async function probeVideoDimensions(
  videoPath: string,
): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",            "quiet",
      "-print_format", "json",
      "-show_streams",
      "-select_streams", "v:0",
      videoPath,
    ]);
    const data   = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
    const stream = data.streams?.[0];
    if (stream?.width && stream?.height) {
      return { width: stream.width, height: stream.height };
    }
  } catch {
    // ffprobe unavailable or unreadable — fall through to defaults
  }
  return { width: VIDEO_WIDTH_DEFAULT, height: VIDEO_HEIGHT_DEFAULT };
}

// ── Frame renderer ────────────────────────────────────────────────────────────

/**
 * Build wrapped lines from a flat list of word indices.
 * Mirrors the CSS `flex-wrap: wrap` behaviour of the React preview:
 * words are packed greedily into lines; a new line starts when the next word
 * would exceed the available width (videoW − 2 × marginX).
 */
function buildWrappedLines(
  measurements: number[],
  wordGap: number,
  availableW: number,
): Array<{ wordIndices: number[]; lineWidth: number }> {
  const lines: Array<{ wordIndices: number[]; lineWidth: number }> = [];
  let currentIndices: number[] = [];
  let currentWidth = 0;

  for (let i = 0; i < measurements.length; i++) {
    const wordW = measurements[i];
    const gapW  = currentIndices.length > 0 ? wordGap : 0;

    if (currentIndices.length > 0 && currentWidth + gapW + wordW > availableW) {
      // Flush current line and start a new one
      lines.push({ wordIndices: currentIndices, lineWidth: currentWidth });
      currentIndices = [i];
      currentWidth   = wordW;
    } else {
      currentIndices.push(i);
      currentWidth += gapW + wordW;
    }
  }
  if (currentIndices.length > 0) {
    lines.push({ wordIndices: currentIndices, lineWidth: currentWidth });
  }
  return lines;
}

/**
 * Render one caption cue as a transparent PNG at the given video dimensions.
 *
 * @param videoW  Actual source video width  (probed from the video file)
 * @param videoH  Actual source video height (probed from the video file)
 *
 * WHY dynamic dimensions: the PNG must match the source video pixel-for-pixel.
 * A 1080×1920 PNG overlaid on a 720×1280 video clips at 720×1280 — text at
 * y=83% of 1920 = 1593px falls outside the 1280px frame and is invisible.
 * By rendering at the actual video dimensions, positions and font sizes remain
 * proportionally correct (scaleToHeight uses the actual height as reference).
 */
async function renderCueFrame(
  canvas: CanvasModule,
  template: CaptionTemplate,
  cue: CaptionCue,
  videoW = VIDEO_WIDTH_DEFAULT,
  videoH = VIDEO_HEIGHT_DEFAULT,
): Promise<Buffer> {
  const cvs = canvas.createCanvas(videoW, videoH);
  const ctx = cvs.getContext("2d");

  // Fully transparent background — the PNG is composited over the video
  ctx.clearRect(0, 0, videoW, videoH);

  const fontSize    = Math.round(scaleToHeight(template.fontSize,     videoH));
  const outlineW    = scaleToHeight(template.outlineWidth,   videoH);
  const shadowX     = scaleToHeight(template.shadowOffsetX,  videoH);
  const shadowY     = scaleToHeight(template.shadowOffsetY,  videoH);
  const shadowBlur  = scaleToHeight(template.shadowBlur,     videoH);
  const baselineY   = getBaselineY(template, videoH);
  const marginX     = getSafeMarginX(template, videoW);
  const availableW  = videoW - 2 * marginX;

  // Format words (apply uppercase if template requires it)
  const displayWords = cue.words.map((w) => formatWord(w.text, template));

  /**
   * Measure all words at `fontSize` first, then auto-scale the font down if
   * any single word is wider than availableW.  This prevents long words like
   * "AUTOMÁTICAMENTE" from overflowing the right edge of the frame.
   *
   * The scale is applied uniformly to the entire cue so the relative sizes of
   * active vs inactive words are preserved.
   */
  const measureWords = (fs: number): number[] =>
    displayWords.map((word, i) => {
      const isActive   = i === cue.activeWordIndex;
      const wordScale  = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
      const wordFontSz = Math.round(fs * wordScale);
      ctx.font = `${template.fontWeight} ${wordFontSz}px '${template.fontFamily}'`;
      return ctx.measureText(word).width;
    });

  let measurements = measureWords(fontSize);
  const maxWordW   = measurements.length > 0 ? Math.max(...measurements) : 0;

  // If the widest word overflows, scale the whole cue down to fit
  let effectiveFontSize = fontSize;
  if (maxWordW > availableW && maxWordW > 0) {
    effectiveFontSize = Math.max(Math.floor(fontSize * (availableW / maxWordW)), 1);
    measurements      = measureWords(effectiveFontSize);
  }

  // Word-gap and line-spacing use the final (possibly scaled-down) font size
  const wordGapScaled = Math.round(effectiveFontSize * WORD_GAP_FACTOR);
  const lineSpacing   = Math.round(effectiveFontSize * template.lineHeight);

  // Wrap words into lines (same greedy algorithm as CSS flex-wrap)
  const lines = buildWrappedLines(measurements, wordGapScaled, availableW);

  // Draw lines bottom-up: last line baseline = baselineY, earlier lines shifted up
  for (let li = 0; li < lines.length; li++) {
    const { wordIndices, lineWidth } = lines[li];
    // li=0 is the top line; li=(lines.length-1) is the bottom line at baselineY
    const lineY = baselineY - (lines.length - 1 - li) * lineSpacing;
    // Center each line within safe area
    const lineX = Math.max(marginX, (videoW - lineWidth) / 2);
    let x = lineX;

    // ── Full-line background box (backgroundMode: "line") ─────────────────
    // A single rounded-rect behind the entire line, drawn before any words so
    // text always renders on top of the box.
    if (template.backgroundMode === "line" && template.backgroundColor != null) {
      const padX = scaleToHeight(template.backgroundPaddingX, videoH);
      const padY = scaleToHeight(template.backgroundPaddingY, videoH);
      const r    = scaleToHeight(template.backgroundRadius,   videoH);
      ctx.save();
      ctx.shadowColor = "transparent";
      ctx.fillStyle   = template.backgroundColor as string;
      const boxX = lineX - padX;
      const boxY = lineY - effectiveFontSize * 0.85 - padY;
      const boxW = lineWidth + padX * 2;
      const boxH = effectiveFontSize * 1.25 + padY * 2;
      ctx.beginPath();
      if (r > 0 && "roundRect" in ctx) {
        (ctx as any).roundRect(boxX, boxY, boxW, boxH, r);
      } else {
        ctx.rect(boxX, boxY, boxW, boxH);
      }
      ctx.fill();
      ctx.restore();
    }

    for (const wi of wordIndices) {
      const word       = displayWords[wi];
      const isActive   = wi === cue.activeWordIndex;
      const wordScale  = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
      const wordFontSz = Math.round(effectiveFontSize * wordScale);
      const color      = isActive ? template.activeWordColor : template.primaryColor;
      const alpha      = isActive ? 1.0 : template.inactiveOpacity;
      const wordWidth  = measurements[wi];

      ctx.save();
      ctx.font         = `${template.fontWeight} ${wordFontSz}px '${template.fontFamily}'`;
      ctx.textBaseline = "alphabetic";

      ctx.shadowColor   = template.shadowColor;
      ctx.shadowOffsetX = shadowX;
      ctx.shadowOffsetY = shadowY;
      ctx.shadowBlur    = shadowBlur;

      // Word background box
      // "word"        → box behind every word
      // "active_word" → box only behind the active (highlighted) word
      const wantsBox =
        template.backgroundColor != null &&
        (template.backgroundMode === "word" ||
          (template.backgroundMode === "active_word" && isActive));

      if (wantsBox) {
        const padX = scaleToHeight(template.backgroundPaddingX, videoH);
        const padY = scaleToHeight(template.backgroundPaddingY, videoH);
        const r    = scaleToHeight(template.backgroundRadius,   videoH);
        ctx.save();
        ctx.shadowColor = "transparent";
        ctx.fillStyle   = template.backgroundColor as string;
        const boxX = x - padX;
        const boxY = lineY - wordFontSz - padY;
        const boxW = wordWidth + padX * 2;
        const boxH = wordFontSz * 1.25 + padY * 2;
        ctx.beginPath();
        if (r > 0 && "roundRect" in ctx) {
          (ctx as any).roundRect(boxX, boxY, boxW, boxH, r);
        } else {
          ctx.rect(boxX, boxY, boxW, boxH);
        }
        ctx.fill();
        ctx.restore();
      }

      // Stroke outline (paint-order: stroke fill)
      if (outlineW > 0) {
        ctx.strokeStyle = template.outlineColor;
        ctx.lineWidth   = outlineW * 2;
        ctx.lineJoin    = "round";
        ctx.globalAlpha = alpha;
        ctx.strokeText(word, x, lineY);
      }

      ctx.fillStyle   = color;
      ctx.globalAlpha = alpha;
      ctx.fillText(word, x, lineY);

      ctx.restore();
      x += wordWidth + wordGapScaled;
    }
  }

  return cvs.encode("png");
}

// ── SRT / timing helpers ──────────────────────────────────────────────────────

export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}

/** Parse an SRT file (word-level or phrase-level blocks) into WordTimings. */
export function parseSRT(srtContent: string): WordTiming[] {
  const blocks = srtContent.trim().split(/\n\n+/);
  const out: WordTiming[] = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const m = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!m) continue;
    const ms = (h: string, min: string, s: string, ms: string) =>
      +h * 3_600_000 + +min * 60_000 + +s * 1000 + +ms;
    const startMs = ms(m[1], m[2], m[3], m[4]);
    const endMs   = ms(m[5], m[6], m[7], m[8]);
    const text    = lines.slice(2).join(" ").trim();
    // Each SRT entry may contain a single word (HeyGen) or multiple words
    // Split multi-word entries so each word gets its proportional timing
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const msPerWord = (endMs - startMs) / words.length;
    words.forEach((w, wi) => {
      out.push({
        text:    w,
        startMs: Math.round(startMs + wi * msPerWord),
        endMs:   Math.round(startMs + (wi + 1) * msPerWord),
      });
    });
  }
  return out;
}

/** Proportional fallback timing when no SRT is available. */
export function buildFallbackTimings(script: string, durationSeconds: number): WordTiming[] {
  const tokens  = script.replace(/[.,!?;:¡¿]/g, "").split(/\s+/).filter(Boolean);
  const msEach  = (durationSeconds * 1000) / Math.max(tokens.length, 1);
  return tokens.map((text, i) => ({
    text,
    startMs: Math.round(i * msEach),
    endMs:   Math.round((i + 1) * msEach),
  }));
}

// ── Full video pipeline ───────────────────────────────────────────────────────

export async function applyCaptionsBrowser(
  videoUrl: string,
  script: string | null,
  templateId: string,
  opts?: {
    subtitleUrl?: string;
    videoDurationSeconds?: number;
    /** Override template.yPercent (0–100). Set from caption_config.y_position when user dragged. */
    yPositionPct?: number;
    /** Override template.marginXPercent (% of VIDEO_WIDTH). Converted from caption_config.margin_x. */
    marginXPct?: number;
  },
): Promise<CaptionResult> {
  logger.info({ templateId }, "[BrowserEngine] applyCaptionsBrowser invoked");

  // ── 1. Ensure canvas is available ────────────────────────────────────────
  const canvas = await loadCanvas();
  logger.info({ canvasAvailable: !!canvas }, "[BrowserEngine] canvas check");
  if (!canvas) {
    const err = "[BrowserEngine] @napi-rs/canvas not available — fallback to standard ASS engine";
    logger.warn(err);
    return { url: null, error: err };
  }

  // ── 2. Resolve template ───────────────────────────────────────────────────
  const baseTemplate = getBrowserTemplate(templateId);
  logger.info({ templateFound: !!baseTemplate, templateId }, "[BrowserEngine] template check");
  if (!baseTemplate) {
    const err = `[BrowserEngine] Unknown template id: "${templateId}"`;
    logger.warn(err);
    return { url: null, error: err };
  }

  // Apply user position overrides (drag-to-position from Caption Studio)
  const template: CaptionTemplate = {
    ...baseTemplate,
    ...(opts?.yPositionPct !== undefined && { yPercent:       opts.yPositionPct }),
    ...(opts?.marginXPct   !== undefined && { marginXPercent: opts.marginXPct   }),
  };

  if (opts?.yPositionPct !== undefined || opts?.marginXPct !== undefined) {
    logger.info(
      { yPercent: template.yPercent, marginXPercent: template.marginXPercent },
      "[BrowserEngine] Position overrides applied",
    );
  }

  const runId  = `browser_${Date.now()}`;
  const tmpDir = `${CAPTION_DIR}/${runId}`;
  await fs.mkdir(tmpDir, { recursive: true });

  logger.info(
    { templateId, template: template.name, videoUrl: videoUrl.slice(0, 70) },
    "[BrowserEngine] Starting browser caption render",
  );

  try {
    // ── 3. Download video ─────────────────────────────────────────────────
    const videoPath = path.join(tmpDir, "input.mp4");
    const videoResp = await axios.get(videoUrl, {
      responseType: "arraybuffer",
      timeout:      120_000,
    });
    await fs.writeFile(videoPath, Buffer.from(videoResp.data));
    logger.info("[BrowserEngine] Video downloaded");

    // ── 3b. Probe actual video dimensions ────────────────────────────────
    // CRITICAL: PNGs must be rendered at the source video's native resolution.
    // Rendering at hardcoded 1080×1920 while the video is 720×1280 causes
    // FFmpeg overlay to clip the PNG at 1280px — text at y=83% of 1920=1593px
    // is invisible. Probing and matching ensures pixel-perfect compositing.
    const videoDims = await probeVideoDimensions(videoPath);
    logger.info(videoDims, "[BrowserEngine] Video dimensions probed");

    // ── 4. Gather word timings ────────────────────────────────────────────
    let wordTimings: WordTiming[] = [];

    if (opts?.subtitleUrl) {
      try {
        const srtResp  = await axios.get<string>(opts.subtitleUrl, { timeout: 15_000 });
        wordTimings    = parseSRT(srtResp.data);
        logger.info({ count: wordTimings.length }, "[BrowserEngine] SRT timings parsed");
      } catch (srtErr) {
        logger.warn({ srtErr }, "[BrowserEngine] SRT fetch failed — trying fallback");
      }
    }

    if (wordTimings.length === 0 && script && opts?.videoDurationSeconds) {
      wordTimings = buildFallbackTimings(script, opts.videoDurationSeconds);
      logger.info({ count: wordTimings.length }, "[BrowserEngine] Proportional fallback timings built");
    }

    if (wordTimings.length === 0) {
      return { url: null, error: "[BrowserEngine] No word timings available" };
    }

    // ── 5. Build CaptionCues ──────────────────────────────────────────────
    const allCues = buildCaptionCues(wordTimings, template);
    const cues    = allCues.slice(0, MAX_CUES);

    if (cues.length < allCues.length) {
      logger.warn(
        { total: allCues.length, used: cues.length, limit: MAX_CUES },
        "[BrowserEngine] Cue count exceeds limit — truncating",
      );
    }

    logger.info({ cueCount: cues.length }, "[BrowserEngine] Rendering PNG frames...");

    // ── 6. Render one PNG per cue ─────────────────────────────────────────
    const segments: Array<{ pngPath: string; startSec: number; endSec: number }> = [];

    for (let i = 0; i < cues.length; i++) {
      const cue    = cues[i];
      const endMs  = i + 1 < cues.length ? cues[i + 1].startMs : cue.endMs;
      const png    = await renderCueFrame(canvas, template, cue, videoDims.width, videoDims.height);
      const pngPath = path.join(tmpDir, `cue_${String(i).padStart(4, "0")}.png`);
      await fs.writeFile(pngPath, png);
      segments.push({
        pngPath,
        startSec: cue.startMs / 1000,
        endSec:   endMs / 1000,
      });
    }

    logger.info({ count: segments.length }, "[BrowserEngine] Frames rendered");

    // ── 7. Composite frames onto video via FFmpeg (batch-segment approach) ───
    // Splitting into small batches avoids FFmpeg filter_complex limits with
    // large cue counts (140+ overlays). Each batch processes a short time
    // range of the source video with at most MAX_BATCH_OVERLAYS PNG overlays,
    // then all segments are concatenated into the final output.
    const MAX_BATCH_OVERLAYS = 15;
    const outputPath = path.join(tmpDir, "output.mp4");

    logger.info("[BrowserEngine] Running FFmpeg batch composite...");

    const batches: Array<typeof segments> = [];
    for (let i = 0; i < segments.length; i += MAX_BATCH_OVERLAYS) {
      batches.push(segments.slice(i, i + MAX_BATCH_OVERLAYS));
    }

    const segmentFiles: string[] = [];

    for (let b = 0; b < batches.length; b++) {
      const batch      = batches[b];
      const batchStart = batch[0].startSec;
      const batchEnd   = batches[b + 1] ? batches[b + 1][0].startSec
        : batch[batch.length - 1].endSec;
      const batchDur   = batchEnd - batchStart;
      const segOut     = path.join(tmpDir, `seg_${String(b).padStart(3, "0")}.mp4`);

      const extraInputs: string[] = [];
      const filterParts: string[] = [];
      let prevLabel = "[base]";

      batch.forEach(({ pngPath, startSec, endSec }, i) => {
        const relStart = (startSec - batchStart).toFixed(3);
        const relEnd   = (endSec   - batchStart).toFixed(3);
        const inLabel  = `[cap${i}]`;
        const outLabel = i < batch.length - 1 ? `[ov${i}]` : "[out]";
        extraInputs.push("-i", pngPath);
        // PNG was rendered at videoDims.width × videoDims.height — scale is a no-op
        // but we keep it explicit so any resize from a re-encode round-trip is corrected.
        filterParts.push(`[${i + 1}:v]scale=${videoDims.width}:${videoDims.height}${inLabel}`);
        filterParts.push(
          `${prevLabel}${inLabel}overlay=0:0:enable='between(t,${relStart},${relEnd})'${outLabel}`,
        );
        prevLabel = outLabel;
      });

      const fullFilter = `[0:v]setpts=PTS-STARTPTS[base]; ${filterParts.join("; ")}`;

      await execFileAsync("ffmpeg", [
        "-ss", String(batchStart),
        "-t",  String(batchDur),
        "-i",  videoPath,
        ...extraInputs,
        "-filter_complex", fullFilter,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "21",
        "-c:a", "aac",
        "-b:a", "128k",
        "-y", segOut,
      ], { maxBuffer: 100 * 1024 * 1024 });

      segmentFiles.push(segOut);
      logger.debug({ batch: b + 1, total: batches.length }, "[BrowserEngine] Batch done");
    }

    // Concatenate all segments
    const segListPath = path.join(tmpDir, "seg_list.txt");
    await fs.writeFile(segListPath, segmentFiles.map((f) => `file '${f}'`).join("\n"));

    await execFileAsync("ffmpeg", [
      "-f", "concat",
      "-safe", "0",
      "-i", segListPath,
      "-c", "copy",
      "-y", outputPath,
    ], { maxBuffer: 200 * 1024 * 1024 });

    logger.info("[BrowserEngine] FFmpeg composite done");

    // ── 8. Upload to Object Storage (same GCS pattern as caption-engine.ts) ─
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — Object Storage not provisioned");
    }

    const gcsObjectName = `captioned-videos/browser_${runId}.mp4`;
    const bucket        = objectStorageClient.bucket(bucketId);
    const gcsFile       = bucket.file(gcsObjectName);

    const fileBuffer = await fs.readFile(outputPath);
    await gcsFile.save(fileBuffer, { contentType: "video/mp4" });

    // Serve through the API proxy route (public access prevention is enforced on bucket)
    const domain = process.env.REPLIT_DEV_DOMAIN;
    if (!domain) throw new Error("REPLIT_DEV_DOMAIN not set — cannot build captioned video URL");
    const url = `https://${domain}/api/captioned-objects/${gcsObjectName}`;

    logger.info({ gcsObjectName, url }, "[BrowserEngine] Captioned video uploaded ✓");

    // Cleanup tmp files (fire-and-forget — don't block return)
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    return { url };

  } catch (err) {
    logger.error({ err, templateId }, "[BrowserEngine] Render failed");
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return {
      url:   null,
      error: `[BrowserEngine] ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Diagnostic helpers ────────────────────────────────────────────────────────

/**
 * Render a single sample frame for a template (used by the diagnostic endpoint).
 * Returns a PNG buffer if canvas is available, or an error description.
 */
export async function renderDiagnosticFrame(
  templateId: string,
  words?: string[],
): Promise<
  | { ok: true; png: Buffer; template: CaptionTemplate }
  | { ok: false; reason: string }
> {
  const canvas = await loadCanvas();
  if (!canvas) {
    return { ok: false, reason: "@napi-rs/canvas not available on this platform" };
  }

  const template = getBrowserTemplate(templateId);
  if (!template) {
    return { ok: false, reason: `Unknown template: "${templateId}"` };
  }

  // Demo cue — caller can override words (useful for overflow tests)
  const demoCue: CaptionCue = {
    index:           1,
    startMs:         0,
    endMs:           1000,
    words:           (words ?? ["TU", "MARCA", "VENDE"]).map(t => ({ text: t })),
    activeWordIndex: 0,
  };

  try {
    const png = await renderCueFrame(canvas, template, demoCue);
    return { ok: true, png, template };
  } catch (err) {
    return {
      ok:     false,
      reason: `Render error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
