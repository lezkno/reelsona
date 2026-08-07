/**
 * Caption Engine — v1 stub
 *
 * This module is the integration point for motion captions (Captions.ai-style).
 * v1 is intentionally a no-op that returns null, causing the pipeline to fall
 * back to the original HeyGen video URL. This is safe by design.
 *
 * To connect a real render engine, implement renderCaptionedVideo() below and
 * return the processed video URL. The rest of the pipeline (DB storage, fallback
 * logic, status tracking) is already wired.
 *
 * Candidate render backends:
 *  - FFmpeg + whisper (self-hosted, needs transcription first)
 *  - Remotion (React-based programmatic video)
 *  - Captions.ai API (if/when available)
 *  - RunwayML, Creatomate, Shotstack (cloud video APIs)
 */

import { logger } from "./logger";

export interface CaptionStyle {
  presetId: string;
  position: "top" | "center" | "bottom";
  wordsPerLine: number;
  primaryColor: string;
  activeWordColor: string;
  outlineColor: string;
  backgroundColor: string | null;
  fontFamily: string;
  fontSize: number;
  activeWordScale: number;
  highlightMode: "color" | "scale" | "both";
  autoScale: boolean;
  autoMovement: boolean;
  subtleRotation: boolean;
}

export interface CaptionResult {
  /** Processed video URL, or null if render was skipped/failed (use original). */
  url: string | null;
  error?: string;
}

/**
 * v1 stub: attempts to apply motion captions to a video.
 * Currently returns null (safe fallback) until a render engine is connected.
 *
 * @param videoUrl  - Original HeyGen CDN video URL
 * @param script    - The video script text (used for transcription/word timing)
 * @param config    - Caption style configuration
 * @returns CaptionResult with url=null (fallback) in v1
 */
export async function applyCaptions(
  videoUrl: string,
  script: string | null,
  config: CaptionStyle
): Promise<CaptionResult> {
  logger.info(
    { videoUrl: videoUrl.slice(0, 60), presetId: config.presetId },
    "[CaptionEngine v1] Render engine not yet connected — using original video"
  );

  // ─── Connect real render engine here ────────────────────────────────────────
  //
  // const captionedUrl = await renderCaptionedVideo(videoUrl, script, config)
  // return { url: captionedUrl }
  //
  // ────────────────────────────────────────────────────────────────────────────

  return {
    url: null,
    error: "Caption render engine v1: not yet connected to external processor",
  };
}

/** Built-in presets — these define the visual vocabulary of Caption Studio. */
export const CAPTION_PRESETS: {
  id: string;
  name: string;
  description: string;
  primaryColor: string;
  activeWordColor: string;
  outlineColor: string;
  backgroundColor: string | null;
  fontFamily: string;
  fontSize: number;
  activeWordScale: number;
  highlightMode: "color" | "scale" | "both";
  autoMovement: boolean;
  subtleRotation: boolean;
}[] = [
  {
    id: "bold",
    name: "Bold Impact",
    description: "Texto blanco grueso, palabra activa en amarillo. Clásico de Reels virales.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFE600",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Montserrat",
    fontSize: 72,
    activeWordScale: 1.2,
    highlightMode: "both",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "neon",
    name: "Neon Glow",
    description: "Texto cian brillante con glow, estilo tech/gaming.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#00F5FF",
    outlineColor: "#003366",
    backgroundColor: null,
    fontFamily: "Montserrat",
    fontSize: 68,
    activeWordScale: 1.15,
    highlightMode: "color",
    autoMovement: true,
    subtleRotation: false,
  },
  {
    id: "fire",
    name: "Fire Energy",
    description: "Palabra activa en naranja/rojo, máxima energía y urgencia.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FF4500",
    outlineColor: "#1A0000",
    backgroundColor: null,
    fontFamily: "Montserrat",
    fontSize: 74,
    activeWordScale: 1.25,
    highlightMode: "both",
    autoMovement: true,
    subtleRotation: true,
  },
  {
    id: "minimal",
    name: "Minimal Clean",
    description: "Texto blanco fino, sin efectos extra. Profesional y legible.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Inter",
    fontSize: 60,
    activeWordScale: 1.05,
    highlightMode: "scale",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Fondo negro semitransparente, texto elegante estilo documental.",
    primaryColor: "#F5F5DC",
    activeWordColor: "#FFD700",
    outlineColor: "#000000",
    backgroundColor: "rgba(0,0,0,0.55)",
    fontFamily: "Georgia",
    fontSize: 58,
    activeWordScale: 1.1,
    highlightMode: "color",
    autoMovement: false,
    subtleRotation: false,
  },
];
