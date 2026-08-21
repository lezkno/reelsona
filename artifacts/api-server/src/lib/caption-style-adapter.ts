import {
  getFastV2TemplatePreview,
  getFastV2VisualOverrides,
  type CaptionTemplate,
} from "@workspace/caption-templates";

import type { CaptionStyle } from "./caption-engine";

/** Browser Engine uses the same visual-only override policy as Render Fast V2. */
export function getBrowserTemplateVisualOverrides(
  overrides?: Partial<CaptionTemplate>,
  canonicalFontSize?: number,
): Partial<CaptionTemplate> {
  return getFastV2VisualOverrides(overrides, canonicalFontSize);
}

/**
 * Render Fast V2 burns ASS captions, while Caption Studio's browser engine uses
 * the shared template library. Both use 1920px height as their sizing reference,
 * so template typography can be carried across without a resolution multiplier.
 */
export function getBrowserTemplateStyleOverrides(
  templateId: string | null | undefined,
  overrides?: Partial<CaptionTemplate>,
  canonicalFontSize?: number,
): Partial<CaptionStyle> | null {
  const fastV2 = getFastV2TemplatePreview(templateId, overrides, canonicalFontSize);
  if (!fastV2) return null;
  const { template } = fastV2;
  return {
    presetId: template.id,
    // Keep CaptionStyle aligned with the shared Fast V2 preview contract.
    // Pop/zoom ultimately show one dialogue word; mixed mode ignores this value.
    wordsPerLine: fastV2.wordsPerLine,
    primaryColor: template.primaryColor,
    activeWordColor: template.activeWordColor,
    outlineColor: template.outlineColor,
    backgroundColor: template.backgroundColor,
    fontFamily: template.fontFamily,
    // Font size and placement have one authority: the shared CaptionConfig.
    // Legacy geometric overrides are deliberately ignored on read.
    fontSize: canonicalFontSize ?? template.fontSize,
    activeWordScale: template.activeWordScale,
    outlineWidth: template.outlineWidth,
    letterSpacing: template.letterSpacing,
    inactiveOpacity: template.inactiveOpacity,
    stackWords: template.stackWords,
    fontWeight: template.fontWeight,
    shadowColor: template.shadowColor,
    shadowOffsetX: template.shadowOffsetX,
    shadowOffsetY: template.shadowOffsetY,
    shadowBlur: template.shadowBlur,
    uppercase: template.uppercase,
    // ASS does not have Browser's static "none" mode. A regular highlight line
    // keeps the same words visible without inventing an animation.
    highlightMode: template.highlightMode === "none" ? "color" : template.highlightMode,
  };
}