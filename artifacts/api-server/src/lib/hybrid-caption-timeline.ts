export type CaptionOverlaySegment = {
  pngPath: string;
  startSec: number;
  endSec: number;
};

export type CaptionTimelineIssue = {
  index: number;
  reason: "invalid" | "overlap";
  originalStartSec: number;
  originalEndSec: number;
};

const EPSILON_SEC = 0.001;
const MIN_SEGMENT_SEC = 0.02;

/**
 * Produces a deterministic, non-overlapping caption timeline.
 *
 * Invariants:
 * - segments are ordered by start time;
 * - at any timestamp at most one caption overlay is active;
 * - an overlay never survives past the next overlay's start;
 * - invalid/zero-length segments are dropped;
 * - the source array is never mutated.
 *
 * This is intentionally independent from FFmpeg so the renderer cannot
 * accidentally accumulate previous PNG captions on screen.
 */
export function normalizeCaptionOverlayTimeline(
  input: CaptionOverlaySegment[],
): { segments: CaptionOverlaySegment[]; issues: CaptionTimelineIssue[] } {
  const issues: CaptionTimelineIssue[] = [];
  const ordered = input
    .map((segment, index) => ({ ...segment, __index: index }))
    .filter((segment) => {
      const valid = Number.isFinite(segment.startSec)
        && Number.isFinite(segment.endSec)
        && segment.startSec >= 0
        && segment.endSec - segment.startSec >= MIN_SEGMENT_SEC;
      if (!valid) {
        issues.push({
          index: segment.__index,
          reason: "invalid",
          originalStartSec: segment.startSec,
          originalEndSec: segment.endSec,
        });
      }
      return valid;
    })
    .sort((a, b) => a.startSec - b.startSec || a.__index - b.__index);

  const normalized: CaptionOverlaySegment[] = [];

  for (const segment of ordered) {
    const previous = normalized.at(-1);
    if (previous && segment.startSec < previous.endSec - EPSILON_SEC) {
      issues.push({
        index: segment.__index,
        reason: "overlap",
        originalStartSec: segment.startSec,
        originalEndSec: segment.endSec,
      });

      previous.endSec = Math.max(
        previous.startSec + MIN_SEGMENT_SEC,
        segment.startSec - EPSILON_SEC,
      );
    }

    normalized.push({
      pngPath: segment.pngPath,
      startSec: segment.startSec,
      endSec: segment.endSec,
    });
  }

  // A pathological overlap can shrink the previous segment below the minimum.
  // Remove it rather than leaving two captions active or emitting an invalid
  // FFmpeg enable window.
  const safe = normalized.filter((segment) => segment.endSec - segment.startSec >= MIN_SEGMENT_SEC);

  return { segments: safe, issues };
}

export function assertCaptionOverlayTimelineIsExclusive(
  segments: CaptionOverlaySegment[],
): void {
  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index];
    if (!Number.isFinite(current.startSec) || !Number.isFinite(current.endSec)) {
      throw new Error(`Caption segment ${index} has non-finite timestamps`);
    }
    if (current.startSec < 0 || current.endSec <= current.startSec) {
      throw new Error(`Caption segment ${index} has an invalid time window`);
    }
    const next = segments[index + 1];
    if (next && current.endSec > next.startSec + EPSILON_SEC) {
      throw new Error(`Caption segments ${index} and ${index + 1} overlap`);
    }
  }
}
