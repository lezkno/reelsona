import { BROWSER_CAPTION_TEMPLATES } from "./templates";
import type { CaptionTemplate } from "./types";

/**
 * The visual subset that Render Fast V2 can reproduce with ASS/libass.
 *
 * It is intentionally dependency-free because both Caption Studio and the API
 * adapter consume it. The editor must not promise effects that the final MP4
 * cannot render.
 */
export type FastV2RenderMode = "highlight" | "pop" | "mixed";

export type FastV2TemplateControl =
  | "wordsPerLine"
  | "outlineWidth"
  | "inactiveOpacity"
  | "primaryColor"
  | "activeWordColor"
  | "outlineColor";

export interface FastV2TemplatePreview {
  /** Template after visual overrides and canonical font-size resolution. */
  template: CaptionTemplate;
  renderMode: FastV2RenderMode;
  /** Number of simultaneous words in the MP4, after ASS mode normalization. */
  wordsPerLine: number;
  /** Family actually requested from libass after its installed-font fallback. */
  assFontFamily: string;
  /** ASS only distinguishes regular from bold, not 700/800/900. */
  assFontWeight: 400 | 700;
  /** A background becomes one rectangular dialogue box in ASS. */
  hasDialogueBox: boolean;
  /** CSS approximation of the exact ASS background-color conversion. */
  assBackgroundColor: string | null;
  /** ASS shadow has one positive depth without blur or independent X/Y offsets. */
  shadowDepth: number;
  /** Spacing in 1920px ASS units, after dispatcher-specific normalization. */
  assLetterSpacing: number;
  /** Outline is suppressed whenever ASS uses an opaque dialogue box. */
  outlineWidth: number;
  /** Only enabled controls can visibly alter the Fast V2 output. */
  controls: Record<FastV2TemplateControl, boolean>;
}

const VISUAL_OVERRIDE_KEYS = new Set<keyof CaptionTemplate>([
  "wordsPerLine", "primaryColor", "activeWordColor", "outlineColor",
  "backgroundColor", "fontFamily", "activeWordScale", "outlineWidth",
  "letterSpacing", "highlightMode", "inactiveOpacity", "stackWords",
  "fontWeight", "shadowColor", "shadowOffsetX", "shadowOffsetY", "shadowBlur",
  "uppercase",
]);

export function getFastV2VisualOverrides(
  overrides?: Partial<CaptionTemplate>,
  canonicalFontSize?: number,
): Partial<CaptionTemplate> {
  const visual = overrides
    ? Object.fromEntries(
        Object.entries(overrides).filter(([key]) => VISUAL_OVERRIDE_KEYS.has(key as keyof CaptionTemplate)),
      ) as Partial<CaptionTemplate>
    : {};
  return {
    ...visual,
    ...(canonicalFontSize !== undefined && { fontSize: canonicalFontSize }),
  };
}

/** Mirrors the font resolver used by caption-engine.ts. */
export function resolveAssFontFamily(fontFamily: string): string {
  if (fontFamily === "Montserrat" || fontFamily === "Inter" || fontFamily === "Arial") {
    return "DejaVu Sans";
  }
  if (fontFamily === "Georgia") return "DejaVu Serif";
  return ["Oswald", "Poppins", "Bangers", "DejaVu Sans", "DejaVu Serif"].includes(fontFamily)
    ? fontFamily
    : "Oswald";
}

function resolveAssBackgroundColor(backgroundColor: string | null): string | null {
  if (!backgroundColor) return null;
  // caption-engine's rgbaToAss intentionally supports CSS rgb()/rgba() only.
  // A hex background therefore reaches its documented conservative fallback:
  // &H80000000 = 50% opaque black. Keep the Studio honest about that outcome.
  return /^rgba?\(/i.test(backgroundColor) ? backgroundColor : "rgba(0,0,0,0.5)";
}

function resolveRenderMode(template: CaptionTemplate): FastV2RenderMode {
  if (template.highlightMode === "mixed") return "mixed";
  if (template.highlightMode === "color") return "highlight";
  return "pop";
}

export function resolveFastV2TemplatePreview(
  baseTemplate: CaptionTemplate,
  overrides?: Partial<CaptionTemplate>,
  canonicalFontSize?: number,
): FastV2TemplatePreview {
  const template = {
    ...baseTemplate,
    ...getFastV2VisualOverrides(overrides, canonicalFontSize),
  };
  const renderMode = resolveRenderMode(template);
  const hasDialogueBox = template.backgroundColor !== null;
  const isPop = renderMode === "pop";

  return {
    template,
    renderMode,
    wordsPerLine: isPop ? 1 : template.wordsPerLine,
    assFontFamily: resolveAssFontFamily(template.fontFamily),
    assFontWeight: template.fontWeight >= 600 ? 700 : 400,
    hasDialogueBox,
    assBackgroundColor: resolveAssBackgroundColor(template.backgroundColor),
    shadowDepth: renderMode === "mixed"
      ? 2
      : hasDialogueBox
        ? 0
        : Math.max(0, Math.round(Math.max(Math.abs(template.shadowOffsetX), Math.abs(template.shadowOffsetY)))),
    // buildDimidiumASS has its own hard-coded letter spacing because stacked
    // mixed-size lines must not inherit the Browser template's loose tracking.
    assLetterSpacing: renderMode === "mixed"
      ? 0
      : +(template.fontSize * template.letterSpacing).toFixed(1),
    outlineWidth: hasDialogueBox ? 0 : template.outlineWidth,
    controls: {
      // buildDimidiumASS uses SRT blocks as its lines and deliberately ignores
      // CaptionStyle.wordsPerLine, so exposing this slider would be a no-op.
      wordsPerLine: !isPop && renderMode !== "mixed",
      outlineWidth: !hasDialogueBox,
      inactiveOpacity: renderMode === "highlight",
      primaryColor: true,
      activeWordColor: renderMode !== "pop" || template.highlightMode === "both",
      outlineColor: !hasDialogueBox,
    },
  };
}

export function getFastV2TemplatePreview(
  templateId: string | null | undefined,
  overrides?: Partial<CaptionTemplate>,
  canonicalFontSize?: number,
): FastV2TemplatePreview | null {
  const template = BROWSER_CAPTION_TEMPLATES.find((candidate) => candidate.id === templateId);
  return template ? resolveFastV2TemplatePreview(template, overrides, canonicalFontSize) : null;
}