/**
 * Caption Engine — v2 (real implementation)
 *
 * Pipeline:
 *  1. Download the HeyGen video to a temp file
 *  2. Fetch the SRT subtitle file returned by HeyGen (word-level timings)
 *     or fall back to distributing the script evenly across the video duration
 *  3. Convert SRT → ASS with the Caption Studio style settings
 *     (colors, font, position, karaoke word-highlighting)
 *  4. Burn the ASS file into the video with FFmpeg (libass filter)
 *  5. Save the captioned video to /tmp/contentpilot-captioned/
 *  6. Return a public URL served by the API server at /api/captioned/:file
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import axios from "axios";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export const CAPTION_DIR = "/tmp/contentpilot-captioned";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CaptionStyle {
  presetId: string;
  position: "top" | "center" | "bottom";
  wordsPerLine: number;
  primaryColor: string;        // CSS hex
  activeWordColor: string;     // CSS hex — karaoke highlight
  outlineColor: string;        // CSS hex
  backgroundColor: string | null; // CSS rgba() or null
  fontFamily: string;
  fontSize: number;
  activeWordScale: number;     // e.g. 1.2 = 120%
  highlightMode: "color" | "scale" | "both";
  autoScale: boolean;
  autoMovement: boolean;
  subtleRotation: boolean;
}

export interface CaptionResult {
  /** Public URL of the captioned video, or null if rendering failed/skipped. */
  url: string | null;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 120_000,
  });
  return new Promise((resolve, reject) => {
    const writer = createWriteStream(dest);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

/**
 * Convert a CSS hex color → ASS color string (&HAABBGGRR, AA=0 means opaque).
 * ASS uses BGR order!
 */
function hexToAss(hex: string, alpha = 0): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const aa = alpha.toString(16).padStart(2, "0").toUpperCase();
  const rr = r.toString(16).padStart(2, "0").toUpperCase();
  const gg = g.toString(16).padStart(2, "0").toUpperCase();
  const bb = b.toString(16).padStart(2, "0").toUpperCase();
  return `&H${aa}${bb}${gg}${rr}`;
}

/** CSS rgba(r,g,b,a) → ASS color (converts CSS alpha → ASS alpha byte). */
function rgbaToAss(rgba: string | null): string {
  if (!rgba) return "&H00000000";
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return hexToAss(rgba.startsWith("#") ? rgba : "#000000");
  const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
  const cssAlpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
  // ASS alpha: 0 = opaque, 255 = transparent (inverse of CSS)
  const alpha = Math.round((1 - cssAlpha) * 255);
  const hex = `${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
  return hexToAss(hex, alpha);
}

// ─── SRT Parsing ─────────────────────────────────────────────────────────────

interface SRTBlock {
  start: number;  // ms
  end: number;    // ms
  text: string;
}

/** "00:00:01,234" or "00:00:01.234" → milliseconds */
function srtTimeToMs(t: string): number {
  const clean = t.trim().replace(",", ".");
  const [hms, fracStr] = clean.split(".");
  const [h, m, s] = hms.split(":").map(Number);
  const frac = fracStr ? parseInt(fracStr.padEnd(3, "0").slice(0, 3)) : 0;
  return (h * 3600 + m * 60 + s) * 1000 + frac;
}

/** ms → ASS timestamp "H:MM:SS.cs" (centiseconds) */
function msToAssTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const cs = Math.floor((ms % 1_000) / 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function parseSRT(srt: string): SRTBlock[] {
  const blocks = srt.trim().split(/\n\s*\n/);
  const result: SRTBlock[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timingIdx = lines.findIndex((l) => l.includes("-->"));
    if (timingIdx === -1) continue;
    const [startStr, endStr] = lines[timingIdx].split("-->");
    const text = lines
      .slice(timingIdx + 1)
      .join(" ")
      .trim()
      .replace(/<[^>]+>/g, ""); // strip HTML tags HeyGen sometimes includes
    if (!text) continue;
    result.push({
      start: srtTimeToMs(startStr),
      end: srtTimeToMs(endStr),
      text,
    });
  }
  return result;
}

// ─── SRT Fallback (from script + duration) ───────────────────────────────────

/**
 * When HeyGen doesn't return a subtitle_url, generate a basic SRT by
 * distributing the script words evenly across the video duration.
 */
function generateBasicSRT(script: string, durationMs: number): string {
  const words = script.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const msPerWord = durationMs / words.length;
  const WORDS_PER_BLOCK = 5;
  const blocks: string[] = [];
  let idx = 1;
  for (let i = 0; i < words.length; i += WORDS_PER_BLOCK) {
    const chunk = words.slice(i, i + WORDS_PER_BLOCK);
    const startMs = i * msPerWord;
    const endMs = Math.min((i + WORDS_PER_BLOCK) * msPerWord, durationMs);
    const fmt = (ms: number) => {
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      const ms3 = Math.floor(ms % 1_000);
      return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms3).padStart(3,"0")}`;
    };
    blocks.push(`${idx}\n${fmt(startMs)} --> ${fmt(endMs)}\n${chunk.join(" ")}`);
    idx++;
  }
  return blocks.join("\n\n");
}

