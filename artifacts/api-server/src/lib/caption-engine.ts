/**
 * Caption Engine — v3 (viral styles)
 *
 * Pipeline:
 *  1. Download the HeyGen video to a temp file
 *  2. Fetch the SRT subtitle file returned by HeyGen (word-level timings)
 *     or fall back to distributing the script evenly across the video duration
 *  3. Extract word-level timings from SRT blocks
 *  4. Build an ASS file using one of two viral rendering modes:
 *       "highlight" — show N words, highlight the active word in accent color
 *       "pop"       — one word at a time, large, centered
 *  5. Burn the ASS into the video with FFmpeg (libass) using the bundled fonts
 *  6. Serve the captioned video at /api/captioned/:file
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

// Bundled fonts shipped with the API server
const FONTS_DIR = path.join(__dirname, "../assets/fonts");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CaptionStyle {
  presetId: string;
  position: "top" | "center" | "bottom";
  wordsPerLine: number;
  primaryColor: string;        // CSS hex (#RRGGBB)
  activeWordColor: string;     // CSS hex — active-word highlight
  outlineColor: string;        // CSS hex
  backgroundColor: string | null; // CSS rgba() or null
  fontFamily: string;
  fontSize: number;
  activeWordScale: number;     // unused in v3 (scale overrides cause ASS issues)
  highlightMode: "color" | "scale" | "both" | "mixed";
  autoScale: boolean;
  autoMovement: boolean;
  subtleRotation: boolean;
}

export interface CaptionResult {
  url: string | null;
  error?: string;
}

// ─── Word-level timing ────────────────────────────────────────────────────────

interface WordTiming {
  text: string;
  start: number; // ms
  end: number;   // ms
}

interface SRTBlock {
  start: number; // ms
  end: number;
  text: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await axios.get(url, { responseType: "stream", timeout: 120_000 });
  return new Promise((resolve, reject) => {
    const writer = createWriteStream(dest);
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

/** CSS hex → ASS color string &HAABBGGRR (ASS uses BGR order) */
function hexToAss(hex: string, alpha = 0): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const aa = alpha.toString(16).padStart(2, "0").toUpperCase();
  return `&H${aa}${b}${g}${r}`.toUpperCase();
}

/** CSS rgba() → ASS color string */
function rgbaToAss(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return "&H80000000";
  const r = parseInt(m[1]).toString(16).padStart(2, "0");
  const g = parseInt(m[2]).toString(16).padStart(2, "0");
  const b = parseInt(m[3]).toString(16).padStart(2, "0");
  const alphaF = m[4] !== undefined ? parseFloat(m[4]) : 1;
  const aa = Math.round((1 - alphaF) * 255).toString(16).padStart(2, "0").toUpperCase();
  return `&H${aa}${b}${g}${r}`.toUpperCase();
}

/** ms → ASS timestamp H:MM:SS.cc */
function msToAssTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const cs = Math.floor((ms % 1_000) / 10); // centiseconds
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** SRT timestamp HH:MM:SS,mmm → ms */
function srtTimeToMs(ts: string): number {
  const [hms, ms] = ts.split(",");
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3_600_000 + m * 60_000 + s * 1_000 + parseInt(ms ?? "0");
}

// ─── SRT parsing ─────────────────────────────────────────────────────────────

function parseSRT(srt: string): SRTBlock[] {
  const blocks: SRTBlock[] = [];
  const entries = srt.trim().split(/\n\s*\n/);
  for (const entry of entries) {
    const lines = entry.trim().split("\n");
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [startRaw, endRaw] = timeLine.split("-->").map((s) => s.trim());
    const text = lines
      .filter((l) => l !== timeLine && !/^\d+$/.test(l.trim()))
      .join(" ")
      .replace(/<[^>]+>/g, "")  // strip HTML tags
      .trim();
    if (!text) continue;
    blocks.push({ start: srtTimeToMs(startRaw), end: srtTimeToMs(endRaw), text });
  }
  return blocks;
}

