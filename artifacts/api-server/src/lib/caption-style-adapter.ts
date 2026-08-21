import { BROWSER_CAPTION_TEMPLATES, type CaptionTemplate } from "@workspace/caption-templates";

import type { CaptionStyle } from "./caption-engine";

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

  const template = { ...baseTemplate, ...overrides };
  return {
    presetId: template.id,
    wordsPerLine: template.wordsPerLine,
    primaryColor: template.primaryColor,
    activeWordColor: template.activeWordColor,
    outlineColor: template.outlineColor,
    backgroundColor: template.backgroundColor,
    fontFamily: template.fontFamily,
    // A template default is a preset, never a late renderer override. A saved
    // per-template font size is preserved as an explicit legacy user override.
    fontSize: overrides?.fontSize ?? canonicalFontSize ?? template.fontSize,
    activeWordScale: template.activeWordScale,
    outlineWidth: template.outlineWidth,
    letterSpacing: template.letterSpacing,
    // ASS does not have Browser's static "none" mode. A regular highlight line
    // keeps the same words visible without inventing an animation.
    highlightMode: template.highlightMode === "none" ? "color" : template.highlightMode,
  };
}