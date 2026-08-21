import path from "path";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";

import type { CaptionTemplate } from "@workspace/caption-templates";

import {
  CAPTION_DIR,
  findPunchZoomTimestampsAI,
  generateBasicSRT,
  type CaptionResult,
} from "./caption-engine.js";
import {
  analyzeBRollSegments,
  generateBRollImages,
  type BRollBillingContext,
} from "./broll-engine.js";
import { parseSRT, buildFallbackTimings, type WordTiming } from "./browser-caption-engine.js";
import { buildRenderFastV2Graph, getRenderFastV2TimeoutMs } from "./render-fast-v2.js";
import { buildPictureLockGraph } from "./render-picture-lock-v2.js";
import { renderHybridCanvasCaptions } from "./hybrid-canvas-renderer.js";
import { getServerReadableMediaUrl, objectStorageClient } from "./objectStorage.js";
import { getCanonicalOrigin } from "./appOrigin.js";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;

type VideoInfo = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
  rotation: number;
};

export type HybridRenderOptions = {
  subtitleUrl?: string | null;
  videoDurationSeconds?: number | null;
  videoEffects?: { zoom?: boolean; ai_broll?: boolean; text_cards?: boolean } | null;
  visualSuggestions?: string | null;
  openaiApiKey?: string | null;
  brollBilling?: BRollBillingContext | null;
};

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

async function resolveTimings(input: {
  subtitleUrl?: string | null;
  script: string | null;
  durationSeconds: number;
}): Promise<WordTiming[]> {
  if (input.subtitleUrl) {
    try {
      const response = await axios.get<string>(await getServerReadableMediaUrl(input.subtitleUrl), {
        responseType: "text",
        timeout: 30_000,
      });
      const parsed = parseSRT(response.data);
      if (parsed.length) return parsed;
    } catch (error) {
      logger.warn({ error }, "[HybridV2] Subtitle fetch/parse failed — using fallback timing");
    }
  }

  if (!input.script) return [];
  const fallbackSrt = generateBasicSRT(input.script, input.durationSeconds * 1000);
  const parsed = parseSRT(fallbackSrt);
  if (parsed.length) return parsed;
  return buildFallbackTimings(input.script, input.durationSeconds);
}

async function uploadVideo(filePath: string, runId: string): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  const objectName = `captioned-videos/hybrid-v2_${runId}.mp4`;
  await objectStorageClient.bucket(bucketId).file(objectName).save(await fs.readFile(filePath), {
    contentType: "video/mp4",
  });
  return `${getCanonicalOrigin()}/api/captioned-objects/${objectName}`;
}

async function uploadThumbnail(filePath: string, runId: string): Promise<string | null> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) return null;
  const thumbPath = path.join(path.dirname(filePath), "thumbnail.jpg");
  try {
    await execFileAsync("ffmpeg", [
      "-ss", "1", "-i", filePath,
      "-vframes", "1", "-vf", "scale=720:-2", "-q:v", "3",
      "-y", thumbPath,
    ], { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 });
    const objectName = `thumbnails/hybrid-v2_${runId}.jpg`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(await fs.readFile(thumbPath), {
      contentType: "image/jpeg",
    });
    return `${getCanonicalOrigin()}/api/captioned-objects/${objectName}`;
  } catch (error) {
    logger.warn({ error }, "[HybridV2] Thumbnail failed (non-fatal)");
    return null;
  }
}

/**
 * Hybrid renderer for WaveSpeed:
 *  1) Fast V2 normalization + zoom + B-roll into a 1080x1920 picture lock.
 *  2) Canvas captions using the same CaptionTemplate as the editor preview.
 *  3) One final H.264 encode for captions; audio is stream-copied from picture lock.
 */
export async function applyHybridRenderV2(
  videoUrl: string,
  script: string | null,
  template: CaptionTemplate,
  options?: HybridRenderOptions,
): Promise<CaptionResult> {
  const runId = `hybrid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const tmpDir = path.join(CAPTION_DIR, runId);
  const inputPath = path.join(tmpDir, "avatar.mp4");
  const pictureLockPath = path.join(tmpDir, "picture-lock.mp4");
  const outputPath = path.join(tmpDir, "final.mp4");
  const startedAt = Date.now();

  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await downloadFile(videoUrl, inputPath);
    const videoInfo = await probeVideo(inputPath);
    const duration = options?.videoDurationSeconds ?? videoInfo.duration;
    const timings = await resolveTimings({
      subtitleUrl: options?.subtitleUrl,
      script,
      durationSeconds: duration,
    });

    if (!timings.length) {
      throw new Error("No caption timings available for hybrid render");
    }

    const zoomPromise = options?.videoEffects?.zoom && script
      ? findPunchZoomTimestampsAI(script, timings, duration, options.openaiApiKey)
      : Promise.resolve([]);
    const brollPromise = options?.videoEffects?.ai_broll && script
      ? analyzeBRollSegments(
          script,
          timings,
          duration,
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

    // buildRenderFastV2Graph currently requires an ASS path by contract. The
    // picture-lock adapter removes that terminal filter before FFmpeg executes.
    const fastInput: Parameters<typeof buildRenderFastV2Graph>[0] = {
      duration: videoInfo.duration,
      fps: videoInfo.fps,
      hasAudio: videoInfo.hasAudio,
      rotation: videoInfo.rotation,
      zoomTimestamps,
      brollAssets,
      assPath: path.join(tmpDir, "unused.ass"),
    };
    const picture = buildPictureLockGraph(fastInput);

    logger.info({ runId, zooms: zoomTimestamps.length, broll: brollAssets.length }, "[HybridV2] Rendering picture lock");
    await execFileAsync("ffmpeg", [
      "-noautorotate",
      "-i", inputPath,
      ...picture.inputArgs,
      "-filter_complex", picture.filterComplex,
      "-map", picture.videoMap,
      "-map", picture.audioMap,
      "-t", videoInfo.duration.toFixed(4),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      "-y", pictureLockPath,
    ], {
      maxBuffer: 500 * 1024 * 1024,
      timeout: getRenderFastV2TimeoutMs(videoInfo.duration),
      killSignal: "SIGKILL",
    });

    const pictureInfo = await probeVideo(pictureLockPath);
    const canvasResult = await renderHybridCanvasCaptions({
      pictureLockPath,
      outputPath,
      tmpDir,
      width: pictureInfo.width,
      height: pictureInfo.height,
      timings,
      template,
    });

    const [url, thumbnailUrl] = await Promise.all([
      uploadVideo(outputPath, runId),
      uploadThumbnail(outputPath, runId),
    ]);

    logger.info({
      runId,
      durationSec: pictureInfo.duration,
      segmentCount: canvasResult.segmentCount,
      overlapFixes: canvasResult.overlapFixes,
      sourceMode: canvasResult.sourceMode,
      totalMs: Date.now() - startedAt,
    }, "[HybridV2] Complete");

    return { url, thumbnailUrl };
  } catch (error) {
    logger.error({ error, runId, totalMs: Date.now() - startedAt }, "[HybridV2] Failed");
    return { url: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