// ─── ASS Generation ──────────────────────────────────────────────────────────

/**
 * Convert Caption Studio config → an ASS file string.
 *
 * Uses karaoke \kf tags for word-by-word color highlighting (when
 * highlightMode includes "color"). The secondary colour in ASS karaoke
 * is the "filled" (active) colour — matches our activeWordColor.
 */
function buildASS(
  blocks: SRTBlock[],
  config: CaptionStyle,
  videoWidth = 1080,
  videoHeight = 1920
): string {
  // ASS alignment: numpad layout — 8=top-center, 5=mid-center, 2=bot-center
  const alignment = config.position === "top" ? 8 : config.position === "center" ? 5 : 2;
  const marginV = 80; // vertical margin from edge (pixels at PlayRes scale)

  const primaryColor = hexToAss(config.primaryColor);
  // In ASS karaoke, SecondaryColour = colour of the word BEFORE it's reached,
  // then PrimaryColour fills in. We want the opposite: highlight active word.
  // Trick: set Secondary = same as Primary, use \kf so the highlight sweeps
  // in as active-word colour.
  const activeColor = hexToAss(config.activeWordColor);
  const outlineColor = hexToAss(config.outlineColor);
  const backColor = config.backgroundColor
    ? rgbaToAss(config.backgroundColor)
    : "&H00000000"; // fully transparent

  // BorderStyle 1 = outline+shadow, 3 = opaque box
  const borderStyle = config.backgroundColor ? 3 : 1;
  const outlineWidth = borderStyle === 3 ? 0 : 2.5;
  const shadowDepth = borderStyle === 3 ? 0 : 1;

  // Font: map Caption Studio names → available system fonts (DejaVu)
  const fontMap: Record<string, string> = {
    Montserrat: "DejaVu Sans",
    Inter: "DejaVu Sans",
    Georgia: "DejaVu Serif",
    Arial: "DejaVu Sans",
    "DejaVu Sans": "DejaVu Sans",
    "DejaVu Serif": "DejaVu Serif",
  };
  const fontName = fontMap[config.fontFamily] ?? "DejaVu Sans";

  const useKaraoke =
    config.highlightMode === "color" || config.highlightMode === "both";

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${fontName},${config.fontSize},${primaryColor},${activeColor},${outlineColor},${backColor},-1,0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadowDepth},${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const wordsPerLine = Math.max(1, config.wordsPerLine);

  const dialogues: string[] = [];

  for (const block of blocks) {
    const words = block.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Split into lines of wordsPerLine words each
    const lines: string[][] = [];
    for (let i = 0; i < words.length; i += wordsPerLine) {
      lines.push(words.slice(i, i + wordsPerLine));
    }

    const blockDuration = block.end - block.start;
    const lineDuration = blockDuration / lines.length;

    for (let li = 0; li < lines.length; li++) {
      const lineWords = lines[li];
      const lineStart = block.start + li * lineDuration;
      const lineEnd = lineStart + lineDuration;

      let text: string;

      if (useKaraoke && lineWords.length > 1) {
        // Distribute line duration proportionally by character count
        const totalChars = lineWords.reduce((acc, w) => acc + w.length, 0);
        const parts = lineWords.map((word) => {
          const cs = Math.max(1, Math.round((word.length / totalChars) * lineDuration / 10));
          return `{\\kf${cs}}${word}`;
        });
        text = parts.join(" ");
      } else {
        text = lineWords.join(" ");
      }

      // Add scale override for active word if highlightMode includes scale
      if (config.highlightMode === "scale" || config.highlightMode === "both") {
        const pct = Math.round(config.activeWordScale * 100);
        // Prepend a font-size override for the whole line (coarse approximation)
        // True per-word scale in ASS requires \fscx/\fscy overrides per syllable
        text = `{\\fscx${pct}\\fscy${pct}}${text}{\\fscx100\\fscy100}`;
      }

      dialogues.push(
        `Dialogue: 0,${msToAssTime(lineStart)},${msToAssTime(lineEnd)},Caption,,0,0,0,,${text}`
      );
    }
  }

  return `${header}\n${dialogues.join("\n")}`;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function applyCaptions(
  videoUrl: string,
  script: string | null,
  config: CaptionStyle,
  options?: {
    subtitleUrl?: string | null;
    videoDurationSeconds?: number | null;
  }
): Promise<CaptionResult> {
  const subtitleUrl = options?.subtitleUrl ?? null;
  const videoDurationMs = ((options?.videoDurationSeconds ?? 60) * 1000);

  try {
    await ensureDir(CAPTION_DIR);
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const videoPath = path.join(CAPTION_DIR, `in_${id}.mp4`);
    const assPath = path.join(CAPTION_DIR, `captions_${id}.ass`);
    const outputPath = path.join(CAPTION_DIR, `captioned_${id}.mp4`);

    // 1. Download HeyGen video ──────────────────────────────────────────────
    logger.info(
      { url: videoUrl.slice(0, 80) },
      "[CaptionEngine] Downloading source video..."
    );
    await downloadFile(videoUrl, videoPath);

    // 2. Get SRT ───────────────────────────────────────────────────────────
    let srtContent: string | null = null;

    if (subtitleUrl) {
      try {
        logger.info("[CaptionEngine] Fetching SRT from HeyGen...");
        const srtRes = await axios.get<string>(subtitleUrl, {
          responseType: "text",
          timeout: 30_000,
        });
        srtContent = srtRes.data;
        logger.info(
          { blocks: srtContent.trim().split(/\n\s*\n/).length },
          "[CaptionEngine] SRT downloaded"
        );
      } catch (e) {
        logger.warn({ err: e }, "[CaptionEngine] SRT download failed — using script fallback");
      }
    }

    if (!srtContent && script) {
      logger.info("[CaptionEngine] Generating basic SRT from script...");
      srtContent = generateBasicSRT(script, videoDurationMs);
    }

    if (!srtContent) {
      return { url: null, error: "No SRT source available (no subtitleUrl and no script)" };
    }

    // 3. Parse SRT → ASS ───────────────────────────────────────────────────
    const blocks = parseSRT(srtContent);
    if (blocks.length === 0) {
      return { url: null, error: "SRT parsed to 0 blocks" };
    }
    logger.info({ blocks: blocks.length }, "[CaptionEngine] SRT parsed");

    const assContent = buildASS(blocks, config);
    await fs.writeFile(assPath, assContent, "utf-8");

    // 4. Burn with FFmpeg ──────────────────────────────────────────────────
    logger.info("[CaptionEngine] Running FFmpeg (ass filter)...");
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i", videoPath,
      "-vf", `ass=${assPath}`,
      "-c:a", "copy",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ]);

    if (stderr) {
      // FFmpeg prints progress to stderr — only log the last line
      const lastLine = stderr.trim().split("\n").at(-1) ?? "";
      if (lastLine) logger.debug({ ffmpeg: lastLine }, "[CaptionEngine] ffmpeg");
    }

    // 5. Clean up input files ──────────────────────────────────────────────
    await Promise.all([
      fs.unlink(videoPath).catch(() => {}),
      fs.unlink(assPath).catch(() => {}),
    ]);

    // 6. Build public URL ──────────────────────────────────────────────────
    const filename = path.basename(outputPath);
    const devDomain = process.env.REPLIT_DEV_DOMAIN;
    const baseUrl = devDomain
      ? `https://${devDomain}/api`
      : `http://localhost:8080`;
    const publicUrl = `${baseUrl}/captioned/${filename}`;

    logger.info({ publicUrl }, "[CaptionEngine] Captioned video ready");
    return { url: publicUrl };
  } catch (err) {
    logger.error({ err }, "[CaptionEngine] Failed");
    return {
      url: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Built-in presets — visual vocabulary of Caption Studio. */
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
