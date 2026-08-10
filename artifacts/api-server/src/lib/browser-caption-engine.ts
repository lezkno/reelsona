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
import { fileURLToPath } from "url";
import axios from "axios";
import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";
import type { CaptionResult } from "./caption-engine";
import { CAPTION_DIR, buildPunchZoomArgs, findPunchZoomTimestampsAI } from "./caption-engine";
import { applyBRoll } from "./broll-engine";
import {
  BROWSER_CAPTION_TEMPLATES,
  getBrowserTemplate,
  buildCaptionCues,
  buildBuildingCues,
  formatWord,
  getBaselineY,
  getSafeMarginX,
  scaleToHeight,
} from "@workspace/caption-templates";
import type { CaptionTemplate, CaptionCue } from "@workspace/caption-templates";

const execFileAsync = promisify(execFile);

// ── Dimidium "mixed" mode — function words rendered small + white ─────────────
// Mirrors caption-engine.ts FUNCTION_WORDS. Content words (nouns, verbs,
// adjectives) → full size + activeWordColor. Function words → 55% size + primaryColor.
const BROWSER_FUNCTION_WORDS = new Set([
  // English pronouns / articles / conjunctions / prepositions / auxiliaries
  "i","me","my","you","your","he","him","his","she","her","it","its",
  "we","us","our","they","them","their",
  "a","an","the","this","that","these","those",
  "and","but","or","so","yet","nor","because","when","if","as",
  "which","who","while","although","though",
  "in","on","at","to","for","of","by","with","from","into","up","out",
  "about","over","under","after","before","between","through","without",
  "more","most","very","just","also","too","even","only","not","no",
  "is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might",
  // Spanish artículos / pronombres / preposiciones / conjunciones / auxiliares
  "el","la","los","las","un","una","unos","unas","al","del",
  "yo","me","mi","tú","tu","te","él","ella","nosotros","ellos","se","nos",
  "le","les","lo",
  "a","de","en","con","por","para","sobre","bajo","entre","desde",
  "hasta","hacia","sin","tras","ante","según","durante","mediante",
  "y","e","o","pero","sino","aunque","también","más","solo","muy",
  "que","cuando","porque","como","si","ya","ni","pues","así","tan",
  "este","esta","estos","estas","ese","esa","esos","esas","su","sus",
  "es","son","fue","era","han","hay","ser","estar","ha","he","había",
]);

// ── Constants ─────────────────────────────────────────────────────────────────

const _dir      = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(_dir, "../assets/fonts");

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
      { file: "Oswald-Bold.ttf",            family: "Oswald" },
      { file: "Oswald.ttf",                 family: "Oswald" },
      { file: "Poppins-ExtraBold.ttf",      family: "Poppins" },
      { file: "Bangers-Regular.ttf",        family: "Bangers" },
      { file: "Montserrat-Black.ttf",       family: "Montserrat" },
      { file: "Montserrat-BlackItalic.ttf", family: "Montserrat" },
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
async function probeVideoInfo(
  videoPath: string,
): Promise<{ width: number; height: number; fps: number; duration: number }> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",            "quiet",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      "-select_streams", "v:0",
      videoPath,
    ]);
    const data   = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number; r_frame_rate?: string; duration?: string }>;
      format?:  { duration?: string };
    };
    const stream = data.streams?.[0];
    const width  = stream?.width  ?? VIDEO_WIDTH_DEFAULT;
    const height = stream?.height ?? VIDEO_HEIGHT_DEFAULT;

    // Parse fps from "num/den" string, e.g. "30/1" or "30000/1001"
    let fps = 30;
    if (stream?.r_frame_rate) {
      const [num, den] = stream.r_frame_rate.split("/").map(Number);
      if (num && den) fps = Math.round(num / den);
    }

    // Duration from stream or format
    const durationStr = stream?.duration ?? data.format?.duration;
    const duration    = durationStr ? parseFloat(durationStr) : 60;

    return { width, height, fps, duration };
  } catch {
    return { width: VIDEO_WIDTH_DEFAULT, height: VIDEO_HEIGHT_DEFAULT, fps: 30, duration: 60 };
  }
}

