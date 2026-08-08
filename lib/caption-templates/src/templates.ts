import type { CaptionTemplate } from "./types";

/**
 * Official Browser Caption Engine templates for ContentPilot.
 * These definitions are the SINGLE SOURCE OF TRUTH — identical values drive
 * both the React preview (CSS/WebkitTextStroke) and the backend canvas render.
 */
export const BROWSER_CAPTION_TEMPLATES: CaptionTemplate[] = [
  // ── Authority Bold ───────────────────────────────────────────────────────────
  // White body text, yellow active word, thick black stroke. Dominant lower-third.
  // Poppins ExtraBold — assertive, authoritative, high credibility.
  {
    id: "authority_bold",
    name: "Authority Bold",
    description:
      "Texto blanco, acento amarillo, stroke negro grueso. Autoridad visual en tercio inferior. Alto contraste para venta y coaching.",

    fontFamily: "Poppins",
    fontSize: 100,
    fontWeight: 800,
    uppercase: true,
    letterSpacing: 0.02,
    lineHeight: 1.15,

    wordsPerLine: 3,
    yPercent: 82,
    marginXPercent: 5,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#FFE600",
    inactiveOpacity: 0.85,

    outlineColor: "#000000",
    outlineWidth: 9,

    shadowColor: "rgba(0,0,0,0.5)",
    shadowOffsetX: 3,
    shadowOffsetY: 3,
    shadowBlur: 6,

    backgroundMode: "none",
    backgroundColor: null,
    backgroundPaddingX: 0,
    backgroundPaddingY: 0,
    backgroundRadius: 0,

    highlightMode: "color",
    activeWordScale: 1.0,

    animation: "fade",
    animationDuration: 150,
  },

  // ── Viral Stack ──────────────────────────────────────────────────────────────
  // Oswald Bold, very large, 2 words max per block, center-screen.
  // Scroll-stopping density — each word takes visual command of the screen.
  {
    id: "viral_stack",
    name: "Viral Stack",
    description:
      "Palabras enormes, máximo 2 por pantalla, centradas. Impacto visual máximo. Ideal para hooks, ganchos y frases de alto impacto.",

    fontFamily: "Oswald",
    fontSize: 136,
    fontWeight: 700,
    uppercase: true,
    letterSpacing: 0.035,
    lineHeight: 1.05,

    wordsPerLine: 2,
    yPercent: 62,
    marginXPercent: 4,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#FFE600",
    inactiveOpacity: 0.65,

    outlineColor: "#000000",
    outlineWidth: 11,

    shadowColor: "rgba(0,0,0,0.65)",
    shadowOffsetX: 2,
    shadowOffsetY: 4,
    shadowBlur: 8,

    backgroundMode: "none",
    backgroundColor: null,
    backgroundPaddingX: 0,
    backgroundPaddingY: 0,
    backgroundRadius: 0,

    highlightMode: "color",
    activeWordScale: 1.0,

    animation: "zoom",
    animationDuration: 180,
  },

  // ── Clean Coach ──────────────────────────────────────────────────────────────
  // Professional and readable. Teal accent, thin stroke, more words per line.
  // For coaching, education, interviews, finance — substance over flash.
  {
    id: "clean_coach",
    name: "Clean Coach",
    description:
      "Estilo profesional y legible. Acento teal, stroke fino, 5 palabras por línea. Para coaching, educación y entrevistas.",

    fontFamily: "Oswald",
    fontSize: 80,
    fontWeight: 700,
    uppercase: true,
    letterSpacing: 0.01,
    lineHeight: 1.3,

    wordsPerLine: 5,
    yPercent: 85,
    marginXPercent: 5,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#4ECDC4",
    inactiveOpacity: 0.88,

    outlineColor: "#000000",
    outlineWidth: 5,

    shadowColor: "rgba(0,0,0,0.35)",
    shadowOffsetX: 1,
    shadowOffsetY: 2,
    shadowBlur: 4,

    backgroundMode: "none",
    backgroundColor: null,
    backgroundPaddingX: 0,
    backgroundPaddingY: 0,
    backgroundRadius: 0,

    highlightMode: "color",
    activeWordScale: 1.0,

    animation: "fade",
    animationDuration: 100,
  },

  // ── Dimigium ─────────────────────────────────────────────────────────────────
  // Bright-orange pill box on the active word only. The most recognisable viral
  // caption style on Reels/TikTok: white text on a coloured box, inactive words
  // with a crisp black stroke — zero ambiguity about which word is being said.
  {
    id: "dimigium",
    name: "Dimigium",
    description:
      "Caja naranja solo en la palabra activa, texto blanco, pill redondeado. El estilo viral de mayor reconocimiento en Reels y TikTok.",

    fontFamily: "Poppins",
    fontSize: 112,
    fontWeight: 800,
    uppercase: true,
    letterSpacing: 0.015,
    lineHeight: 1.2,

    wordsPerLine: 3,
    yPercent: 83,
    marginXPercent: 5,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",    // white text ON the orange box
    inactiveOpacity: 0.92,

    outlineColor: "#000000",
    outlineWidth: 8,               // thick outline keeps inactive words crisp on any background

    shadowColor: "rgba(0,0,0,0.45)",
    shadowOffsetX: 0,
    shadowOffsetY: 4,
    shadowBlur: 8,

    // ── Pill box — active word only ─────────────────────────────────────────
    backgroundMode: "active_word",
    backgroundColor: "#FF6B00",    // signature Dimigium orange
    backgroundPaddingX: 22,        // generous horizontal padding at 1920 ref
    backgroundPaddingY: 10,
    backgroundRadius: 14,

    highlightMode: "color",
    activeWordScale: 1.0,

    animation: "zoom",
    animationDuration: 150,
  },
];

/** Look up a template by id. Returns undefined if not found. */
export function getBrowserTemplate(id: string): CaptionTemplate | undefined {
  return BROWSER_CAPTION_TEMPLATES.find((t) => t.id === id);
}
