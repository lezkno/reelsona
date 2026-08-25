import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

import {
  captionHorizontalMargins,
  formatWord,
  getBaselineY,
  scaleToHeight,
  type CaptionCue,
  type CaptionTemplate,
} from "@workspace/caption-templates";

import {
  buildHybridCaptionCompositePlan,
  buildHybridCaptionVideoOnlyPlan,
  FALLBACK_BATCH_CAPTION_OVERLAYS,
  MAX_SINGLE_PASS_CAPTION_OVERLAYS,
} from "./hybrid-caption-compositor.js";
import { buildHybridCaptionCues, clampHybridCueWindows } from "./hybrid-caption-cues.js";
import {
  assertCaptionOverlayTimelineIsExclusive,
  normalizeCaptionOverlayTimeline,
  type CaptionOverlaySegment,
} from "./hybrid-caption-timeline.js";
import type { WordTiming } from "./browser-caption-engine.js";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.join(moduleDir, "../assets/fonts");
const WORD_GAP_FACTOR = 0.18;

type CaptionFfmpegError = Error & {
  ffmpeg?: {
    stage: string;
    segmentCount: number;
    batchIndex?: number;
    batchCount?: number;
    exitCode?: string | number;
    signal?: string;
    killed?: boolean;
    stderr?: string;
  };
};

async function runCaptionFfmpeg(input: {
  stage: string;
  args: string[];
  segmentCount: number;
  batchIndex?: number;
  batchCount?: number;
  maxBuffer: number;
  timeout: number;
}): Promise<void> {
  try {
    await execFileAsync("ffmpeg", input.args, {
      maxBuffer: input.maxBuffer,
      timeout: input.timeout,
      killSignal: "SIGKILL",
    });
  } catch (error) {
    const candidate = error as {
      code?: string | number;
      signal?: string;
      killed?: boolean;
      stderr?: string | Buffer;
    };
    const contextualError = new Error(
      `FFmpeg ${input.stage} failed (segments=${input.segmentCount})`,
      { cause: error },
    ) as CaptionFfmpegError;
    contextualError.ffmpeg = {
      stage: input.stage,
      segmentCount: input.segmentCount,
      batchIndex: input.batchIndex,
      batchCount: input.batchCount,
      exitCode: candidate.code,
      signal: candidate.signal,
      killed: candidate.killed,
      stderr: candidate.stderr ? String(candidate.stderr).slice(-12_000) : undefined,
    };
    throw contextualError;
  }
}

const FUNCTION_WORDS = new Set([
  "el","la","los","las","un","una","unos","unas","al","del","yo","me","mi","tú","tu","te","él","ella","nosotros","ellos","se","nos","le","les","lo",
  "a","de","en","con","por","para","sobre","bajo","entre","desde","hasta","hacia","sin","tras","ante","según","durante","mediante",
  "y","e","o","pero","sino","aunque","también","más","solo","muy","que","cuando","porque","como","si","ya","ni","pues","así","tan",
  "este","esta","estos","estas","ese","esa","esos","esas","su","sus","es","son","fue","era","han","hay","ser","estar","ha","he","había",
  "i","me","my","you","your","he","him","his","she","her","it","its","we","us","our","they","them","their","a","an","the","this","that","these","those",
  "and","but","or","so","yet","nor","because","when","if","as","which","who","while","although","though","in","on","at","to","for","of","by","with","from","into","up","out",
]);

type CanvasModule = typeof import("@napi-rs/canvas");
let canvasPromise: Promise<CanvasModule> | null = null;

async function loadCanvas(): Promise<CanvasModule> {
  if (canvasPromise) return canvasPromise;
  canvasPromise = (async () => {
    const mod = await import("@napi-rs/canvas");
    const fontFiles = [
      ["Oswald-Bold.ttf", "Oswald"],
      ["Poppins-ExtraBold.ttf", "Poppins"],
      ["Bangers-Regular.ttf", "Bangers"],
      ["Montserrat-Black.ttf", "Montserrat"],
      ["Montserrat-BlackItalic.ttf", "Montserrat"],
    ] as const;
    for (const [file, family] of fontFiles) {
      const fontPath = path.join(fontsDir, file);
      try {
        await fs.access(fontPath);
        mod.GlobalFonts.registerFromPath(fontPath, family);
      } catch {
        // Missing optional font is surfaced later by Canvas fallback metrics.
      }
    }
    return mod;
  })();
  return canvasPromise;
}