// Keep the old name as a thin wrapper for backwards compat
async function probeVideoDimensions(
  videoPath: string,
): Promise<{ width: number; height: number }> {
  const { width, height } = await probeVideoInfo(videoPath);
  return { width, height };
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
  /** typewriter: show only the first N words of the cue (undefined = show all) */
  revealedWords?: number,
  /** zoom: scale factor 0–1 applied around the text anchor point (1.0 = full size) */
  zoomScale = 1.0,
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

  // Format words — typewriter: only show the first `revealedWords` words
  const visibleWords = revealedWords !== undefined
    ? cue.words.slice(0, revealedWords)
    : cue.words;
  const displayWords = visibleWords.map((w) => formatWord(w.text, template));

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
      const isActive = i === cue.activeWordIndex;
      const wordScale =
        template.highlightMode === "scale" ? (isActive ? template.activeWordScale : 1.0)
        : template.highlightMode === "mixed" ? (BROWSER_FUNCTION_WORDS.has(word.toLowerCase()) ? 0.55 : 1.0)
        : 1.0;
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

  // Wrap words into lines — or force 1 word per line when stackWords: true
  const lines = template.stackWords
    ? measurements.map((w, i) => ({ wordIndices: [i], lineWidth: w }))
    : buildWrappedLines(measurements, wordGapScaled, availableW);

  // Zoom animation: scale the entire text block around its anchor point
  if (zoomScale !== 1.0) {
    ctx.save();
    ctx.translate(videoW / 2, baselineY);
    ctx.scale(zoomScale, zoomScale);
    ctx.translate(-videoW / 2, -baselineY);
  }

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
      const isMixed    = template.highlightMode === "mixed";
      const isFuncWord = isMixed && BROWSER_FUNCTION_WORDS.has(word.toLowerCase());
      const wordScale  =
        template.highlightMode === "scale" ? (isActive ? template.activeWordScale : 1.0)
        : isMixed ? (isFuncWord ? 0.55 : 1.0)
        : 1.0;
      const wordFontSz = Math.round(effectiveFontSize * wordScale);
      const color      = isMixed
        ? (isFuncWord ? template.primaryColor : template.activeWordColor)
        : (isActive ? template.activeWordColor : template.primaryColor);
      const alpha      = isMixed ? 1.0 : (isActive ? 1.0 : template.inactiveOpacity);
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

  if (zoomScale !== 1.0) ctx.restore();

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

// ── Punch zoom helpers ────────────────────────────────────────────────────────

const EMPHASIS_RE = /\b(importante|recuerda|clave|fundamental|esencial|nunca|siempre|crítico|atención|ojo|fíjate|escucha|mira|básico|necesario|obligatorio|imprescindible)\b/i;

/**
 * Analyse the script + SRT word timings to find timestamps (in seconds) where
 * a punch-zoom should fire.  Scores each sentence for emphasis signals (!,
 * keywords, length) and maps the winner to its SRT start time.
 * Falls back to proportional timestamps when word timings are unavailable.
 */
export function findPunchZoomTimestamps(
  script: string,
  wordTimings: WordTiming[],
  videoDuration: number,
  maxZooms = 3,
): number[] {
  // ── sentence scoring ──────────────────────────────────────────────────────
  const rawSentences = (script.match(/[^.!?\n]+[.!?]*/g) ?? [])
    .map(s => s.trim())
    .filter(s => s.length >= 12);

  const scored = rawSentences.map((text, idx) => {
    const wc    = text.split(/\s+/).length;
    let score   = 0;
    if (text.includes("!"))          score += 4;
    if (EMPHASIS_RE.test(text))      score += 3;
    if (wc >= 4 && wc <= 14)         score += 1;
    if (idx < rawSentences.length * 0.15) score -= 2; // skip intro
    return { text, score, idx };
  });

  // Sort by score descending; secondary: earlier is preferred
  const top = scored.sort((a, b) => b.score - a.score || a.idx - b.idx).slice(0, maxZooms);

  // ── map sentences → timestamps ────────────────────────────────────────────
  const timestamps: number[] = [];

  if (wordTimings.length > 0) {
    for (const sentence of top) {
      // Try the first 3 meaningful words of the sentence to find an SRT match
      const words = sentence.text
        .replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 3);

      for (const word of words) {
        const norm = word.toLowerCase();
        const hit  = wordTimings.find(wt =>
          wt.text.toLowerCase().replace(/[^a-záéíóúüñ]/g, "") === norm.replace(/[^a-záéíóúüñ]/g, ""),
        );
        if (hit) {
          timestamps.push(hit.startMs / 1000);
          break;
        }
      }
    }
  }

  // ── proportional fallback ─────────────────────────────────────────────────
  if (timestamps.length === 0) {
    // Evenly spread 2 punch zooms at 30% and 65% of duration
    return [0.30, 0.65]
      .map(f => videoDuration * f)
      .filter(t => t < videoDuration - 4);
  }

  // ── deduplicate: min 8 s apart, not in first 3 s, not in last 4 s ─────────
  return timestamps
    .sort((a, b) => a - b)
    .filter((t, i, arr) => {
      if (t < 3)                    return false;
      if (t > videoDuration - 4)    return false;
      if (i > 0 && t - arr[i-1] < 8) return false;
      return true;
    });
}

