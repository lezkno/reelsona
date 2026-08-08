/**
 * Shared rendering utilities — pure TypeScript, no browser or Node.js deps.
 * Used by both the React preview (frontend) and the Canvas renderer (backend).
 */

import type { CaptionTemplate, CaptionCue, CaptionWord, WordTiming } from "./types";

// ── Caption cue builder ───────────────────────────────────────────────────────

/**
 * Build CaptionCues from a flat list of word timings.
 *
 * Each word timing becomes one CaptionCue showing a window of `wordsPerLine`
 * words. The active word is the one whose timing is current; inactive words
 * surround it in the same chunk (highlight-mode behavior).
 *
 * The chunk boundary advances every `wordsPerLine` words, so the visible block
 * changes as a group — just like the existing ASS highlight engine.
 *
 * Phase 2 upgrade path: when word-level startMs/endMs are available from AI
 * transcription, replace this function with one that builds cues from per-word
 * timestamps instead of SRT block timings.
 */
export function buildCaptionCues(
  words: WordTiming[],
  template: Pick<CaptionTemplate, "wordsPerLine">,
): CaptionCue[] {
  const { wordsPerLine } = template;

  return words.map((word, wordIndex) => {
    // Which chunk (block of N words) does this word belong to?
    const chunkStart = Math.floor(wordIndex / wordsPerLine) * wordsPerLine;
    const chunkEnd = Math.min(chunkStart + wordsPerLine, words.length);
    const activeWordIndex = wordIndex - chunkStart;

    const chunkWords: CaptionWord[] = words.slice(chunkStart, chunkEnd).map((w) => ({
      text: w.text,
      startMs: w.startMs,
      endMs: w.endMs,
    }));

    return {
      index: wordIndex,
      startMs: word.startMs,
      endMs: word.endMs,
      words: chunkWords,
      activeWordIndex,
    };
  });
}

// ── Scaling helpers ───────────────────────────────────────────────────────────

/**
 * Scale a 1920-reference value to the target render/preview size.
 *
 * @param value      Value in the 1920px reference frame
 * @param renderH    Target render height in pixels
 * @returns          Scaled value for the target
 */
export function scaleToHeight(value: number, renderH: number): number {
  return value * (renderH / 1920);
}

/** Y position of the text baseline in render pixels. */
export function getBaselineY(
  template: Pick<CaptionTemplate, "yPercent">,
  renderH: number,
): number {
  return renderH * (template.yPercent / 100);
}

/** Horizontal safe-area margin in render pixels. */
export function getSafeMarginX(
  template: Pick<CaptionTemplate, "marginXPercent">,
  renderW: number,
): number {
  return renderW * (template.marginXPercent / 100);
}

// ── Text formatting ───────────────────────────────────────────────────────────

/** Apply uppercase transform if the template requires it. */
export function formatWord(
  text: string,
  template: Pick<CaptionTemplate, "uppercase">,
): string {
  return template.uppercase ? text.toUpperCase() : text;
}

// ── CSS style helpers (frontend only, no DOM imports) ─────────────────────────

/**
 * Build the CSS style object for one word span in the React preview.
 * All sizes are already scaled to preview pixels — pass the scaled values.
 *
 * Returns a plain object compatible with React's `style` prop.
 */
export function buildWordStyle(
  template: CaptionTemplate,
  isActive: boolean,
  scaledFontSize: number,
  scaledOutlineWidth: number,
  scaledShadowX: number,
  scaledShadowY: number,
  scaledShadowBlur: number,
): Record<string, string | number> {
  const color = isActive ? template.activeWordColor : template.primaryColor;
  const opacity = isActive ? 1.0 : template.inactiveOpacity;

  const shadow =
    scaledShadowBlur > 0 || scaledShadowX !== 0 || scaledShadowY !== 0
      ? `${scaledShadowX}px ${scaledShadowY}px ${scaledShadowBlur}px ${template.shadowColor}`
      : "none";

  return {
    fontFamily: `'${template.fontFamily}', sans-serif`,
    fontSize: `${scaledFontSize}px`,
    fontWeight: template.fontWeight,
    letterSpacing: `${template.letterSpacing}em`,
    lineHeight: template.lineHeight,
    color,
    opacity,
    // Crisp stroke: matches the canvas lineWidth×2/stroke-before-fill technique
    WebkitTextStroke:
      scaledOutlineWidth > 0
        ? `${scaledOutlineWidth}px ${template.outlineColor}`
        : "none",
    paintOrder: "stroke fill",
    textShadow: shadow,
    textTransform: template.uppercase ? "uppercase" : "none",
    display: "inline-block",
    transition:
      template.animation === "fade"
        ? `opacity ${template.animationDuration}ms ease, color ${template.animationDuration}ms ease`
        : "none",
  };
}
