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

function escapeEnableNumber(value: number): string {
  return Math.max(0, value).toFixed(6);
}

/**
 * Build one FFmpeg composition for every Canvas caption PNG.
 *
 * Input 0 is the already-finished picture-lock MP4. Inputs 1..N are PNGs.
 * The picture-lock audio is mapped untouched with -c:a copy so captions cannot
 * introduce AAC encoder delay or drift.
 */
export function buildHybridCaptionCompositePlan(input: {
  pictureLockPath: string;
  outputPath: string;
  width: number;
  height: number;
  segments: CaptionOverlaySegment[];
  crf?: number;
  preset?: string;
}): HybridCaptionCompositePlan {
  const normalized = normalizeCaptionOverlayTimeline(input.segments);
  assertCaptionOverlayTimelineIsExclusive(normalized.segments);

  const args: string[] = ["-i", input.pictureLockPath];
  const filterParts: string[] = [];
  let previousLabel = "[0:v]";

  normalized.segments.forEach((segment, index) => {
    const inputIndex = index + 1;
    const pngLabel = `[cap${index}]`;
    const outputLabel = index === normalized.segments.length - 1
      ? "[captionedv]"
      : `[captioned${index}]`;

    args.push("-loop", "1", "-i", segment.pngPath);
    filterParts.push(
      `[${inputIndex}:v]scale=${input.width}:${input.height}:flags=lanczos,format=rgba${pngLabel}`,
    );
    filterParts.push(
      `${previousLabel}${pngLabel}overlay=0:0:eof_action=pass:` +
      `enable='between(t,${escapeEnableNumber(segment.startSec)},${escapeEnableNumber(segment.endSec)})'${outputLabel}`,
    );
    previousLabel = outputLabel;
  });

  // If there are no caption segments, keep the picture lock video stream.
  if (normalized.segments.length === 0) {
    filterParts.push("[0:v]null[captionedv]");
  }

  const filterComplex = filterParts.join(";");
  args.push(
    "-filter_complex", filterComplex,
    "-map", "[captionedv]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", input.preset ?? "veryfast",
    "-crf", String(input.crf ?? 20),
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-shortest",
    "-y", input.outputPath,
  );

  return {
    args,
    filterComplex,
    segments: normalized.segments,
    overlapFixes: normalized.issues.filter((issue) => issue.reason === "overlap").length,
  };
}
