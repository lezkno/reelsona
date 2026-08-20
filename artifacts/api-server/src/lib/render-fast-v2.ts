/**
 * Render Fast V2
 *
 * One FFmpeg render for a finished talking-head video:
 * source normalization + punch zoom + B-roll image overlays + ASS/libass
 * captions. It deliberately has no text-card branch and never creates an MP4
 * for an individual effect.
 */

import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";

import {
  CAPTION_DIR,
  CAPTION_FONTS_DIR,
  buildCaptionArtifactsFromSrt,
  findPunchZoomTimestampsAI,
  generateBasicSRT,
  type CaptionResult,
  type CaptionStyle,
  type PunchWordTiming,
} from "./caption-engine";
import {
  analyzeBRollSegments,
  generateBRollImages,
  type BRollBillingContext,
  type BRollImageAsset,
} from "./broll-engine";
import { getCanonicalOrigin } from "./appOrigin";
import { getServerReadableMediaUrl, objectStorageClient } from "./objectStorage";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const ZOOM_DURATION_SEC = 3;
const ZOOM_FACTOR = 1.4;
const BROLL_FADE_SEC = 0.3;
const BROLL_OVERSCAN = 1.1;
export const RENDER_FAST_V2_ERROR_PREFIX = "Render Fast V2:";

export function isRenderFastV2Failure(errorMessage: string | null | undefined): boolean {
  return errorMessage?.startsWith(RENDER_FAST_V2_ERROR_PREFIX) === true;
}

type VideoInfo = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
  rotation: number;
};

export type RenderFastV2Options = {
  subtitleUrl?: string | null;
  videoDurationSeconds?: number | null;
  videoEffects?: { zoom?: boolean; ai_broll?: boolean; text_cards?: boolean } | null;
  visualSuggestions?: string | null;
  openaiApiKey?: string | null;
  brollBilling?: BRollBillingContext | null;
};

type FastGraphInput = {
  duration: number;
  fps: number;
  hasAudio: boolean;
  rotation: number;
  zoomTimestamps: number[];
  brollAssets: BRollImageAsset[];
  assPath: string;
};

type FastGraph = {
  inputArgs: string[];
  filterComplex: string;
  videoMap: string;
  audioMap: string;
};

function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function toEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function sanitizeZoomTimestamps(timestamps: number[], duration: number): number[] {
  const result: number[] = [];
  for (const timestamp of [...timestamps].sort((a, b) => a - b)) {
    if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp >= duration - 0.05) continue;
    const last = result.at(-1);
    if (last !== undefined && timestamp < last + ZOOM_DURATION_SEC) continue;
    result.push(timestamp);
  }
  return result;
}

function motionExpression(index: number, start: number, duration: number): { x: string; y: string } {
  const progress = `min(max((t-${start.toFixed(3)})/${Math.max(duration, 0.5).toFixed(3)},0),1)`;
  switch (index % 4) {
    case 0: return { x: `(in_w-out_w)*${progress}`, y: "(in_h-out_h)/2" };
    case 1: return { x: `(in_w-out_w)*(1-${progress})`, y: "(in_h-out_h)/2" };
    case 2: return { x: "(in_w-out_w)/2", y: `(in_h-out_h)*${progress}` };
    default: return { x: "(in_w-out_w)/2", y: `(in_h-out_h)*(1-${progress})` };
  }
}

/**
 * Pure graph builder used by the renderer and its regression tests. The first
 * input is always the avatar video; later inputs are looped B-roll PNGs.
 */