// buildPunchZoomArgs is exported from caption-engine and shared by both engines
export { buildPunchZoomArgs } from "./caption-engine";

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
    /** Per-template style overrides from Caption Studio advanced settings. Applied on top of the base template. */
    templateOverrides?: Partial<CaptionTemplate>;
    /** Video effects to apply before caption compositing (e.g. Ken Burns zoom, B-roll, text cards). */
    videoEffects?: { zoom?: boolean; ai_broll?: boolean; text_cards?: boolean } | null;
    /** AI-generated visual suggestions for this content item (from suggestedVisualSupport column). */
    visualSuggestions?: string | null;
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

  // Apply user overrides: first style tweaks from Caption Studio, then position
  const styleOverrides: Partial<CaptionTemplate> = opts?.templateOverrides ?? {};
  const template: CaptionTemplate = {
    ...baseTemplate,
    ...styleOverrides,
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

    // ── 3b. Probe actual video info ───────────────────────────────────────
    // CRITICAL: PNGs must be rendered at the source video's native resolution.
    // Rendering at hardcoded 1080×1920 while the video is 720×1280 causes
    // FFmpeg overlay to clip the PNG at 1280px — text at y=83% of 1920=1593px
    // is invisible. Probing and matching ensures pixel-perfect compositing.
    const videoInfo = await probeVideoInfo(videoPath);
    const videoDims = { width: videoInfo.width, height: videoInfo.height };
    logger.info(videoInfo, "[BrowserEngine] Video dimensions probed");

    // ── 4. Gather word timings (moved before zoom — needed for punch-zoom detection)
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

    // ── 3c. Punch zoom pre-process (optional) ────────────────────────────────
    // Quick zoom-in toward the avatar's face at the most impactful sentences:
    //   • 0.35 s ramp in (1.0× → 1.4×)
    //   • 2.3 s hold at peak zoom
    //   • 0.35 s ramp out (1.4× → 1.0×)
    // Total: ~3 s per event, typically 2-3 events per video.
    // Uses zoompan with t-based expressions so timing is driven by real PTS,
    // not a fragile frame counter.
    let captionSourcePath = videoPath;
    if (opts?.videoEffects?.zoom && script) {
      const punchTs   = await findPunchZoomTimestampsAI(script, wordTimings, videoInfo.duration);
      const punchArgs = buildPunchZoomArgs(punchTs, videoInfo.duration, videoInfo.width, videoInfo.height);
      if (punchArgs) {
        const zoomedPath = path.join(tmpDir, "zoomed.mp4");
        logger.info({ punchTs }, "[BrowserEngine] Applying punch zoom at timestamps");
        await execFileAsync("ffmpeg", [
          "-i", videoPath,
          ...punchArgs,
          "-c:v", "libx264", "-preset", "fast", "-crf", "21",
          "-c:a", "aac", "-b:a", "192k",
          "-movflags", "+faststart",
          "-y", zoomedPath,
        ], { maxBuffer: 500 * 1024 * 1024 });
        captionSourcePath = zoomedPath;
        logger.info({ count: punchTs.length }, "[BrowserEngine] Punch zoom applied ✓");
      }
    }

    // ── 3d. B-Roll overlay (optional) ─────────────────────────────────────
    // AI generates vertical 9:16 images matching the spoken content at each
    // selected moment and composites them over the video with a crossfade.
    // Runs AFTER zoom so the zoom effect applies to the avatar segments,
    // and BEFORE caption compositing so captions render on top of B-roll.
    if (opts?.videoEffects?.ai_broll && script) {
      logger.info("[BrowserEngine] Applying AI B-roll overlay...");
      captionSourcePath = await applyBRoll(
        captionSourcePath,
        script,
        wordTimings,
        videoInfo.width,
        videoInfo.height,
        videoInfo.duration,
        tmpDir,
        opts.visualSuggestions,
      );
      logger.info("[BrowserEngine] B-roll overlay done ✓");
    }

    // ── 3e. Text cards overlay (hook / stat / CTA) ────────────────────────
    // Runs AFTER B-roll and BEFORE caption compositing so captions sit on top.
    if (opts?.videoEffects?.text_cards && script) {
      logger.info("[BrowserEngine] Applying text cards overlay...");
      const { applyTextCards } = await import("./text-cards-engine");
      const cardsTmpDir = path.join(tmpDir, "textcards");
      await (await import("fs/promises")).mkdir(cardsTmpDir, { recursive: true });
      captionSourcePath = await applyTextCards(
        captionSourcePath,
        script,
        videoInfo.width,
        videoInfo.height,
        videoInfo.duration,
        cardsTmpDir,
      );
      logger.info("[BrowserEngine] Text cards overlay done ✓");
    }

    // ── 5. Build CaptionCues ──────────────────────────────────────────────
    // Building mode: each word gets its own cue showing all words accumulated
    // so far in the block → natural word-by-word reveal, no sub-frames needed.
    const allCues = template.buildingMode
      ? buildBuildingCues(wordTimings, template)
      : buildCaptionCues(wordTimings, template);
    const cues    = allCues.slice(0, MAX_CUES);

    if (cues.length < allCues.length) {
      logger.warn(
        { total: allCues.length, used: cues.length, limit: MAX_CUES },
        "[BrowserEngine] Cue count exceeds limit — truncating",
      );
    }

    logger.info({ cueCount: cues.length }, "[BrowserEngine] Rendering PNG frames...");

    // ── 6. Render PNG frames ──────────────────────────────────────────────
    // Typewriter templates get word-by-word sub-frames on each new window.
    // Building mode templates already have one cue per word — no sub-frames.
    const segments: Array<{ pngPath: string; startSec: number; endSec: number }> = [];
    const isTypewriter = template.animation === "typewriter" && !template.buildingMode;
    const isZoom       = template.animation === "zoom";
    let prevWordsKey   = "";

    for (let i = 0; i < cues.length; i++) {
      const cue    = cues[i];
      const endMs  = i + 1 < cues.length ? cues[i + 1].startMs : cue.endMs;
      const cueDur = endMs - cue.startMs;
      const wordsKey = cue.words.map((w) => w.text).join(",");
      const isNewWindow = wordsKey !== prevWordsKey;
      prevWordsKey = wordsKey;

      if (isZoom && isNewWindow) {
        // Zoom-in animation: 3 sub-frames scaling from 65% → 82% → 100%
        // Each sub-frame lasts ~60ms (capped at 40% of the word duration)
        const ZOOM_STEPS  = [0.65, 0.82, 1.0] as const;
        const zoomDur     = Math.min(180, cueDur * 0.40);
        const msPerStep   = zoomDur / ZOOM_STEPS.length;

        for (let s = 0; s < ZOOM_STEPS.length - 1; s++) {
          const subPng  = await renderCueFrame(canvas, template, cue, videoDims.width, videoDims.height, undefined, ZOOM_STEPS[s]);
          const subPath = path.join(tmpDir, `cue_${String(i).padStart(4, "0")}_z${s}.png`);
          await fs.writeFile(subPath, subPng);
          segments.push({
            pngPath:  subPath,
            startSec: (cue.startMs + s * msPerStep) / 1000,
            endSec:   (cue.startMs + (s + 1) * msPerStep) / 1000,
          });
        }
        // Full-size frame held for the rest of the cue
        const fullPng  = await renderCueFrame(canvas, template, cue, videoDims.width, videoDims.height);
        const fullPath = path.join(tmpDir, `cue_${String(i).padStart(4, "0")}.png`);
        await fs.writeFile(fullPath, fullPng);
        segments.push({
          pngPath:  fullPath,
          startSec: (cue.startMs + (ZOOM_STEPS.length - 1) * msPerStep) / 1000,
          endSec:    endMs / 1000,
        });

      } else if (isTypewriter && isNewWindow && cue.words.length > 1) {
        // Word-by-word reveal at the start of each new visible window
        const numWords   = cue.words.length;
        const msPerWord  = Math.min(80, cueDur / (numWords * 2));

        for (let w = 1; w < numWords; w++) {
          const subPng  = await renderCueFrame(canvas, template, cue, videoDims.width, videoDims.height, w);
          const subPath = path.join(tmpDir, `cue_${String(i).padStart(4, "0")}_w${w}.png`);
          await fs.writeFile(subPath, subPng);
          segments.push({
            pngPath:  subPath,
            startSec: (cue.startMs + (w - 1) * msPerWord) / 1000,
            endSec:   (cue.startMs +  w      * msPerWord) / 1000,
          });
        }

        // Full cue held for the rest of the window's duration
        const fullPng  = await renderCueFrame(canvas, template, cue, videoDims.width, videoDims.height);
        const fullPath = path.join(tmpDir, `cue_${String(i).padStart(4, "0")}.png`);
        await fs.writeFile(fullPath, fullPng);
        segments.push({
          pngPath:  fullPath,
          startSec: (cue.startMs + (numWords - 1) * msPerWord) / 1000,
          endSec:    endMs / 1000,
        });
      } else {
        // Standard: one PNG per cue
        const png     = await renderCueFrame(canvas, template, cue, videoDims.width, videoDims.height);
        const pngPath = path.join(tmpDir, `cue_${String(i).padStart(4, "0")}.png`);
        await fs.writeFile(pngPath, png);
        segments.push({
          pngPath,
          startSec: cue.startMs / 1000,
          endSec:   endMs / 1000,
        });
      }
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
        "-i",  captionSourcePath,
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
