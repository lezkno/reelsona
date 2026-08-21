import type { CaptionTemplate } from "./types";

/**
 * The caption editor and all renderers compose against this fixed reference
 * frame. Persisted layout values are never preview-pixel values.
 */
export const CAPTION_CANVAS_WIDTH = 1080;
export const CAPTION_CANVAS_HEIGHT = 1920;

export const CAPTION_FONT_SIZE_RANGE = { min: 60, max: 220, step: 5 } as const;
export const CAPTION_Y_POSITION_RANGE = { min: 10, max: 97 } as const;
export const CAPTION_MAX_WIDTH_RANGE = { min: 40, max: 100, step: 1 } as const;

export interface CanonicalCaptionLayout {
  /** ASS FontSize at the canonical 1080×1920 canvas. */
  fontSize: number;
  /** Text baseline as a percentage from the top of the canonical canvas. */
  yPercent: number;
  /** Maximum caption block width as a percentage of the canonical canvas width. */
  maxWidthPercent: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function maxWidthPercentFromMarginX(marginX: number): number {
  return clamp(
    ((CAPTION_CANVAS_WIDTH - Math.max(0, marginX) * 2) / CAPTION_CANVAS_WIDTH) * 100,
    CAPTION_MAX_WIDTH_RANGE.min,
    CAPTION_MAX_WIDTH_RANGE.max,
  );
}

export function marginXFromMaxWidthPercent(maxWidthPercent: number, renderWidth = CAPTION_CANVAS_WIDTH): number {
  const normalized = clamp(
    maxWidthPercent,
    CAPTION_MAX_WIDTH_RANGE.min,
    CAPTION_MAX_WIDTH_RANGE.max,
  );
  return Math.round((renderWidth * (1 - normalized / 100)) / 2);
}

export function canonicalizeCaptionLayout(
  layout: Partial<CanonicalCaptionLayout> & { marginX?: number },
  fallback: Pick<CaptionTemplate, "fontSize" | "yPercent" | "marginXPercent">,
): CanonicalCaptionLayout {
  const fallbackWidth = 100 - fallback.marginXPercent * 2;
  return {
    fontSize: Math.round(clamp(
      layout.fontSize ?? fallback.fontSize,
      CAPTION_FONT_SIZE_RANGE.min,
      CAPTION_FONT_SIZE_RANGE.max,
    )),
    yPercent: +clamp(
      layout.yPercent ?? fallback.yPercent,
      CAPTION_Y_POSITION_RANGE.min,
      CAPTION_Y_POSITION_RANGE.max,
    ).toFixed(1),
    maxWidthPercent: +clamp(
      layout.maxWidthPercent
        ?? (layout.marginX !== undefined ? maxWidthPercentFromMarginX(layout.marginX) : fallbackWidth),
      CAPTION_MAX_WIDTH_RANGE.min,
      CAPTION_MAX_WIDTH_RANGE.max,
    ).toFixed(1),
  };
}