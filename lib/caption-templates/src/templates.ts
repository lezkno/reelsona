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

  // ── Hormozi ──────────────────────────────────────────────────────────────────
  // Popularized by Alex Hormozi: Montserrat Black 900 ALL CAPS, 2 words per
  // screen, active word in lime green #22C55E — his signature karaoke color.
  // Heavy black outline. Sits center-frame, not bottom-third.
  {
    id: "hormozi",
    name: "Hormozi",
    description:
      "Estilo Hormozi: Montserrat Black 900, 2 palabras, activa en verde lima. El formato de captions más copiado en business/coaching en Reels y TikTok.",

    fontFamily: "Montserrat",
    fontSize: 115,
    fontWeight: 900,
    uppercase: true,
    letterSpacing: 0.01,
    lineHeight: 1.15,

    wordsPerLine: 2,
    yPercent: 72,
    marginXPercent: 6,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#22C55E",
    inactiveOpacity: 0.72,

    outlineColor: "#000000",
    outlineWidth: 10,

    shadowColor: "rgba(0,0,0,0.65)",
    shadowOffsetX: 3,
    shadowOffsetY: 3,
    shadowBlur: 8,

    backgroundMode: "none",
    backgroundColor: null,
    backgroundPaddingX: 0,
    backgroundPaddingY: 0,
    backgroundRadius: 0,

    highlightMode: "color",
    activeWordScale: 1.0,

    animation: "zoom",
    animationDuration: 160,
  },

  // ── Bold Stack ───────────────────────────────────────────────────────────────
  // Copia exacta del preset ASS "bold_stack":
  //   fontFamily: Poppins, fontSize: 105, primaryColor: #FFFFFF,
  //   activeWordColor: #FFE600, outlineColor: #000000, wordsPerLine: 2,
  //   activeWordScale: 1.2, highlightMode: "color".
  {
    id: "bold_stack",
    name: "Bold Stack",
    description:
      "2 palabras en Poppins bold, activa en amarillo #FFE600 y ligeramente más grande. El estilo más viral en TikTok e IG Reels.",

    fontFamily: "Poppins",
    fontSize: 105,
    fontWeight: 800,
    uppercase: true,
    letterSpacing: 0.01,
    lineHeight: 1.15,

    wordsPerLine: 2,
    stackWords: true,
    yPercent: 72,
    marginXPercent: 6,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#FFE600",
    inactiveOpacity: 0.72,

    outlineColor: "#000000",
    outlineWidth: 10,

    shadowColor: "rgba(0,0,0,0.65)",
    shadowOffsetX: 3,
    shadowOffsetY: 3,
    shadowBlur: 8,

    backgroundMode: "none",
    backgroundColor: null,
    backgroundPaddingX: 0,
    backgroundPaddingY: 0,
    backgroundRadius: 0,

    highlightMode: "color",
    activeWordScale: 1.2,

    animation: "zoom",
    animationDuration: 160,
  },

  // ── Bangers (Cómic) ──────────────────────────────────────────────────────────
  // Copia exacta del preset ASS "bangers":
  //   fontFamily: Bangers, fontSize: 120, primaryColor: #FFFFFF,
  //   activeWordColor: #FF3366, outlineColor: #000000, sin caja de fondo.
  {
    id: "bangers_comic",
    name: "Bangers (Cómic)",
    description:
      "Fuente cómic, palabra activa en rosa vibrante #FF3366. Dinámico y divertido.",

    fontFamily: "Bangers",
    fontSize: 120,
    fontWeight: 400,
    uppercase: true,
    letterSpacing: 0.04,
    lineHeight: 1.2,

    wordsPerLine: 1,
    yPercent: 82,
    marginXPercent: 5,
    textAlign: "center",

    primaryColor: "#FF3366",   // única palabra visible = siempre el color activo
    activeWordColor: "#FF3366",
    inactiveOpacity: 1.0,

    outlineColor: "#000000",
    outlineWidth: 8,

    shadowColor: "rgba(0,0,0,0.55)",
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    shadowBlur: 6,

    backgroundMode: "none",
    backgroundColor: null,
    backgroundPaddingX: 0,
    backgroundPaddingY: 0,
    backgroundRadius: 0,

    highlightMode: "color",
    activeWordScale: 1.0,

    animation: "zoom",
    animationDuration: 150,
  },

  // ── Neon Glow ─────────────────────────────────────────────────────────────────
  // Bangers font with a saturated cyan glow. Active word flips to pure white
  // (the "hot centre" of a neon tube). No outline — the glow provides contrast.
  // Best for gaming, music drops, nightlife, and high-energy content.
  {
    id: "neon_glow",
    name: "Neon Glow",
    description:
      "Fuente Bangers con halo cyan brillante. Activa en blanco puro. Sin stroke, el glow hace el contraste. Gaming, música, contenido nocturno.",

    fontFamily: "Bangers",
    fontSize: 115,
    fontWeight: 400,
    uppercase: true,
    letterSpacing: 0.04,
    lineHeight: 1.12,

    wordsPerLine: 3,
    yPercent: 75,
    marginXPercent: 5,
    textAlign: "center",

    primaryColor: "#00F5FF",
    activeWordColor: "#FFFFFF",
    inactiveOpacity: 0.80,

    outlineColor: "#000000",
    outlineWidth: 0,

    shadowColor: "rgba(0,245,255,0.90)",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 28,

    backgroundMode: "none",
    backgroundColor: null,
    backgroundPaddingX: 0,
    backgroundPaddingY: 0,
    backgroundRadius: 0,

    highlightMode: "color",
    activeWordScale: 1.0,

    animation: "fade",
    animationDuration: 120,
  },

  // ── Cinematic ─────────────────────────────────────────────────────────────────
  // Oswald 700, letter-spacing muy ancho (0.16em), sin outline, solo sombra suave.
  // Tono cálido en la activa. Elegancia de documental. Para lifestyle, coaches
  // de alto nivel, entrevistas, viajes.
  {
    id: "cinematic",
    name: "Cinematic",
    description:
      "Oswald 700, tracking ancho, sin stroke, sombra suave. Activa en oro cálido. Estilo documental premium. Lifestyle, coaches, entrevistas.",

    fontFamily: "Oswald",
    fontSize: 68,
    fontWeight: 700,
    uppercase: true,
    letterSpacing: 0.16,
    lineHeight: 1.40,

    wordsPerLine: 4,
    yPercent: 87,
    marginXPercent: 7,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#E8D5A3",
    inactiveOpacity: 0.70,

    outlineColor: "#000000",
    outlineWidth: 0,

    shadowColor: "rgba(0,0,0,0.88)",
    shadowOffsetX: 0,
    shadowOffsetY: 4,
    shadowBlur: 14,

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

  // ── Scale Pop ─────────────────────────────────────────────────────────────────
  // La palabra activa crece 1.35× mientras las inactivas se atenúan al 50%.
  // El resaltado es por escala (no por color) — único entre todas las plantillas.
  // Poppins 800, blanco + stroke negro grueso.
  {
    id: "scale_pop",
    name: "Scale Pop",
    description:
      "Activa crece 1.35×, inactivas al 50% de opacidad. Highlight por escala, no por color. Poppins 800, stroke negro. Scroll-stopping.",

    fontFamily: "Poppins",
    fontSize: 90,
    fontWeight: 800,
    uppercase: true,
    letterSpacing: 0.01,
    lineHeight: 1.18,

    wordsPerLine: 3,
    yPercent: 78,
    marginXPercent: 5,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",
    inactiveOpacity: 0.50,

    outlineColor: "#000000",
    outlineWidth: 7,

    shadowColor: "rgba(0,0,0,0.55)",
    shadowOffsetX: 2,
    shadowOffsetY: 4,
    shadowBlur: 7,

    backgroundMode: "none",
    backgroundColor: null,
    backgroundPaddingX: 0,
    backgroundPaddingY: 0,
    backgroundRadius: 0,

    highlightMode: "scale",
    activeWordScale: 1.35,

    animation: "zoom",
    animationDuration: 140,
  },

  // ── Broadcast ─────────────────────────────────────────────────────────────────
  // Caja semitransparente negra (0.78) detrás de cada línea completa — estilo
  // CNN/BBC/podcast. Garantiza legibilidad en cualquier fondo. Activa en amarillo.
  // Usa backgroundMode: "line" (caja por línea, no por palabra).
  {
    id: "broadcast",
    name: "Broadcast",
    description:
      "Caja negra semitransparente detrás de cada línea completa. Estilo CNN/podcast. Máxima legibilidad en cualquier fondo. Activa en amarillo.",

    fontFamily: "Oswald",
    fontSize: 74,
    fontWeight: 700,
    uppercase: false,
    letterSpacing: 0.005,
    lineHeight: 1.35,

    wordsPerLine: 5,
    yPercent: 85,
    marginXPercent: 5,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#FFE600",
    inactiveOpacity: 0.92,

    outlineColor: "#000000",
    outlineWidth: 0,

    shadowColor: "transparent",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,

    backgroundMode: "line",
    backgroundColor: "rgba(0,0,0,0.78)",
    backgroundPaddingX: 24,
    backgroundPaddingY: 10,
    backgroundRadius: 6,

    highlightMode: "color",
    activeWordScale: 1.0,

    animation: "fade",
    animationDuration: 100,
  },

  // ── Hot Box ──────────────────────────────────────────────────────────────────
  // Caja roja intensa en CADA palabra — el look clásico de ventas/urgencia.
  // La palabra activa crece 1.18× (scale) para marcar cuál se está diciendo.
  // Sin outline: la caja y la sombra garantizan el contraste en cualquier fondo.
  {
    id: "hot_box",
    name: "Hot Box",
    description:
      "Caja roja intensa detrás de cada palabra. La activa crece ligeramente. Alto contraste, máximo impacto para Reels de ventas y urgencia.",

    fontFamily: "Oswald",
    fontSize: 96,
    fontWeight: 700,
    uppercase: true,
    letterSpacing: 0.02,
    lineHeight: 1.25,

    wordsPerLine: 3,
    yPercent: 82,
    marginXPercent: 5,
    textAlign: "center",

    primaryColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",
    inactiveOpacity: 0.72,

    outlineColor: "#7F1D1D",
    outlineWidth: 0,

    shadowColor: "rgba(0,0,0,0.70)",
    shadowOffsetX: 0,
    shadowOffsetY: 4,
    shadowBlur: 10,

    // ── Red box behind every word ───────────────────────────────────────────
    backgroundMode: "word",
    backgroundColor: "rgba(220,38,38,0.94)",
    backgroundPaddingX: 18,
    backgroundPaddingY: 9,
    backgroundRadius: 8,

    highlightMode: "scale",
    activeWordScale: 1.18,

    animation: "zoom",
    animationDuration: 140,
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
