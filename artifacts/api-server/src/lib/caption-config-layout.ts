import {
  clampCaptionXPosition,
  marginXFromMaxWidthPercent,
  maxWidthPercentFromMarginX,
} from "@workspace/caption-templates";

/**
 * Keep the persisted center in the same visible range used by Canvas and ASS.
 * X and width are coupled: changing either value may require clamping X.
 */
export function canonicalCaptionXPosition(xPosition: number, maxWidthPercent: number): number {
  return clampCaptionXPosition(xPosition, maxWidthPercent);
}

export function canonicalCaptionLayout(
  input: { maxWidthPercent?: number; marginX?: number; xPosition?: number },
  fallback: { maxWidthPercent: number; marginX: number; xPosition: number },
): { maxWidthPercent: number; marginX: number; xPosition: number } {
  const maxWidthPercent = input.maxWidthPercent
    ?? (input.marginX !== undefined ? maxWidthPercentFromMarginX(input.marginX) : fallback.maxWidthPercent);
  return {
    maxWidthPercent,
    // margin_x remains as a one-way compatibility projection; width is canonical.
    marginX: marginXFromMaxWidthPercent(maxWidthPercent),
    xPosition: canonicalCaptionXPosition(input.xPosition ?? fallback.xPosition, maxWidthPercent),
  };
}