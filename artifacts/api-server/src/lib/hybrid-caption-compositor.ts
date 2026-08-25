import {
  assertCaptionOverlayTimelineIsExclusive,
  normalizeCaptionOverlayTimeline,
  type CaptionOverlaySegment,
} from "./hybrid-caption-timeline.js";

export type HybridCaptionCompositePlan = {
  args: string[];
  filterComplex: string;
  segments: CaptionOverlaySegment[];
  overlapFixes: number;
};

/**
 * The concat-demuxed caption track has one FFmpeg input regardless of this
 * count. Keep batches for only truly pathological timelines, not normal zoom
 * or typewriter animations that expand each cue into several PNGs.
 */
export const MAX_SINGLE_PASS_CAPTION_OVERLAYS = 600;
export const FALLBACK_BATCH_CAPTION_OVERLAYS = 15;

/**
 * Build one FFmpeg composition for a Canvas caption track.
 *
 * Input 0 is a concat-demuxed sequence of Canvas PNGs, so FFmpeg only has one
 * caption stream regardless of how many cues and animation frames Canvas made.
 * Input 1 is the already-finished picture-lock MP4.
 * The picture-lock audio is mapped untouched with -c:a copy so captions cannot
 * introduce AAC encoder delay or drift.
 */
export function buildHybridCaptionCompositePlan(input: {
  pictureLockPath: string;
  captionTrackManifestPath: string;
  outputPath: string;
  segments: CaptionOverlaySegment[];
  crf?: number;
  preset?: string;
}): HybridCaptionCompositePlan {
  const normalized = normalizeCaptionOverlayTimeline(input.segments);
  assertCaptionOverlayTimelineIsExclusive(normalized.segments);

  const args: string[] = [
    "-f", "concat",
    "-safe", "0",
    "-i", input.captionTrackManifestPath,
    "-i", input.pictureLockPath,
  ];
  const filterComplex =
    "[0:v]format=rgba[captions];" +
    "[1:v][captions]overlay=0:0:eof_action=pass:repeatlast=0[captionedv]";
  args.push(
    "-filter_complex", filterComplex,
    "-map", "[captionedv]",
    "-map", "1:a?",
    "-c:v", "libx264",
    "-preset", input.preset ?? "veryfast",
    "-crf", String(input.crf ?? 20),
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-y", input.outputPath,
  );

  return {
    args,
    filterComplex,
    segments: normalized.segments,
    overlapFixes: normalized.issues.filter((issue) => issue.reason === "overlap").length,
  };
}

/**
 * Extreme-only fallback: burn one limited group of captions into video without
 * mapping audio. The caller chains these video-only outputs and muxes the
 * original picture-lock audio exactly once at the end.
 *
 * Uses the same concat-demuxer caption track as the single-pass path so that
 * each batch also has exactly two FFmpeg inputs (manifest + video) regardless
 * of how many cues the batch covers. This avoids the per-cue infinite PNG
 * stream that exhausts FFmpeg resources with normal animated caption counts.
 */
export function buildHybridCaptionVideoOnlyPlan(input: {
  videoPath: string;
  outputPath: string;
  captionTrackManifestPath: string;
  segments: CaptionOverlaySegment[];
  crf?: number;
  preset?: string;
}): HybridCaptionCompositePlan {
  const normalized = normalizeCaptionOverlayTimeline(input.segments);
  assertCaptionOverlayTimelineIsExclusive(normalized.segments);

  const args: string[] = [
    "-f", "concat",
    "-safe", "0",
    "-i", input.captionTrackManifestPath,
    "-i", input.videoPath,
  ];
  const filterComplex =
    "[0:v]format=rgba[captions];" +
    "[1:v][captions]overlay=0:0:eof_action=pass:repeatlast=0[captionedv]";
  args.push(
    "-filter_complex", filterComplex,
    "-map", "[captionedv]",
    "-an",
    "-c:v", "libx264",
    "-preset", input.preset ?? "veryfast",
    "-crf", String(input.crf ?? 20),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y", input.outputPath,
  );

  return {
    args,
    filterComplex,
    segments: normalized.segments,
    overlapFixes: normalized.issues.filter((issue) => issue.reason === "overlap").length,
  };
}