function wrappedLines(measurements: number[], gap: number, width: number) {
  const lines: Array<{ indices: number[]; width: number }> = [];
  let indices: number[] = [];
  let currentWidth = 0;
  for (let index = 0; index < measurements.length; index++) {
    const wordWidth = measurements[index];
    const nextGap = indices.length ? gap : 0;
    if (indices.length && currentWidth + nextGap + wordWidth > width) {
      lines.push({ indices, width: currentWidth });
      indices = [index];
      currentWidth = wordWidth;
    } else {
      indices.push(index);
      currentWidth += nextGap + wordWidth;
    }
  }
  if (indices.length) lines.push({ indices, width: currentWidth });
  return lines;
}

async function renderCuePng(input: {
  canvas: CanvasModule;
  template: CaptionTemplate;
  cue: CaptionCue;
  width: number;
  height: number;
  revealedWords?: number;
  zoomScale?: number;
}): Promise<Buffer> {
  const { canvas, template, cue, width, height } = input;
  const cvs = canvas.createCanvas(width, height);
  const ctx = cvs.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const baseFontSize = Math.max(1, Math.round(scaleToHeight(template.fontSize, height)));
  const outline = scaleToHeight(template.outlineWidth, height);
  const shadowX = scaleToHeight(template.shadowOffsetX, height);
  const shadowY = scaleToHeight(template.shadowOffsetY, height);
  const shadowBlur = scaleToHeight(template.shadowBlur, height);
  const baselineY = getBaselineY(template, height);
  const maxWidthPercent = 100 - template.marginXPercent * 2;
  const horizontal = captionHorizontalMargins(maxWidthPercent, template.xPercent ?? 50, width);

  const visibleWords = input.revealedWords === undefined ? cue.words : cue.words.slice(0, input.revealedWords);
  const words = visibleWords.map((word) => formatWord(word.text, template));
  const phraseMode = cue.activeWordIndex === -1;

  const measure = (fontSize: number) => words.map((word, index) => {
    const active = index === cue.activeWordIndex;
    const mixedSmall = template.highlightMode === "mixed" && FUNCTION_WORDS.has(word.toLowerCase());
    const scale = phraseMode ? 1 : mixedSmall ? 0.55 : template.highlightMode === "scale" && active ? template.activeWordScale : 1;
    ctx.font = `${template.fontWeight} ${Math.round(fontSize * scale)}px '${template.fontFamily}'`;
    return ctx.measureText(word).width;
  });

  let effectiveFontSize = baseFontSize;
  let measurements = measure(effectiveFontSize);
  const widest = measurements.length ? Math.max(...measurements) : 0;
  if (widest > horizontal.width && widest > 0) {
    effectiveFontSize = Math.max(1, Math.floor(effectiveFontSize * horizontal.width / widest));
    measurements = measure(effectiveFontSize);
  }

  const gap = Math.round(effectiveFontSize * WORD_GAP_FACTOR);
  const lineSpacing = Math.round(effectiveFontSize * template.lineHeight);
  const lines = template.stackWords
    ? measurements.map((wordWidth, index) => ({ indices: [index], width: wordWidth }))
    : wrappedLines(measurements, gap, horizontal.width);

  const zoomScale = input.zoomScale ?? 1;
  if (zoomScale !== 1) {
    ctx.save();
    ctx.translate(horizontal.center, baselineY);
    ctx.scale(zoomScale, zoomScale);
    ctx.translate(-horizontal.center, -baselineY);
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const y = baselineY - (lines.length - 1 - lineIndex) * lineSpacing;
    let x = Math.max(horizontal.left, Math.min(horizontal.center - line.width / 2, width - horizontal.right - line.width));

    if (template.backgroundMode === "line" && template.backgroundColor) {
      const padX = scaleToHeight(template.backgroundPaddingX, height);
      const padY = scaleToHeight(template.backgroundPaddingY, height);
      const radius = scaleToHeight(template.backgroundRadius, height);
      ctx.save();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = template.backgroundColor;
      ctx.beginPath();
      const boxX = x - padX;
      const boxY = y - effectiveFontSize * 0.85 - padY;
      const boxW = line.width + padX * 2;
      const boxH = effectiveFontSize * 1.25 + padY * 2;
      if (radius > 0 && "roundRect" in ctx) (ctx as any).roundRect(boxX, boxY, boxW, boxH, radius);
      else ctx.rect(boxX, boxY, boxW, boxH);
      ctx.fill();
      ctx.restore();
    }

    for (const wordIndex of line.indices) {
      const word = words[wordIndex];
      const active = phraseMode || wordIndex === cue.activeWordIndex;
      const mixedSmall = !phraseMode && template.highlightMode === "mixed" && FUNCTION_WORDS.has(word.toLowerCase());
      const wordScale = phraseMode ? 1 : mixedSmall ? 0.55 : template.highlightMode === "scale" && active ? template.activeWordScale : 1;
      const fontSize = Math.round(effectiveFontSize * wordScale);
      const color = template.highlightMode === "mixed"
        ? mixedSmall ? template.primaryColor : template.activeWordColor
        : active ? template.activeWordColor : template.primaryColor;
      const alpha = active || template.highlightMode === "mixed" ? 1 : template.inactiveOpacity;
      const wordWidth = measurements[wordIndex];

      ctx.save();
      ctx.font = `${template.fontWeight} ${fontSize}px '${template.fontFamily}'`;
      ctx.textBaseline = "alphabetic";
      ctx.shadowColor = template.shadowColor;
      ctx.shadowOffsetX = shadowX;
      ctx.shadowOffsetY = shadowY;
      ctx.shadowBlur = shadowBlur;

      const wantsBox = template.backgroundColor && (
        template.backgroundMode === "word" || (template.backgroundMode === "active_word" && active)
      );
      if (wantsBox) {
        const padX = scaleToHeight(template.backgroundPaddingX, height);
        const padY = scaleToHeight(template.backgroundPaddingY, height);
        const radius = scaleToHeight(template.backgroundRadius, height);
        ctx.save();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = template.backgroundColor!;
        ctx.beginPath();
        const boxX = x - padX;
        const boxY = y - fontSize - padY;
        const boxW = wordWidth + padX * 2;
        const boxH = fontSize * 1.25 + padY * 2;
        if (radius > 0 && "roundRect" in ctx) (ctx as any).roundRect(boxX, boxY, boxW, boxH, radius);
        else ctx.rect(boxX, boxY, boxW, boxH);
        ctx.fill();
        ctx.restore();
      }

      ctx.globalAlpha = alpha;
      if (outline > 0) {
        ctx.strokeStyle = template.outlineColor;
        ctx.lineWidth = outline * 2;
        ctx.lineJoin = "round";
        ctx.strokeText(word, x, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(word, x, y);
      ctx.restore();
      x += wordWidth + gap;
    }
  }

  if (zoomScale !== 1) ctx.restore();
  return cvs.encode("png");
}

function quoteFfconcatPath(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

/**
 * A concat manifest exposes all Canvas PNGs as one FFmpeg input stream. This
 * avoids the memory blow-up from holding a full-resolution image stream for
 * every cue inside a long overlay chain.
 */
export function buildCaptionTrackManifest(input: {
  blankPngPath: string;
  segments: CaptionOverlaySegment[];
  durationSeconds: number;
}): string {
  const normalized = normalizeCaptionOverlayTimeline(input.segments);
  assertCaptionOverlayTimelineIsExclusive(normalized.segments);

  const entries: Array<{ pngPath: string; durationSec: number }> = [];
  let cursor = 0;
  const addEntry = (pngPath: string, durationSec: number) => {
    if (durationSec >= 0.001) entries.push({ pngPath, durationSec });
  };

  for (const segment of normalized.segments) {
    if (segment.startSec > cursor + 0.001) {
      addEntry(input.blankPngPath, segment.startSec - cursor);
    }
    addEntry(segment.pngPath, segment.endSec - segment.startSec);
    cursor = Math.max(cursor, segment.endSec);
  }

  addEntry(input.blankPngPath, Math.max(0, input.durationSeconds - cursor));

  const lines = ["ffconcat version 1.0"];
  for (const entry of entries) {
    lines.push(`file ${quoteFfconcatPath(entry.pngPath)}`);
    lines.push(`duration ${entry.durationSec.toFixed(6)}`);
  }

  // The concat demuxer uses the following file to honor the previous duration.
  // A transparent sentinel means that the last visible cue never leaks past
  // its intended end time.
  lines.push(`file ${quoteFfconcatPath(input.blankPngPath)}`);
  return `${lines.join("\n")}\n`;
}

export async function renderHybridCanvasCaptions(input: {
  pictureLockPath: string;
  outputPath: string;
  tmpDir: string;
  width: number;
  height: number;
  durationSeconds: number;
  timings: WordTiming[];
  template: CaptionTemplate;
}): Promise<{
  segmentCount: number;
  overlapFixes: number;
  sourceMode: "phrase" | "word";
  compositionMode: "single_pass" | "batch_fallback";
  pngGenerationMs: number;
  compositionMs: number;
  videoEncodeCount: number;
}> {
  const canvas = await loadCanvas();
  const pngStartedAt = Date.now();
  const cuePlan = buildHybridCaptionCues(input.timings, input.template);
  const cues = clampHybridCueWindows(cuePlan.cues);
  const rawSegments: CaptionOverlaySegment[] = [];

  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    const nextStart = cues[index + 1]?.startMs ?? cue.endMs;
    const endMs = Math.min(cue.endMs, nextStart);
    if (endMs <= cue.startMs) continue;

    const isZoom = input.template.animation === "zoom";
    const isTypewriter = input.template.animation === "typewriter" && cue.words.length > 1;

    if (isZoom) {
      const steps = [0.65, 0.82, 1] as const;
      const animationMs = Math.min(input.template.animationDuration || 180, (endMs - cue.startMs) * 0.4);
      const perStep = animationMs / steps.length;
      for (let step = 0; step < steps.length; step++) {
        const startMs = cue.startMs + step * perStep;
        const stepEnd = step === steps.length - 1 ? endMs : Math.min(endMs, cue.startMs + (step + 1) * perStep);
        if (stepEnd <= startMs) continue;
        const pngPath = path.join(input.tmpDir, `hybrid_${String(index).padStart(4, "0")}_z${step}.png`);
        await fs.writeFile(pngPath, await renderCuePng({ canvas, template: input.template, cue, width: input.width, height: input.height, zoomScale: steps[step] }));
        rawSegments.push({ pngPath, startSec: startMs / 1000, endSec: stepEnd / 1000 });
      }
    } else if (isTypewriter) {
      const revealMs = Math.min(80, (endMs - cue.startMs) / Math.max(cue.words.length * 2, 1));
      for (let count = 1; count <= cue.words.length; count++) {
        const startMs = cue.startMs + (count - 1) * revealMs;
        const stepEnd = count === cue.words.length ? endMs : Math.min(endMs, cue.startMs + count * revealMs);
        if (stepEnd <= startMs) continue;
        const pngPath = path.join(input.tmpDir, `hybrid_${String(index).padStart(4, "0")}_w${count}.png`);
        await fs.writeFile(pngPath, await renderCuePng({ canvas, template: input.template, cue, width: input.width, height: input.height, revealedWords: count }));
        rawSegments.push({ pngPath, startSec: startMs / 1000, endSec: stepEnd / 1000 });
      }
    } else {
      const pngPath = path.join(input.tmpDir, `hybrid_${String(index).padStart(4, "0")}.png`);
      await fs.writeFile(pngPath, await renderCuePng({ canvas, template: input.template, cue, width: input.width, height: input.height }));
      rawSegments.push({ pngPath, startSec: cue.startMs / 1000, endSec: endMs / 1000 });
    }
  }

  const normalizedTimeline = normalizeCaptionOverlayTimeline(rawSegments);
  assertCaptionOverlayTimelineIsExclusive(normalizedTimeline.segments);
  const segments = normalizedTimeline.segments;
  const overlapFixes = normalizedTimeline.issues.filter((issue) => issue.reason === "overlap").length;

  const pngGenerationMs = Date.now() - pngStartedAt;
  const compositeStartedAt = Date.now();
  let compositionMode: "single_pass" | "batch_fallback" = "single_pass";
  let videoEncodeCount = 1;

  if (segments.length <= MAX_SINGLE_PASS_CAPTION_OVERLAYS) {
    const blankPngPath = path.join(input.tmpDir, "hybrid_transparent.png");
    const transparentCanvas = canvas.createCanvas(input.width, input.height);
    await fs.writeFile(blankPngPath, await transparentCanvas.encode("png"));

    const captionTrackManifestPath = path.join(input.tmpDir, "hybrid_captions.ffconcat");
    await fs.writeFile(captionTrackManifestPath, buildCaptionTrackManifest({
      blankPngPath,
      segments,
      durationSeconds: input.durationSeconds,
    }));

    const plan = buildHybridCaptionCompositePlan({
      pictureLockPath: input.pictureLockPath,
      captionTrackManifestPath,
      outputPath: input.outputPath,
      segments,
    });
    await runCaptionFfmpeg({
      stage: "caption_track_composite",
      args: plan.args,
      segmentCount: segments.length,
      maxBuffer: 500 * 1024 * 1024,
      timeout: 6 * 60_000,
    });
  } else {
    compositionMode = "batch_fallback";
    const batches: CaptionOverlaySegment[][] = [];
    for (let index = 0; index < segments.length; index += FALLBACK_BATCH_CAPTION_OVERLAYS) {
      batches.push(segments.slice(index, index + FALLBACK_BATCH_CAPTION_OVERLAYS));
    }

    // Shared transparent PNG for gap-filling in each batch manifest.
    const batchBlankPngPath = path.join(input.tmpDir, "hybrid_batch_transparent.png");
    const batchTransparentCanvas = canvas.createCanvas(input.width, input.height);
    await fs.writeFile(batchBlankPngPath, await batchTransparentCanvas.encode("png"));

    let videoPath = input.pictureLockPath;
    for (let index = 0; index < batches.length; index++) {
      const batchPath = path.join(input.tmpDir, `hybrid_caption_batch_${String(index).padStart(3, "0")}.mp4`);
      // Each batch uses a concat manifest over the full video duration so that
      // the batch overlay has exactly two FFmpeg inputs (manifest + video),
      // matching the stable single-pass strategy and avoiding per-cue infinite
      // PNG streams that exhaust FFmpeg resources at normal animated cue counts.
      const batchManifestPath = path.join(input.tmpDir, `hybrid_caption_batch_${String(index).padStart(3, "0")}.ffconcat`);
      await fs.writeFile(batchManifestPath, buildCaptionTrackManifest({
        blankPngPath: batchBlankPngPath,
        segments: batches[index],
        durationSeconds: input.durationSeconds,
      }));
      const batchPlan = buildHybridCaptionVideoOnlyPlan({
        videoPath,
        outputPath: batchPath,
        captionTrackManifestPath: batchManifestPath,
        segments: batches[index],
      });
      await runCaptionFfmpeg({
        stage: "caption_batch_composite",
        args: batchPlan.args,
        segmentCount: batches[index].length,
        batchIndex: index + 1,
        batchCount: batches.length,
        maxBuffer: 500 * 1024 * 1024,
        timeout: 6 * 60_000,
      });
      videoPath = batchPath;
    }

    await runCaptionFfmpeg({
      stage: "caption_batch_audio_mux",
      args: [
        "-i", videoPath,
        "-i", input.pictureLockPath,
        "-map", "0:v:0",
        "-map", "1:a?",
        "-c:v", "copy",
        "-c:a", "copy",
        "-movflags", "+faststart",
        "-y", input.outputPath,
      ],
      segmentCount: segments.length,
      batchCount: batches.length,
      maxBuffer: 200 * 1024 * 1024,
      timeout: 2 * 60_000,
    });
    videoEncodeCount = batches.length;
  }

  return {
    segmentCount: segments.length,
    overlapFixes,
    sourceMode: cuePlan.sourceMode,
    compositionMode,
    pngGenerationMs,
    compositionMs: Date.now() - compositeStartedAt,
    videoEncodeCount,
  };
}
