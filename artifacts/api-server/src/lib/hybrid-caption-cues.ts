import {
  buildBuildingCues,
  buildCaptionCues,
  type CaptionCue,
  type CaptionTemplate,
} from "@workspace/caption-templates";
import {
  buildPhraseCues,
  type WordTiming,
} from "./browser-caption-engine.js";

export type HybridCaptionCuePlan = {
  cues: CaptionCue[];
  sourceMode: "phrase" | "word";
};

function isPhraseTiming(timings: WordTiming[]): boolean {
  return timings.some((timing) => timing.text.trim().split(/\s+/).length > 1);
}

/**
 * Build the display cues used by the hybrid Canvas renderer.
 *
 * Phrase-level SRT is never converted into fabricated word timing. Each phrase
 * is split only into sequential wordsPerLine chunks, so one block replaces the
 * previous block instead of accumulating prior phrases on screen.
 */
export function buildHybridCaptionCues(
  timings: WordTiming[],
  template: CaptionTemplate,
): HybridCaptionCuePlan {
  const clean = timings
    .filter((timing) => Number.isFinite(timing.startMs) && Number.isFinite(timing.endMs))
    .filter((timing) => timing.endMs > timing.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  if (isPhraseTiming(clean)) {
    return {
      cues: buildPhraseCues(clean, template),
      sourceMode: "phrase",
    };
  }

  const cues = template.buildingMode
    ? buildBuildingCues(clean, template)
    : buildCaptionCues(clean, template);

  return { cues, sourceMode: "word" };
}

/**
 * Clamp cue end times to the next cue start. This is the second safety net
 * before the PNG overlay timeline normalizer and guarantees that building or
 * animation states cannot leave two caption blocks visible together.
 */
export function clampHybridCueWindows(cues: CaptionCue[]): CaptionCue[] {
  return cues
    .map((cue, index) => {
      const next = cues[index + 1];
      const endMs = next ? Math.min(cue.endMs, next.startMs) : cue.endMs;
      return { ...cue, endMs };
    })
    .filter((cue) => cue.endMs > cue.startMs);
}
