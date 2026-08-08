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

/** Reference video dimensions — HeyGen portrait format */
const VIDEO_WIDTH  = 1080;
const VIDEO_HEIGHT = 1920;

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

// ── Frame renderer ────────────────────────────────────────────────────────────

async function renderCueFrame(
  canvas: CanvasModule,
  template: CaptionTemplate,
  cue: CaptionCue,
): Promise<Buffer> {
  const cvs = canvas.createCanvas(VIDEO_WIDTH, VIDEO_HEIGHT);
  const ctx = cvs.getContext("2d");

  // Fully transparent background — the PNG is composited over the video
  ctx.clearRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

  // All template values are at VIDEO_HEIGHT reference; scale factor = 1.0 for actual render
  const scaleFactor = 1.0;
  const fontSize    = Math.round(scaleToHeight(template.fontSize, VIDEO_HEIGHT));
  const outlineW    = scaleToHeight(template.outlineWidth, VIDEO_HEIGHT);
  const shadowX     = scaleToHeight(template.shadowOffsetX, VIDEO_HEIGHT);
  const shadowY     = scaleToHeight(template.shadowOffsetY, VIDEO_HEIGHT);
  const shadowBlur  = scaleToHeight(template.shadowBlur, VIDEO_HEIGHT);
  const baselineY   = getBaselineY(template, VIDEO_HEIGHT);
  const marginX     = getSafeMarginX(template, VIDEO_WIDTH);
  const wordGap     = Math.round(fontSize * WORD_GAP_FACTOR);

  // Format words (apply uppercase if template requires it)
  const displayWords = cue.words.map((w) => formatWord(w.text, template));

  // Pre-measure all words to compute total width for centering
  const measurements: number[] = displayWords.map((word, i) => {
    const isActive    = i === cue.activeWordIndex;
    const wordScale   = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
    const wordFontSz  = Math.round(fontSize * wordScale);
    ctx.font = `${template.fontWeight} ${wordFontSz}px '${template.fontFamily}'`;
    return ctx.measureText(word).width;
  });

  const totalWidth = measurements.reduce(
    (sum, w, i) => sum + w + (i < measurements.length - 1 ? wordGap : 0),
    0,
  );

  // Clamp starting X to safe area
  let x = Math.max(marginX, (VIDEO_WIDTH - totalWidth) / 2);

  // Draw each word
  displayWords.forEach((word, i) => {
    const isActive   = i === cue.activeWordIndex;
    const wordScale  = isActive && template.highlightMode === "scale" ? template.activeWordScale : 1.0;
    const wordFontSz = Math.round(fontSize * wordScale);
    const color      = isActive ? template.activeWordColor : template.primaryColor;
    const alpha      = isActive ? 1.0 : template.inactiveOpacity;
    const wordWidth  = measurements[i];

    ctx.save();

    ctx.font          = `${template.fontWeight} ${wordFontSz}px '${template.fontFamily}'`;
    ctx.textBaseline  = "alphabetic";

    // Shadow (applies to stroke + fill — set before both draws)
    ctx.shadowColor   = template.shadowColor;
    ctx.shadowOffsetX = shadowX;
    ctx.shadowOffsetY = shadowY;
    ctx.shadowBlur    = shadowBlur;

    // Word background box
    if (template.backgroundMode === "word" && template.backgroundColor) {
      const padX = scaleToHeight(template.backgroundPaddingX, VIDEO_HEIGHT);
      const padY = scaleToHeight(template.backgroundPaddingY, VIDEO_HEIGHT);
      const r    = scaleToHeight(template.backgroundRadius,   VIDEO_HEIGHT);
      ctx.save();
      ctx.shadowColor = "transparent";
      ctx.fillStyle   = template.backgroundColor;
      const boxX = x - padX;
      const boxY = baselineY - wordFontSz - padY;
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

    // Stroke outline — drawn first so fill covers the inner half
    // (equivalent to CSS `paint-order: stroke fill`)
    if (outlineW > 0) {
      ctx.strokeStyle = template.outlineColor;
      ctx.lineWidth   = outlineW * 2;   // ×2: half gets covered by fill → net outward stroke = outlineW
      ctx.lineJoin    = "round";
      ctx.globalAlpha = alpha;
      ctx.strokeText(word, x, baselineY);
    }

    // Fill
    ctx.fillStyle   = color;
    ctx.globalAlpha = alpha;
    ctx.fillText(word, x, baselineY);

    ctx.restore();
    x += wordWidth + wordGap;
  });

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
  opts?: { subtitleUrl?: string; videoDurationSeconds?: number },
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
  const template = getBrowserTemplate(templateId);
  logger.info({ templateFound: !!template, templateId }, "[BrowserEngine] template check");
  if (!template) {
    const err = `[BrowserEngine] Unknown template id: "${templateId}"`;
    logger.warn(err);
    return { url: null, error: err };
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
      const png    = await renderCueFrame(canvas, template, cue);
      const pngPath = path.join(tmpDir, `cue_${String(i).padStart(4, "0")}.png`);
      await fs.writeFile(pngPath, png);
      segments.push({
        pngPath,
        startSec: cue.startMs / 1000,
        endSec:   endMs / 1000,
      });
    }

    logger.info({ count: segments.length }, "[BrowserEngine] Frames rendered");

    // ── 7. Composite frames onto video via FFmpeg ─────────────────────────
    // Build a filter_complex chain: each PNG overlaid for its time window.
    // FFmpeg handles filter chains of 400+ nodes reliably.
    const outputPath = path.join(tmpDir, "output.mp4");

    const extraInputs: string[] = [];
    const filterParts: string[] = [];
    let prevLabel = "[0:v]";

    segments.forEach(({ pngPath, startSec, endSec }, i) => {
      extraInputs.push("-i", pngPath);
      const outLabel = i < segments.length - 1 ? `[ov${i}]` : "[vout]";
      filterParts.push(
        `${prevLabel}[${i + 1}:v]overlay=0:0:enable='between(t,${startSec.toFixed(3)},${endSec.toFixed(3)})'${outLabel}`,
      );
      prevLabel = outLabel;
    });

    const filterComplex = filterParts.join("; ");

    logger.info("[BrowserEngine] Running FFmpeg composite...");

    await execFileAsync(
      "ffmpeg",
      [
        "-i", videoPath,
        ...extraInputs,
        "-filter_complex", filterComplex,
        "-map", "[vout]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "copy",
        "-y",
        outputPath,
      ],
      { maxBuffer: 200 * 1024 * 1024 },
    );

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

  // Demo cue: 3 words, middle one active
  const demoCue: CaptionCue = {
    index:           1,
    startMs:         0,
    endMs:           1000,
    words:           [{ text: "TU" }, { text: "MARCA" }, { text: "VENDE" }],
    activeWordIndex: 1,
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