/** Fallback SRT from plain script, distributing time evenly across word groups */
function generateBasicSRT(script: string, durationMs: number): string {
  const words = script.trim().split(/\s+/).filter(Boolean);
  const WORDS_PER_BLOCK = 5;
  const msPerWord = durationMs / Math.max(1, words.length);
  const fmt = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    const ms3 = Math.floor(ms % 1_000);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms3).padStart(3,"0")}`;
  };
  const chunks: string[] = [];
  let idx = 1;
  for (let i = 0; i < words.length; i += WORDS_PER_BLOCK) {
    const chunk = words.slice(i, i + WORDS_PER_BLOCK);
    const startMs = i * msPerWord;
    const endMs = Math.min((i + WORDS_PER_BLOCK) * msPerWord, durationMs);
    chunks.push(`${idx}\n${fmt(startMs)} --> ${fmt(endMs)}\n${chunk.join(" ")}`);
    idx++;
  }
  return chunks.join("\n\n");
}

// ─── Word-level timing extraction ────────────────────────────────────────────

/**
 * Expand SRT blocks into individual word timings.
 * Within each block, time is distributed proportionally by word character count.
 */
function extractWordTimings(blocks: SRTBlock[]): WordTiming[] {
  const result: WordTiming[] = [];
  for (const block of blocks) {
    const words = block.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const blockDuration = block.end - block.start;
    const totalChars = words.reduce((sum, w) => sum + w.length, 0) || 1;
    let cursor = block.start;
    for (let i = 0; i < words.length; i++) {
      const wordDuration = Math.round((words[i].length / totalChars) * blockDuration);
      const wordEnd = i === words.length - 1 ? block.end : cursor + wordDuration;
      result.push({ text: words[i], start: cursor, end: wordEnd });
      cursor = wordEnd;
    }
  }
  return result;
}

// ─── Font mapping ─────────────────────────────────────────────────────────────

function resolveFontName(fontFamily: string): string {
  const map: Record<string, string> = {
    Oswald: "Oswald",
    Bangers: "Bangers",
    Poppins: "Poppins ExtraBold",
    "DejaVu Sans": "DejaVu Sans",
    "DejaVu Serif": "DejaVu Serif",
    Montserrat: "DejaVu Sans",
    Inter: "DejaVu Sans",
    Georgia: "DejaVu Serif",
    Arial: "DejaVu Sans",
  };
  return map[fontFamily] ?? "Oswald";
}

// ─── ASS header builder ───────────────────────────────────────────────────────

function buildASSHeader(
  config: CaptionStyle,
  videoWidth: number,
  videoHeight: number
): string {
  const alignment = config.position === "top" ? 8 : config.position === "center" ? 5 : 2;
  const marginV = config.position === "center" ? 0 : 120;
  const fontName = resolveFontName(config.fontFamily);

  const primaryColor = hexToAss(config.primaryColor);
  const activeColor  = hexToAss(config.activeWordColor);
  const outlineColor = hexToAss(config.outlineColor);
  const backColor    = config.backgroundColor ? rgbaToAss(config.backgroundColor) : "&H00000000";
  const borderStyle  = config.backgroundColor ? 3 : 1;
  const outlineWidth = borderStyle === 3 ? 0 : 5;   // thick outline for no-bg styles
  const shadowDepth  = borderStyle === 3 ? 0 : 2;
  const letterSpacing = 1.5;

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 0
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${fontName},${config.fontSize},${primaryColor},${activeColor},${outlineColor},${backColor},-1,0,0,0,100,100,${letterSpacing},0,${borderStyle},${outlineWidth},${shadowDepth},${alignment},60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
}

// ─── Rendering mode: HIGHLIGHT LINE ──────────────────────────────────────────
//
// Shows wordsPerLine words simultaneously.
// The active word is rendered in activeWordColor; inactive words in primaryColor.
// For each word-slot in the line, a separate Dialogue entry is generated with
// inline \c color overrides — this gives the TikTok / Reels "word highlight" look.
//
// Before-active words: slightly faded (50% alpha) to focus the eye
// Active word: accent color, no alpha
// After-active words: primary color, no alpha

function buildHighlightLineASS(
  wordTimings: WordTiming[],
  config: CaptionStyle,
  videoWidth: number,
  videoHeight: number
): string {
  const header = buildASSHeader(config, videoWidth, videoHeight);
  const wordsPerLine = Math.max(1, config.wordsPerLine);

  const accentColor  = hexToAss(config.activeWordColor);
  const primaryColor = hexToAss(config.primaryColor);
  // Faded version of primary color (50% alpha = &H80)
  const fadedColor   = hexToAss(config.primaryColor, 0x60);

  const dialogues: string[] = [];

  // Group word timings into lines
  for (let i = 0; i < wordTimings.length; i += wordsPerLine) {
    const lineWords = wordTimings.slice(i, Math.min(i + wordsPerLine, wordTimings.length));

    // For each word position in the line, emit one Dialogue entry
    for (let wi = 0; wi < lineWords.length; wi++) {
      const slotStart = lineWords[wi].start;
      const slotEnd   = wi + 1 < lineWords.length ? lineWords[wi + 1].start : lineWords[wi].end;

      // Build the styled line text
      const parts = lineWords.map((w, j) => {
        const word = w.text.toUpperCase();
        if (j === wi) {
          // Active word: accent color, bold marker (already bold in style but emphasize)
          return `{\\c${accentColor}}${word}{\\c${primaryColor}}`;
        } else if (j < wi) {
          // Already-spoken words: faded
          return `{\\c${fadedColor}}${word}{\\c${primaryColor}}`;
        } else {
          // Upcoming words: primary color
          return word;
        }
      });

      dialogues.push(
        `Dialogue: 0,${msToAssTime(slotStart)},${msToAssTime(slotEnd)},Caption,,0,0,0,,${parts.join(" ")}`
      );
    }
  }

  return `${header}\n${dialogues.join("\n")}`;
}

// ─── Rendering mode: POP (one word at a time) ────────────────────────────────
//
// Each word gets its own Dialogue entry with the word's exact duration.
// Words appear one at a time, centered, large — closest to the "Energy" style.
// If highlightMode is "both", the word is rendered in accentColor.

function buildPopASS(
  wordTimings: WordTiming[],
  config: CaptionStyle,
  videoWidth: number,
  videoHeight: number
): string {
  const header = buildASSHeader(config, videoWidth, videoHeight);
  const useAccentColor = config.highlightMode === "both";
  const accentColor = hexToAss(config.activeWordColor);
  const colorTag = useAccentColor ? `{\\c${accentColor}}` : "";

  const dialogues = wordTimings.map((w) => {
    const word = w.text.toUpperCase();
    return `Dialogue: 0,${msToAssTime(w.start)},${msToAssTime(w.end)},Caption,,0,0,0,,${colorTag}${word}`;
  });

  return `${header}\n${dialogues.join("\n")}`;
}

// ─── Rendering mode: DIMIDIUM (mixed sizes + line stacking) ──────────────────
//
// Inspired by the "Dimidium" caption app style seen in reference video.
// Rules:
//  - Content words (nouns, verbs, adjectives) → large font + accent color
//  - Function words (the, and, they, to, …)  → small font + primary color
//  - Natural casing preserved (NO uppercase)
//  - Lines stack vertically: newest at bottom, older lines push upward
//  - Window of MAX_VISIBLE_LINES lines visible simultaneously

const FUNCTION_WORDS = new Set([
  "the","a","an","and","but","or","in","on","at","to","for","of","with","by",
  "they","you","we","i","it","this","that","is","are","was","were","be","been",
  "have","has","had","do","does","did","will","would","could","should","may",
  "might","can","my","your","our","their","its","his","her","not","no","so",
  "as","if","then","than","more","most","just","about","up","out","from","into",
  "over","under","after","before","also","very","really","too","now","here",
  "there","when","what","who","how","why","where","which","these","those","am",
  "were","being","get","got","go","went","come","came","see","saw","know","knew",
  "think","say","said","want","use","find","give","tell","work","call","feel",
  "try","ask","need","seem","turn","start","show","hear","play","run","move",
  "live","believe","hold","bring","happen","write","sit","stand","lose","pay",
  "meet","include","continue","set","learn","change","lead","understand","watch",
]);

function isEmphasisWord(raw: string): boolean {
  const clean = raw.toLowerCase().replace(/[.,!?;:'"()«»]+/g, "");
  return clean.length > 0 && !FUNCTION_WORDS.has(clean);
}

function buildDimidiumASS(
  wordTimings: WordTiming[],
  config: CaptionStyle,
  videoWidth = 1080,
  videoHeight = 1920
): string {
  const fontName     = resolveFontName(config.fontFamily);
  const largeSize    = config.fontSize;                       // e.g. 80
  const smallSize    = Math.round(config.fontSize * 0.56);   // e.g. 45
  const accentColor  = hexToAss(config.activeWordColor);     // yellow
  const primaryColor = hexToAss(config.primaryColor);        // white
  const outlineColor = hexToAss(config.outlineColor);

  // Thick outline for large text; thinner for small
  const outlineW = 4;
  const shadowD  = 2;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 0
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${fontName},${largeSize},${primaryColor},${accentColor},${outlineColor},&H00000000,-1,0,0,0,100,100,0.3,0,1,${outlineW},${shadowD},2,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // Group word timings into display lines
  const wordsPerLine = Math.max(2, config.wordsPerLine);
  interface DisplayLine { words: WordTiming[]; start: number; end: number; text: string }
  const lines: DisplayLine[] = [];

  for (let i = 0; i < wordTimings.length; i += wordsPerLine) {
    const chunk = wordTimings.slice(i, i + wordsPerLine);
    if (!chunk.length) continue;

    // Build mixed-size ASS text — preserve original casing
    const textParts = chunk.map((w) => {
      if (isEmphasisWord(w.text)) {
        // Large + accent color + slightly bolder spacing
        return `{\\fs${largeSize}\\c${accentColor}}${w.text}`;
      } else {
        // Small + primary color
        return `{\\fs${smallSize}\\c${primaryColor}}${w.text}`;
      }
    });

    lines.push({
      words: chunk,
      start: chunk[0].start,
      end:   chunk[chunk.length - 1].end,
      text:  textParts.join(" "),
    });
  }

  if (!lines.length) return `${header}\n`;

  // Vertical stacking: lines stack bottom → top
  // Each line is visible for MAX_VISIBLE_LINES "slots" then disappears
  const MAX_VISIBLE_LINES = 4;
  const CENTER_X    = Math.round(videoWidth / 2);
  const lineSpacing = Math.round(videoHeight * 0.088); // ~169px at 1920
  const baseY       = videoHeight - 70;               // bottom anchor

  // slotY[0] = bottom (newest), slotY[3] = top (oldest visible)
  const slotY = Array.from({ length: MAX_VISIBLE_LINES }, (_, s) => baseY - s * lineSpacing);

  const dialogues: string[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    for (let slot = 0; slot < MAX_VISIBLE_LINES; slot++) {
      // This line occupies slot `slot` when line `li + slot` is the current newest line.
      const newestIdx = li + slot;
      if (newestIdx >= lines.length) break; // no more lines → this slot never appears

      const slotStart = lines[newestIdx].start;
      const slotEnd   = newestIdx + 1 < lines.length
        ? lines[newestIdx + 1].start
        : lines[lines.length - 1].end + 800; // linger 800ms after last word

      const yPos = slotY[slot]; // bottom when slot=0, rises as slot increases

      dialogues.push(
        `Dialogue: 0,${msToAssTime(slotStart)},${msToAssTime(slotEnd)},Caption,,0,0,0,,{\\an2\\pos(${CENTER_X},${yPos})}${line.text}`
      );
    }
  }

  return `${header}\n${dialogues.join("\n")}`;
}

// ─── Main ASS builder dispatcher ─────────────────────────────────────────────

function buildASS(
  blocks: SRTBlock[],
  config: CaptionStyle,
  videoWidth = 1080,
  videoHeight = 1920
): string {
  const wordTimings = extractWordTimings(blocks);

  if (config.highlightMode === "mixed") {
    return buildDimidiumASS(wordTimings, config, videoWidth, videoHeight);
  } else if (config.highlightMode === "color") {
    return buildHighlightLineASS(wordTimings, config, videoWidth, videoHeight);
  } else {
    return buildPopASS(wordTimings, config, videoWidth, videoHeight);
  }
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
  const subtitleUrl   = options?.subtitleUrl ?? null;
  const videoDurationMs = (options?.videoDurationSeconds ?? 60) * 1000;

  try {
    await ensureDir(CAPTION_DIR);
    const id          = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const videoPath   = path.join(CAPTION_DIR, `in_${id}.mp4`);
    const assPath     = path.join(CAPTION_DIR, `captions_${id}.ass`);
    const outputPath  = path.join(CAPTION_DIR, `captioned_${id}.mp4`);

    // 1. Download HeyGen video
    logger.info({ url: videoUrl.slice(0, 80) }, "[CaptionEngine] Downloading source video...");
    await downloadFile(videoUrl, videoPath);

    // 2. Get SRT
    let srtContent: string | null = null;
    if (subtitleUrl) {
      try {
        logger.info("[CaptionEngine] Fetching SRT from HeyGen...");
        const srtRes = await axios.get<string>(subtitleUrl, { responseType: "text", timeout: 30_000 });
        srtContent = srtRes.data;
        logger.info({ blocks: srtContent.trim().split(/\n\s*\n/).length }, "[CaptionEngine] SRT downloaded");
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

    // 3. Parse SRT → ASS
    const blocks = parseSRT(srtContent);
    if (blocks.length === 0) {
      return { url: null, error: "SRT parsed to 0 blocks" };
    }
    logger.info({ blocks: blocks.length }, "[CaptionEngine] SRT parsed");

    const assContent = buildASS(blocks, config);
    await fs.writeFile(assPath, assContent, "utf-8");

    // 4. Burn with FFmpeg — pass fontsdir so libass finds our bundled fonts
    logger.info("[CaptionEngine] Running FFmpeg (ass filter)...");

    // Escape the paths for the ass filter parameter (colons need escaping on some platforms)
    const assFilter = `ass='${assPath}':fontsdir='${FONTS_DIR}'`;

    const { stderr } = await execFileAsync("ffmpeg", [
      "-i", videoPath,
      "-vf", assFilter,
      "-c:a", "copy",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ]);

    if (stderr) {
      const lastLine = stderr.trim().split("\n").at(-1) ?? "";
      if (lastLine) logger.debug({ ffmpeg: lastLine }, "[CaptionEngine] ffmpeg");
    }

    // 5. Clean up temp input files
    await Promise.all([
      fs.unlink(videoPath).catch(() => {}),
      fs.unlink(assPath).catch(() => {}),
    ]);

    // 6. Build public URL
    const filename  = path.basename(outputPath);
    const devDomain = process.env.REPLIT_DEV_DOMAIN;
    const baseUrl   = devDomain ? `https://${devDomain}/api` : `http://localhost:8080`;
    const publicUrl = `${baseUrl}/captioned/${filename}`;

    logger.info({ publicUrl }, "[CaptionEngine] Captioned video ready");
    return { url: publicUrl };
  } catch (err) {
    logger.error({ err }, "[CaptionEngine] Failed");
    return { url: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Presets ──────────────────────────────────────────────────────────────────
//
// Visual vocabulary of Caption Studio.
// highlightMode "color"      → Highlight Line (show N words, accent active)
// highlightMode "scale"/"both" → Pop (one word at a time, big)

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
  highlightMode: "color" | "scale" | "both" | "mixed";
  autoMovement: boolean;
  subtleRotation: boolean;
}[] = [
  {
    id: "dimidium",
    name: "Dimidium",
    description: "Tamaños mixtos: palabras clave grandes en amarillo, funcionales pequeñas en blanco. Líneas se apilan desde abajo.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFE600",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Poppins",
    fontSize: 82,
    activeWordScale: 1,
    highlightMode: "mixed",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "viral",
    name: "Viral (Highlight)",
    description: "3 palabras a la vez, la activa en amarillo. El look más viral de TikTok e IG Reels.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFE600",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Oswald",
    fontSize: 88,
    activeWordScale: 1.2,
    highlightMode: "color",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "pop",
    name: "Pop (Una Palabra)",
    description: "Una palabra enorme a la vez, blanca con outline negro. Máximo impacto visual.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Oswald",
    fontSize: 110,
    activeWordScale: 1,
    highlightMode: "scale",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "energy",
    name: "Energy (Caja)",
    description: "Una palabra a la vez en caja de color. Estilo 'Energy' del video de referencia.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",
    outlineColor: "#000000",
    backgroundColor: "rgba(0,0,0,0.85)",
    fontFamily: "Oswald",
    fontSize: 96,
    activeWordScale: 1,
    highlightMode: "scale",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "fire",
    name: "Fire (Naranja)",
    description: "Estilo highlight con palabra activa en naranja intenso. Urgencia máxima.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FF5500",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Oswald",
    fontSize: 88,
    activeWordScale: 1.2,
    highlightMode: "color",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "neon",
    name: "Neon",
    description: "Palabra activa en cian brillante, estilo tech/gaming.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#00F0FF",
    outlineColor: "#001A33",
    backgroundColor: null,
    fontFamily: "Oswald",
    fontSize: 88,
    activeWordScale: 1.15,
    highlightMode: "color",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "bangers",
    name: "Bangers (Cómic)",
    description: "Fuente cómic, una palabra a la vez en acento de color. Dinámico y divertido.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FF3366",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Bangers",
    fontSize: 120,
    activeWordScale: 1,
    highlightMode: "both",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Pop limpio sin color de acento. Profesional y legible.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Oswald",
    fontSize: 96,
    activeWordScale: 1,
    highlightMode: "scale",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Caja oscura semitransparente, 3 palabras, activa en dorado. Estilo documental.",
    primaryColor: "#F0EAD6",
    activeWordColor: "#FFD700",
    outlineColor: "#000000",
    backgroundColor: "rgba(0,0,0,0.6)",
    fontFamily: "Oswald",
    fontSize: 72,
    activeWordScale: 1.1,
    highlightMode: "color",
    autoMovement: false,
    subtleRotation: false,
  },
];
