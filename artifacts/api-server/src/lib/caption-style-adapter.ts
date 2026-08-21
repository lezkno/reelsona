import { BROWSER_CAPTION_TEMPLATES, type CaptionTemplate } from "@workspace/caption-templates";

import type { CaptionStyle } from "./caption-engine";

/** Layout belongs to CaptionConfig. Overrides are visual-only by design. */
const VISUAL_OVERRIDE_KEYS = new Set<keyof CaptionTemplate>([
  "wordsPerLine", "primaryColor", "activeWordColor", "outlineColor",
  "backgroundColor", "fontFamily", "activeWordScale", "outlineWidth",
  "letterSpacing", "highlightMode", "inactiveOpacity", "stackWords",
  "fontWeight", "shadowColor", "shadowOffsetX", "shadowOffsetY", "shadowBlur",
  "uppercase",
]);

function visualOverrides(overrides?: Partial<CaptionTemplate>): Partial<CaptionTemplate> {
  if (!overrides) return {};
  return Object.fromEntries(
    Object.entries(overrides).filter(([key]) => VISUAL_OVERRIDE_KEYS.has(key as keyof CaptionTemplate)),
  ) as Partial<CaptionTemplate>;
}

/** Browser Engine uses the same visual-only override policy as Render Fast V2. */
export function getBrowserTemplateVisualOverrides(
  overrides?: Partial<CaptionTemplate>,
  canonicalFontSize?: number,
): Partial<CaptionTemplate> {
  return {
    ...visualOverrides(overrides),
    // Font size belongs to the common CaptionConfig, never a saved template.
    ...(canonicalFontSize !== undefined && { fontSize: canonicalFontSize }),
  };
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
  const baseTemplate = BROWSER_CAPTION_TEMPLATES.find((template) => template.id === templateId);
  if (!baseTemplate) return null;

  const template = {
    ...baseTemplate,
    ...getBrowserTemplateVisualOverrides(overrides, canonicalFontSize),
  };
  return {
    presetId: template.id,
    wordsPerLine: template.wordsPerLine,
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