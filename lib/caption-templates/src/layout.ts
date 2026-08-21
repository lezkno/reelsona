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
export const CAPTION_X_POSITION_RANGE = { min: 0, max: 100, step: 0.5 } as const;

export interface CanonicalCaptionLayout {
  /** ASS FontSize at the canonical 1080×1920 canvas. */
  fontSize: number;
  /** Text baseline as a percentage from the top of the canonical canvas. */
  yPercent: number;
  /** Horizontal center of the caption block as a percentage of the canvas width. */
  xPercent: number;
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

/** The allowed center range that keeps a caption block fully inside the canvas. */
export function xPositionRangeForWidth(maxWidthPercent: number): { min: number; max: number } {
  const normalizedWidth = clamp(
    maxWidthPercent,
    CAPTION_MAX_WIDTH_RANGE.min,
    CAPTION_MAX_WIDTH_RANGE.max,
  );
  const halfWidth = normalizedWidth / 2;
  return { min: halfWidth, max: 100 - halfWidth };
}

/** Clamp a requested caption center to the area available for its configured width. */
export function clampCaptionXPosition(xPercent: number, maxWidthPercent: number): number {
  const range = xPositionRangeForWidth(maxWidthPercent);
  return +clamp(xPercent, range.min, range.max).toFixed(1);
}

/**
 * Convert the canonical center+width contract into physical left/right margins.
 * ASS uses these asymmetric margins while Canvas/CSS use the same safe area.
 */
export function captionHorizontalMargins(
  maxWidthPercent: number,
  xPercent = 50,
  renderWidth = CAPTION_CANVAS_WIDTH,
): { left: number; right: number; width: number; center: number } {
  const normalizedWidth = clamp(
    maxWidthPercent,
    CAPTION_MAX_WIDTH_RANGE.min,
    CAPTION_MAX_WIDTH_RANGE.max,
  );
  const centerPercent = clampCaptionXPosition(xPercent, normalizedWidth);
  const width = renderWidth * (normalizedWidth / 100);
  const center = renderWidth * (centerPercent / 100);
  const left = Math.round(center - width / 2);
  const right = Math.round(renderWidth - (left + width));
  return { left, right, width: Math.round(width), center: Math.round(center) };
}

export function canonicalizeCaptionLayout(
  layout: Partial<CanonicalCaptionLayout> & { marginX?: number },
  fallback: Pick<CaptionTemplate, "fontSize" | "yPercent" | "marginXPercent">,
): CanonicalCaptionLayout {
  const fallbackWidth = 100 - fallback.marginXPercent * 2;
  const maxWidthPercent = +clamp(
    layout.maxWidthPercent
      ?? (layout.marginX !== undefined ? maxWidthPercentFromMarginX(layout.marginX) : fallbackWidth),
    CAPTION_MAX_WIDTH_RANGE.min,
    CAPTION_MAX_WIDTH_RANGE.max,
  ).toFixed(1);
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
    xPercent: clampCaptionXPosition(layout.xPercent ?? 50, maxWidthPercent),
    maxWidthPercent,
  };
}