export function buildRenderFastV2Graph(input: FastGraphInput): FastGraph {
  const duration = Math.max(0.1, input.duration);
  const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30;
  const parts: string[] = [];
  const inputArgs: string[] = [];

  let sourceVideo = "[0:v]";
  if (input.rotation === 90 || input.rotation === -270) {
    parts.push(`${sourceVideo}transpose=1[srcrot]`);
    sourceVideo = "[srcrot]";
  } else if (input.rotation === 270 || input.rotation === -90) {
    parts.push(`${sourceVideo}transpose=2[srcrot]`);
    sourceVideo = "[srcrot]";
  } else if (Math.abs(input.rotation) === 180) {
    parts.push(`${sourceVideo}transpose=2,transpose=2[srcrot]`);
    sourceVideo = "[srcrot]";
  }

  const zoomTimestamps = sanitizeZoomTimestamps(input.zoomTimestamps, duration);
  const videoLabels: string[] = [];
  const audioLabels: string[] = [];
  let cursor = 0;
  const segments = [
    ...zoomTimestamps.flatMap((start) => {
      const normal = start - cursor > 0.05 ? [{ start: cursor, end: start, zoom: false }] : [];
      const zoomEnd = Math.min(start + ZOOM_DURATION_SEC, duration);
      cursor = zoomEnd;
      return [...normal, { start, end: zoomEnd, zoom: true }];
    }),
    ...(duration - cursor > 0.05 ? [{ start: cursor, end: duration, zoom: false }] : []),
  ];
  if (segments.length === 0) segments.push({ start: 0, end: duration, zoom: false });

  // A filter output may only be consumed once. Split the normalized avatar
  // before creating the trim branches for normal/zoom segments.
  const baseLabels = segments.map((_, index) => `[base${index}]`);
  parts.push(
    `${sourceVideo}scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,` +
    `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}[normalizedv]`,
  );
  parts.push(`[normalizedv]split=${segments.length}${baseLabels.join("")}`);

  const zoomWidth = toEven(OUTPUT_WIDTH * ZOOM_FACTOR);
  const zoomHeight = toEven(OUTPUT_HEIGHT * ZOOM_FACTOR);
  const cropX = Math.floor((zoomWidth - OUTPUT_WIDTH) / 2);
  const cropY = Math.round((zoomHeight - OUTPUT_HEIGHT) * 0.3);

  segments.forEach((segment, index) => {
    const end = segment.end >= duration - 0.05 ? "" : `:end=${segment.end.toFixed(4)}`;
    const videoLabel = `[segv${index}]`;
    const videoFilters = `${baseLabels[index]}trim=start=${segment.start.toFixed(4)}${end},setpts=PTS-STARTPTS` +
      (segment.zoom ? `,scale=${zoomWidth}:${zoomHeight},crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:${cropX}:${cropY}` : "") +
      // scale may recalculate SAR from the source aspect ratio. Every concat
      // input must have identical SAR, including the zoomed segments.
      ",setsar=1";
    parts.push(`${videoFilters}${videoLabel}`);
    videoLabels.push(videoLabel);

    if (input.hasAudio) {
      const audioLabel = `[sega${index}]`;
      parts.push(`[0:a]atrim=start=${segment.start.toFixed(4)}${end},asetpts=PTS-STARTPTS${audioLabel}`);
      audioLabels.push(audioLabel);
    }
  });

  let videoLabel: string;
  let audioLabel: string;
  if (input.hasAudio) {
    const interleaved = videoLabels.flatMap((label, index) => [label, audioLabels[index]]).join("");
    parts.push(`${interleaved}concat=n=${segments.length}:v=1:a=1[zoomv][zooma]`);
    videoLabel = "[zoomv]";
    audioLabel = "[zooma]";
  } else {
    parts.push(`${videoLabels.join("")}concat=n=${segments.length}:v=1:a=0[zoomv]`);
    parts.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration.toFixed(4)},asetpts=PTS-STARTPTS[zooma]`);
    videoLabel = "[zoomv]";
    audioLabel = "[zooma]";
  }

  input.brollAssets.forEach((asset, index) => {
    const inputIndex = index + 1;
    inputArgs.push("-loop", "1", "-framerate", String(fps), "-t", String(Math.ceil(duration + 1)), "-i", asset.tmpPath);
    const motion = motionExpression(index, asset.segment.startSec, asset.segment.durationSec);
    const overscanW = toEven(OUTPUT_WIDTH * BROLL_OVERSCAN);
    const overscanH = toEven(OUTPUT_HEIGHT * BROLL_OVERSCAN);
    const fadeOutStart = Math.max(
      asset.segment.startSec + BROLL_FADE_SEC,
      asset.segment.startSec + asset.segment.durationSec - BROLL_FADE_SEC,
    );
    const brollLabel = `[broll${index}]`;
    const nextLabel = index === input.brollAssets.length - 1 ? "[withbroll]" : `[overlay${index}]`;
    parts.push(
      `[${inputIndex}:v]scale=${overscanW}:${overscanH}:force_original_aspect_ratio=increase,` +
      `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:x='${motion.x}':y='${motion.y}',setsar=1,format=yuva420p,` +
      `fade=t=in:st=${asset.segment.startSec.toFixed(3)}:d=${BROLL_FADE_SEC}:alpha=1,` +
      `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${BROLL_FADE_SEC}:alpha=1${brollLabel}`,
    );
    parts.push(`${videoLabel}${brollLabel}overlay=0:0:eof_action=pass:shortest=1${nextLabel}`);
    videoLabel = nextLabel;
  });

  parts.push(
    `${videoLabel}ass='${escapeFilterPath(input.assPath)}':fontsdir='${escapeFilterPath(CAPTION_FONTS_DIR)}'[renderedv]`,
  );

  return {
    inputArgs,
    filterComplex: parts.join(";"),
    videoMap: "[renderedv]",
    audioMap: audioLabel,
  };
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await axios.get(await getServerReadableMediaUrl(url), {
    responseType: "arraybuffer",
    timeout: 120_000,
  });
  await fs.writeFile(destination, Buffer.from(response.data));
}

async function probeVideo(videoPath: string): Promise<VideoInfo> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=width,height,r_frame_rate,codec_type:stream_tags=rotate:stream_side_data=rotation:format=duration",
    "-of", "json",
    videoPath,
  ]);
  const parsed = JSON.parse(stdout) as { streams?: Array<any>; format?: { duration?: string } };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video") ?? {};
  const [fpsNum, fpsDen] = String(video.r_frame_rate ?? "30/1").split("/").map(Number);
  const sideRotation = Number(video.side_data_list?.[0]?.rotation ?? 0);
  return {
    width: Number(video.width) || OUTPUT_WIDTH,
    height: Number(video.height) || OUTPUT_HEIGHT,
    fps: fpsNum && fpsDen ? fpsNum / fpsDen : 30,
    duration: Math.max(0.1, Number(video.duration ?? parsed.format?.duration) || 60),
    hasAudio: parsed.streams?.some((stream) => stream.codec_type === "audio") ?? false,
    rotation: Number(video.tags?.rotate ?? 0) || -sideRotation || 0,
  };
}

async function resolveSrt(
  subtitleUrl: string | null | undefined,
  script: string | null,
  durationSeconds: number,
): Promise<string> {
  if (subtitleUrl) {
    try {
      const response = await axios.get<string>(await getServerReadableMediaUrl(subtitleUrl), {
        responseType: "text",
        timeout: 30_000,
      });
      if (response.data.trim()) return response.data;
    } catch (error) {
      logger.warn({ error }, "[RenderFastV2] Subtitle fetch failed — using script timing fallback");
    }
  }
  if (script) return generateBasicSRT(script, durationSeconds * 1000);
  throw new Error("No SRT source available (no subtitleUrl and no script)");
}

async function uploadOutput(outputPath: string, runId: string): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — Object Storage not provisioned");
  const objectName = `captioned-videos/fast-v2_${runId}.mp4`;
  await objectStorageClient.bucket(bucketId).file(objectName).save(await fs.readFile(outputPath), {
    contentType: "video/mp4",
  });
  return `${getCanonicalOrigin()}/api/captioned-objects/${objectName}`;
}

async function createThumbnail(outputPath: string, runId: string): Promise<string | null> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) return null;
  const thumbnailPath = path.join(path.dirname(outputPath), "thumbnail.jpg");
  try {
    await execFileAsync("ffmpeg", [
      "-ss", "1", "-i", outputPath, "-vframes", "1", "-vf", "scale=720:-2", "-q:v", "3", "-y", thumbnailPath,
    ], { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 });
    const objectName = `thumbnails/fast-v2_${runId}.jpg`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(await fs.readFile(thumbnailPath), {
      contentType: "image/jpeg",
    });
    return `${getCanonicalOrigin()}/api/captioned-objects/${objectName}`;
  } catch (error) {
    logger.warn({ error }, "[RenderFastV2] Thumbnail extraction failed (non-fatal)");
    return null;
  }
}

export function shouldUseRenderFastV2(renderer?: string | null): boolean {
  return renderer?.trim().toLowerCase() !== "legacy";
}

export function isRenderFastV2Enabled(): boolean {
  // Fast V2 is the permanent WaveSpeed renderer in every environment. The
  // legacy path remains an explicit emergency rollback only, never an opt-in.
  return shouldUseRenderFastV2(process.env.VIDEO_RENDERER);
}

export async function applyCaptionsFastV2(
  videoUrl: string,
  script: string | null,
  config: CaptionStyle,
  options?: RenderFastV2Options,
): Promise<CaptionResult> {
  const runStartedAt = Date.now();
  const runId = `fast_v2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const tmpDir = path.join(CAPTION_DIR, runId);
  const inputPath = path.join(tmpDir, "avatar.mp4");
  const assPath = path.join(tmpDir, "captions.ass");
  const outputPath = path.join(tmpDir, "final.mp4");
  const telemetry: Record<string, number> = {};

  try {
    await fs.mkdir(tmpDir, { recursive: true });

    let stageStartedAt = Date.now();
    await downloadFile(videoUrl, inputPath);
    telemetry.downloadAvatarMs = elapsedMs(stageStartedAt);

    const videoInfo = await probeVideo(inputPath);
    stageStartedAt = Date.now();
    const srt = await resolveSrt(options?.subtitleUrl, script, videoInfo.duration);
    const captions = buildCaptionArtifactsFromSrt(srt, config, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    await fs.writeFile(assPath, captions.ass, "utf8");
    telemetry.prepareCaptionsMs = elapsedMs(stageStartedAt);

    if (options?.videoEffects?.text_cards) {
      logger.warn("[RenderFastV2] Text Cards are legacy and intentionally excluded from this renderer");
    }

    // These independent preparations overlap so the final FFmpeg job waits only
    // for the resulting timings and images, never for serial AI requests.
    const zoomStartedAt = Date.now();
    const zoomPromise: Promise<number[]> = options?.videoEffects?.zoom && script
      ? findPunchZoomTimestampsAI(script, captions.wordTimings, videoInfo.duration, options.openaiApiKey)
      : Promise.resolve([]);
    const brollStartedAt = Date.now();
    const brollPromise: Promise<BRollImageAsset[]> = options?.videoEffects?.ai_broll && script
      ? analyzeBRollSegments(
          script,
          captions.wordTimings,
          videoInfo.duration,
          options.visualSuggestions,
          options.openaiApiKey,
        ).then((analysis) => generateBRollImages(
          analysis.segments,
          tmpDir,
          analysis.visualDirection,
          options.openaiApiKey,
          options.brollBilling,
        ))
      : Promise.resolve([]);
    const [zoomTimestamps, brollAssets] = await Promise.all([zoomPromise, brollPromise]);
    telemetry.detectPunchZoomMs = elapsedMs(zoomStartedAt);
    telemetry.generateBRollMs = elapsedMs(brollStartedAt);

    stageStartedAt = Date.now();
    const graph = buildRenderFastV2Graph({
      duration: videoInfo.duration,
      fps: videoInfo.fps,
      hasAudio: videoInfo.hasAudio,
      rotation: videoInfo.rotation,
      zoomTimestamps,
      brollAssets,
      assPath,
    });
    telemetry.buildFilterGraphMs = elapsedMs(stageStartedAt);

    const renderTimeoutMs = Math.min(
      12 * 60_000,
      Math.max(4 * 60_000, Math.ceil(videoInfo.duration * 15_000)),
    );
    stageStartedAt = Date.now();
    await execFileAsync("ffmpeg", [
      "-noautorotate",
      "-i", inputPath,
      ...graph.inputArgs,
      "-filter_complex", graph.filterComplex,
      "-map", graph.videoMap,
      "-map", graph.audioMap,
      "-t", videoInfo.duration.toFixed(4),
      "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      "-y", outputPath,
    ], { maxBuffer: 500 * 1024 * 1024, timeout: renderTimeoutMs });
    telemetry.renderFfmpegMs = elapsedMs(stageStartedAt);

    stageStartedAt = Date.now();
    const [url, thumbnailUrl] = await Promise.all([
      uploadOutput(outputPath, runId),
      createThumbnail(outputPath, runId),
    ]);
    telemetry.uploadFinalMs = elapsedMs(stageStartedAt);
    telemetry.totalMs = elapsedMs(runStartedAt);

    logger.info(
      {
        runId,
        input: `${videoInfo.width}x${videoInfo.height}`,
        output: `${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}`,
        durationSec: videoInfo.duration,
        zooms: sanitizeZoomTimestamps(zoomTimestamps, videoInfo.duration).length,
        brollAssets: brollAssets.length,
        ...telemetry,
      },
      "[RenderFastV2] Complete — one H.264 render",
    );
    return { url, thumbnailUrl };
  } catch (error) {
    telemetry.totalMs = elapsedMs(runStartedAt);
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error, runId, ...telemetry }, "[RenderFastV2] Failed — no automatic retry");
    return { url: null, error: `${RENDER_FAST_V2_ERROR_PREFIX} ${message}` };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((error) =>
      logger.warn({ error, tmpDir }, "[RenderFastV2] Temporary cleanup failed"),
    );
  }
}