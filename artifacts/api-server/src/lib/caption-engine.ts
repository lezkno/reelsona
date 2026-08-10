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
 *  6. Upload the captioned video to Replit Object Storage (GCS) for permanent persistence
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import OpenAI from "openai";
import { logger } from "./logger";
import { objectStorageClient } from "./objectStorage";

const execFileAsync = promisify(execFile);

export const CAPTION_DIR = "/tmp/contentpilot-captioned";

// Bundled fonts shipped with the API server
// Use import.meta.url for ESM compatibility (works in both tsx/esm and esbuild output)
const _dir = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(_dir, "../assets/fonts");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CaptionStyle {
  presetId: string;
  position: "top" | "center" | "bottom";  // legacy — yPosition takes priority
  yPosition: number;                       // 0–100, percent from top of video
  marginX: number;                         // left (and symmetric right) margin in video pixels
  wordsPerLine: number;
  primaryColor: string;        // CSS hex (#RRGGBB)
  activeWordColor: string;     // CSS hex — active-word highlight
  outlineColor: string;        // CSS hex
  backgroundColor: string | null; // CSS rgba() or null
  fontFamily: string;
  fontSize: number;
  lineSpacingFactor: number;   // multiplier: 1.0 = tightest, 2.0 = very spaced
  activeWordScale: number;     // unused in v3 (scale overrides cause ASS issues)
  highlightMode: "color" | "scale" | "both" | "mixed" | "zoom";
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
  // Return the FAMILY name (not the full name with weight suffix).
  // libass uses Bold=-1 (set in every ASS style) to select the bold/extrabold
  // variant automatically — e.g. "Poppins" + Bold → libass picks Poppins ExtraBold.
  // Passing the full name "Poppins ExtraBold" with Bold=-1 causes libass to apply
  // synthetic bold on top of an already-extrabold font, making it look too heavy.
  const map: Record<string, string> = {
    Oswald: "Oswald",
    Bangers: "Bangers",
    Poppins: "Poppins",
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
  // yPosition: 0=top edge, 100=bottom edge (percent from top of video)
  // Convert to ASS bottom-aligned marginV so text sits at that Y coordinate
  const yPos    = config.yPosition ?? (config.position === "top" ? 15 : config.position === "center" ? 50 : 75);
  const marginX = config.marginX ?? 60;
  const alignment = 2;
  const marginV = Math.round(videoHeight * (1 - yPos / 100));
  const fontName = resolveFontName(config.fontFamily);

  const primaryColor = hexToAss(config.primaryColor);
  const activeColor  = hexToAss(config.activeWordColor);
  const outlineColor = hexToAss(config.outlineColor);
  const backColor    = config.backgroundColor ? rgbaToAss(config.backgroundColor) : "&H00000000";
  const borderStyle  = config.backgroundColor ? 3 : 1;
  // Match preview CSS text-shadow (2px at 444px preview = ~8.7 ASS pts at 1920px).
  // Use 7 (smooth ASS outline renders more prominently than blocky CSS shadow).
  const outlineWidth = borderStyle === 3 ? 0 : 7;
  const shadowDepth  = borderStyle === 3 ? 0 : 2;
  // Match preview's CSS letterSpacing: "0.04em" = 0.04 × fontSize ASS units
  const letterSpacing = +(config.fontSize * 0.04).toFixed(1);

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 0
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${fontName},${config.fontSize},${primaryColor},${activeColor},${outlineColor},${backColor},-1,0,0,0,100,100,${letterSpacing},0,${borderStyle},${outlineWidth},${shadowDepth},${alignment},${marginX},${marginX},${marginV},1

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
  // Match preview CSS `${primary}88`: 0x88 hex = 53.3% opacity → ASS alpha = 0xFF - 0x88 = 0x77
  const fadedColor   = hexToAss(config.primaryColor, 0x77);

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

// ─── Rendering mode: ZOOM IN (one word at a time, scale+fade animation) ──────
//
// Each word gets its own Dialogue. It starts at 60% scale / 50% transparent
// and animates to 100% scale / fully opaque over ~200 ms using ASS \t() tags.
// Positioned with alignment=5 (middle-center) so the scale anchor is centered.

function buildZoomASS(
  wordTimings: WordTiming[],
  config: CaptionStyle,
  videoWidth: number,
  videoHeight: number
): string {
  const fontName      = resolveFontName(config.fontFamily);
  const cx            = Math.round(videoWidth / 2);
  const cy            = Math.round(videoHeight * (config.yPosition / 100));
  const primaryColor  = hexToAss(config.primaryColor);
  const accentColor   = hexToAss(config.activeWordColor);
  const outlineColor  = hexToAss(config.outlineColor);
  const letterSpacing = +(config.fontSize * 0.04).toFixed(1);
  const outlineWidth  = Math.max(4, Math.round(config.fontSize * 0.06));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 0
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${fontName},${config.fontSize},${primaryColor},${accentColor},${outlineColor},&H00000000,-1,0,0,0,100,100,${letterSpacing},0,1,${outlineWidth},2,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // If accent differs from primary, tag it; otherwise the style primary handles it
  const useAccentTag = config.activeWordColor.toUpperCase() !== config.primaryColor.toUpperCase();
  const colorPrefix  = useAccentTag ? `\\c${accentColor}` : "";
  const ANIM_MS      = 200;  // zoom duration ms

  const dialogues = wordTimings.map((w) => {
    const word    = w.text;  // preserve natural case — no forced uppercase
    const animDur = Math.min(ANIM_MS, Math.round((w.end - w.start) * 0.5));
    // Start: 60% scale, 50% transparent. Animate to 100% / fully opaque.
    const tag = `{${colorPrefix}\\pos(${cx},${cy})\\fscx60\\fscy60\\alpha&H80&\\t(0,${animDur},1,\\fscx100\\fscy100\\alpha&H00&)}`;
    return `Dialogue: 0,${msToAssTime(w.start)},${msToAssTime(w.end)},Caption,,0,0,0,,${tag}${word}`;
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

// Only the most common UNSTRESSED function words get small+white treatment.
// Content words (nouns, verbs, adjectives, adverbs) stay large+accent — even
// "the", "a", "in" can appear large in Dimidium when they carry prosodic weight.
// Keep this list SHORT: the fewer words here, the more yellow/large the output,
// which matches the Dimidium reference style.
const FUNCTION_WORDS = new Set([
  // ── English ──────────────────────────────────────────────────────────────
  // Personal pronouns
  "i","me","my","you","your","he","him","his","she","her","it","its",
  "we","us","our","they","them","their",
  // Articles & determiners
  "a","an","the","this","that","these","those",
  // Conjunctions
  "and","but","or","so","yet","nor","because","when","if","as",
  "that","which","who","while","although","though",
  // Prepositions
  "in","on","at","to","for","of","by","with","from","into","up","out",
  "about","over","under","after","before","between","through","without",
  // Common qualifiers
  "more","most","very","just","also","too","even","only","not","no",
  "is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might",
  // ── Spanish ──────────────────────────────────────────────────────────────
  // Artículos
  "el","la","los","las","un","una","unos","unas","al","del",
  // Pronombres personales
  "yo","me","mi","tú","tu","te","él","ella","nosotros","ellos","se","nos",
  "le","les","lo","la","los","las",
  // Preposiciones comunes (las más frecuentes)
  "a","de","en","con","por","para","sobre","bajo","entre","desde",
  "hasta","hacia","sin","tras","ante","según","durante","mediante",
  // Conjunciones y conectores
  "y","e","o","pero","sino","aunque","también","más","solo","muy",
  "que","cuando","porque","como","si","ya","ni","pues","así","tan",
  // Determinantes y demostrativos frecuentes
  "este","esta","estos","estas","ese","esa","esos","esas","su","sus",
  // Verbos auxiliares comunes
  "es","son","fue","era","han","hay","ser","estar","ha","he","había",
]);

function isEmphasisWord(raw: string): boolean {
  const clean = raw.toLowerCase().replace(/[.,!?;:'"()«»]+/g, "");
  return clean.length > 0 && !FUNCTION_WORDS.has(clean);
}

function buildDimidiumASS(
  blocks: SRTBlock[],
  config: CaptionStyle,
  videoWidth = 1080,
  videoHeight = 1920
): string {
  const fontName     = resolveFontName(config.fontFamily);
  const largeSize    = config.fontSize;                      // e.g. 130
  const smallSize    = Math.round(config.fontSize * 0.68);  // e.g. 88 — less extreme ratio than 0.56
  const accentColor  = hexToAss(config.activeWordColor);    // yellow
  const primaryColor = hexToAss(config.primaryColor);       // white
  const outlineColor = hexToAss(config.outlineColor);
  // Match preview CSS shadow: 2px at preview scale ≈ 8.7 ASS pts; use 6 here
  // (smooth ASS outline reads heavier on small function-word text than CSS shadow)
  const outlineW = 6;
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
Style: Caption,${fontName},${largeSize},${primaryColor},${accentColor},${outlineColor},&H00000000,-1,0,0,0,100,100,0,0,1,${outlineW},${shadowD},2,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // ─── Per-block word structures ──────────────────────────────────────────────
  // Each SRT block becomes ONE display line.
  // Words within a block are extracted with proportional timing so they
  // appear one by one as they're spoken.

  interface DimWord {
    text: string;
    start: number;
    end: number;
    isEmphasis: boolean;
  }
  interface DimLine { words: DimWord[] }

  const lines: DimLine[] = blocks
    .map((block) => {
      const words = block.text.split(/\s+/).filter(Boolean);
      if (!words.length) return null;
      const blockDuration = block.end - block.start;
      const totalChars = words.reduce((s, w) => s + w.length, 0) || 1;
      let cursor = block.start;
      const dimWords: DimWord[] = words.map((w, i) => {
        const dur = Math.round((w.length / totalChars) * blockDuration);
        const end = i === words.length - 1 ? block.end : cursor + dur;
        const dw: DimWord = { text: w, start: cursor, end, isEmphasis: isEmphasisWord(w) };
        cursor = end;
        return dw;
      });
      return { words: dimWords };
    })
    .filter((l): l is DimLine => l !== null);

  if (!lines.length) return `${header}\n`;

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Build ASS inline text for a line, including words [0 .. upToPos] */
  function lineText(line: DimLine, upToPos: number): string {
    return line.words
      .slice(0, upToPos + 1)
      .map((w) =>
        w.isEmphasis
          ? `{\\fs${largeSize}\\c${accentColor}}${w.text}`
          : `{\\fs${smallSize}\\c${primaryColor}}${w.text}`
      )
      .join(" ");
  }

  // ─── Vertical layout ────────────────────────────────────────────────────────
  // Text is LEFT-aligned, starting from a fixed left margin — matching the
  // reference video where each new word extends the line to the right.
  const MAX_SLOTS   = 4;
  const LEFT_X      = config.marginX ?? 60;            // left margin (px)
  const lsf         = config.lineSpacingFactor ?? 1.1; // user-configurable multiplier
  const lineSpacing = Math.round(largeSize * lsf);
  const yPos    = config.yPosition ?? (config.position === "bottom" ? 94.8 : config.position === "center" ? 50 : 15);
  const baseY   = Math.round(videoHeight * (yPos / 100));

  // slotY[0] = bottom (newest line), slotY[3] = top (oldest visible)
  const slotY = Array.from({ length: MAX_SLOTS }, (_, s) => baseY - s * lineSpacing);

  // ─── Dialogue generation ────────────────────────────────────────────────────
  //
  // For each "state" — the interval between word i appearing and word i+1 appearing —
  // we emit up to MAX_SLOTS Dialogue entries:
  //   slot 0: current block in progress, text built up to word wi
  //   slot 1: previous block, complete text
  //   slot 2: block before that, complete text
  //   slot 3: block before that, complete text
  //
  // \an1 = bottom-left alignment so text grows rightward from LEFT_X.

  const dialogues: string[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    for (let wi = 0; wi < line.words.length; wi++) {
      const word = line.words[wi];

      // End of this state = start of next word (or next block's first word, or end)
      const nextWord =
        wi + 1 < line.words.length
          ? line.words[wi + 1]
          : li + 1 < lines.length
            ? lines[li + 1].words[0]
            : null;

      const stateStart = word.start;
      const stateEnd   = nextWord ? nextWord.start : word.end + 800;

      for (let slot = 0; slot < MAX_SLOTS; slot++) {
        const lineIdx = li - slot;
        if (lineIdx < 0) break;

        const text =
          slot === 0
            ? lineText(lines[lineIdx], wi)                              // in progress
            : lineText(lines[lineIdx], lines[lineIdx].words.length - 1); // complete

        dialogues.push(
          `Dialogue: 0,${msToAssTime(stateStart)},${msToAssTime(stateEnd)},Caption,,0,0,0,,{\\an1\\pos(${LEFT_X},${slotY[slot]})}${text}`
        );
      }
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
    return buildDimidiumASS(blocks, config, videoWidth, videoHeight);
  } else if (config.highlightMode === "color") {
    return buildHighlightLineASS(wordTimings, config, videoWidth, videoHeight);
  } else if (config.highlightMode === "zoom") {
    return buildZoomASS(wordTimings, config, videoWidth, videoHeight);
  } else {
    return buildPopASS(wordTimings, config, videoWidth, videoHeight);
  }
}

// ─── AI-powered punch zoom timestamp detection ────────────────────────────────

const EMPHASIS_WORDS_RE = /\b(importante|recuerda|clave|fundamental|esencial|nunca|siempre|crítico|atención|ojo|fíjate|escucha|mira|básico|necesario|obligatorio|imprescindible)\b/i;

/**
 * Lightweight word timing shape used by findPunchZoomTimestampsAI.
 * Compatible with the browser engine's WordTiming (startMs field).
 */
export interface PunchWordTiming {
  text: string;
  startMs: number;
}

/** Ask OpenAI to pick the N most impactful sentence indices from the script. */
async function analyzeScriptForZooms(
  sentences: string[],
  count: number,
): Promise<number[]> {
  const client = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });

  const cap     = Math.min(sentences.length, 45); // token budget
  const numbered = sentences.slice(0, cap).map((s, i) => `${i}: ${s}`).join("\n");

  const { choices } = await client.chat.completions.create({
    model:       "gpt-4o-mini",
    temperature: 0,
    max_tokens:  80,
    messages: [
      {
        role:    "system",
        content: "You choose sentences in video scripts for a punch zoom visual effect. Reply ONLY with a JSON array of integers.",
      },
      {
        role:    "user",
        content:
          `From the numbered sentences below, pick exactly ${count} sentence numbers where a PUNCH ZOOM visual emphasis should fire.\n` +
          `Rules:\n` +
          `• Skip sentences 0 and 1 (intro).\n` +
          `• Spread selections across the WHOLE script — beginning, middle AND end.\n` +
          `• Prefer key facts, strong claims, emotional peaks, statistics, and calls to action.\n\n` +
          `Sentences:\n${numbered}\n\n` +
          `Reply with ONLY a JSON array of ${count} integers, e.g. [3,11,22]`,
      },
    ],
  });

  const raw   = choices[0]?.message?.content?.trim() ?? "[]";
  const match = raw.match(/\[[\d,\s]+\]/);
  const parsed = JSON.parse(match?.[0] ?? "[]") as unknown[];
  return parsed
    .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < cap)
    .slice(0, count);
}

/**
 * AI-powered punch zoom timestamp detection (shared by both caption engines).
 *
 * Asks OpenAI to select the most impactful sentences (by index), then maps
 * each to its start timestamp via word-level SRT timings.
 * Falls back to a keyword heuristic if the AI call fails.
 */
export async function findPunchZoomTimestampsAI(
  script: string,
  wordTimings: PunchWordTiming[],
  videoDuration: number,
): Promise<number[]> {
  // Scale zoom count with duration
  const maxZooms = videoDuration < 30 ? 2 : videoDuration < 70 ? 3 : 4;

  const sentences = (script.match(/[^.!?\n]+[.!?]*/g) ?? [])
    .map(s => s.trim())
    .filter(s => s.length >= 12);

  if (sentences.length < 3) {
    return _punchProportionalFallback(videoDuration, maxZooms);
  }

  // ── AI sentence selection ──────────────────────────────────────────────────
  let indices: number[] = [];
  try {
    indices = await analyzeScriptForZooms(sentences, maxZooms);
    logger.info({ indices, maxZooms }, "[PunchZoom] AI selected sentence indices");
  } catch (err) {
    logger.warn({ err }, "[PunchZoom] AI failed — heuristic fallback");
    indices = _heuristicSentenceIndices(sentences, maxZooms);
  }

  if (indices.length === 0) {
    return _punchProportionalFallback(videoDuration, maxZooms);
  }

  // ── map sentence index → first matching word in SRT ───────────────────────
  const timestamps: number[] = [];
  for (const idx of indices) {
    const sentence = sentences[idx];
    if (!sentence) continue;

    const candidates = sentence
      .replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 6);

    for (const word of candidates) {
      const norm = word.toLowerCase().replace(/[^a-záéíóúüñ0-9]/g, "");
      const hit  = wordTimings.find(wt =>
        wt.text.toLowerCase().replace(/[^a-záéíóúüñ0-9]/g, "") === norm,
      );
      if (hit) {
        timestamps.push(hit.startMs / 1000);
        break;
      }
    }
  }

  // ── fill gaps with proportional positions if AI mapping was incomplete ─────
  if (timestamps.length < maxZooms) {
    const used = new Set(timestamps.map(t => Math.round(t)));
    for (const t of _punchProportionalFallback(videoDuration, maxZooms)) {
      if (timestamps.length >= maxZooms) break;
      if (!used.has(Math.round(t))) { timestamps.push(t); used.add(Math.round(t)); }
    }
  }

  // ── deduplicate + enforce 6 s minimum spacing ──────────────────────────────
  return timestamps
    .sort((a, b) => a - b)
    .filter((t, i, arr) => {
      if (t < 3)                     return false;
      if (t > videoDuration - 4)     return false;
      if (i > 0 && t - arr[i-1] < 6) return false;
      return true;
    });
}

function _punchProportionalFallback(duration: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => duration * (i + 1) / (n + 1))
    .filter(t => t >= 3 && t < duration - 4);
}

function _heuristicSentenceIndices(sentences: string[], count: number): number[] {
  return sentences
    .map((text, idx) => {
      let score = 0;
      const wc = text.split(/\s+/).length;
      if (text.includes("!"))              score += 4;
      if (EMPHASIS_WORDS_RE.test(text))    score += 3;
      if (wc >= 4 && wc <= 14)            score += 1;
      if (idx < sentences.length * 0.15)  score -= 2;
      return { idx, score };
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, count)
    .sort((a, b) => a.idx - b.idx)
    .map(s => s.idx);
}

/**
 * Build the -filter_complex / -map arguments for a punch-zoom pre-process pass.
 * Uses trim+scale+crop+concat — reliable in FFmpeg 6.x where zoompan expression
 * support is broken when called via execFile (no shell escaping).
 *
 * Effect per timestamp T (3 s total):
 *   Normal before → scale×1.4 + center-crop (hold for 3 s) → normal after
 * All segments are re-concat for both video and audio so A/V stays in sync.
 *
 * Returns a string[] ready to spread into execFileAsync args, or null if empty.
 */
export function buildPunchZoomArgs(
  timestamps: number[],
  videoDuration: number,
  W: number,
  H: number,
): string[] | null {
  if (timestamps.length === 0) return null;

  const D          = 3.0;   // punch zoom duration in seconds
  const zoomFactor = 1.4;
  // H.264 requires even dimensions; round up
  const scaledW = Math.ceil(W * zoomFactor / 2) * 2;
  const scaledH = Math.ceil(H * zoomFactor / 2) * 2;
  const cropX   = Math.floor((scaledW - W) / 2);
  const cropY   = 0; // top of frame — face lives in upper portion of portrait videos

  type Seg = { start: number; end: number; isZoom: boolean };
  const segments: Seg[] = [];
  let cursor = 0;
  for (const T of [...timestamps].sort((a, b) => a - b)) {
    if (T - cursor > 0.05) segments.push({ start: cursor, end: T, isZoom: false });
    const endZ = Math.min(T + D, videoDuration);
    segments.push({ start: T, end: endZ, isZoom: true });
    cursor = endZ;
  }
  if (videoDuration - cursor > 0.05) {
    segments.push({ start: cursor, end: videoDuration, isZoom: false });
  }

  const n = segments.length;
  const vLabels: string[] = [];
  const aLabels: string[] = [];
  const parts: string[] = [];

  for (let i = 0; i < n; i++) {
    const { start, end, isZoom } = segments[i];
    const isLast  = end >= videoDuration - 0.05;
    const endClip = isLast ? "" : `:end=${end.toFixed(4)}`;
    const vTrim = `[0:v]trim=start=${start.toFixed(4)}${endClip},setpts=PTS-STARTPTS`;
    const aTrim = `[0:a]atrim=start=${start.toFixed(4)}${endClip},asetpts=PTS-STARTPTS`;

    if (isZoom) {
      parts.push(`${vTrim},scale=${scaledW}:${scaledH},crop=${W}:${H}:${cropX}:${cropY}[v${i}]`);
    } else {
      parts.push(`${vTrim}[v${i}]`);
    }
    parts.push(`${aTrim}[a${i}]`);
    vLabels.push(`[v${i}]`);
    aLabels.push(`[a${i}]`);
  }

  // FFmpeg concat filter requires inputs interleaved per segment: v0,a0,v1,a1,...
  const interleavedLabels = vLabels.flatMap((v, i) => [v, aLabels[i]]).join("");
  parts.push(`${interleavedLabels}concat=n=${n}:v=1:a=1[vout][aout]`);

  return [
    "-filter_complex", parts.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
  ];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function applyCaptions(
  videoUrl: string,
  script: string | null,
  config: CaptionStyle,
  options?: {
    subtitleUrl?: string | null;
    videoDurationSeconds?: number | null;
    videoEffects?: { zoom?: boolean } | null;
  }
): Promise<CaptionResult> {
  const subtitleUrl   = options?.subtitleUrl ?? null;
  const videoDurationMs = (options?.videoDurationSeconds ?? 60) * 1000;
  const zoomEnabled   = options?.videoEffects?.zoom === true;

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

    // 4. Detect source rotation AND video dimensions/fps via ffprobe.
    //    HeyGen sometimes delivers landscape-encoded frames with a rotate tag
    //    (e.g. rotate=90). FFmpeg strips that tag when re-encoding, so the
    //    browser sees the raw sideways frames. We apply a transpose filter to
    //    compensate before burning the ASS subtitles.
    //    We also probe width/height/fps/duration for the Ken Burns zoom filter.
    let rotationFilter = "";
    let videoWidth  = 1080;
    let videoHeight = 1920;
    let videoFps    = 30;
    let videoDuration = options?.videoDurationSeconds ?? 60;
    try {
      const { stdout: probeOut } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,duration:stream_tags=rotate:stream_side_data=rotation",
        "-of", "json",
        videoPath,
      ]);
      const probeJson = JSON.parse(probeOut);
      const streams: any[] = probeJson.streams ?? [];
      const stream = streams[0] ?? {};
      // Dimensions
      if (stream.width)  videoWidth  = stream.width;
      if (stream.height) videoHeight = stream.height;
      // FPS — r_frame_rate is e.g. "30/1" or "30000/1001"
      if (stream.r_frame_rate) {
        const [n, d] = String(stream.r_frame_rate).split("/").map(Number);
        if (n && d) videoFps = n / d;
      }
      // Duration
      if (stream.duration) {
        const probed = parseFloat(stream.duration);
        if (!isNaN(probed) && probed > 0) videoDuration = probed;
      }
      // rotation can live in tags.rotate or in side_data_list[].rotation
      const tagRotate = parseInt(stream.tags?.rotate ?? "0", 10);
      const sideRotate = stream.side_data_list
        ? parseInt(stream.side_data_list[0]?.rotation ?? "0", 10)
        : 0;
      const deg = tagRotate || -sideRotate; // side_data rotation is negated
      if (deg === 90 || deg === -270) {
        rotationFilter = "transpose=1,";   // 90° CW
      } else if (deg === 270 || deg === -90) {
        rotationFilter = "transpose=2,";   // 90° CCW
      } else if (deg === 180 || deg === -180) {
        rotationFilter = "transpose=2,transpose=2,"; // 180°
      }
      if (rotationFilter) {
        logger.info({ deg }, "[CaptionEngine] Applying rotation correction");
      }
    } catch (e) {
      logger.warn({ err: e }, "[CaptionEngine] ffprobe rotation detection failed — skipping");
    }

    // 4b. Optional punch-zoom pre-process pass.
    // Uses trim+scale+crop+concat (reliable in FFmpeg 6.x — zoompan with dynamic
    // expressions is broken when called via execFile without a shell).
    // Effect: 1.4× snap zoom to the avatar face region at AI-selected sentences.
    let captionInputPath = videoPath;
    if (zoomEnabled && script) {
      // Derive per-word timings from the SRT blocks for precise sentence mapping
      const srtWordTimings = extractWordTimings(blocks).map(wt => ({
        text:    wt.text,
        startMs: wt.start,   // extractWordTimings uses 'start' in ms
      }));
      const punchTs   = await findPunchZoomTimestampsAI(script, srtWordTimings, videoDuration);
      const punchArgs = buildPunchZoomArgs(punchTs, videoDuration, videoWidth, videoHeight);
      if (punchArgs) {
        const zoomPath = path.join(CAPTION_DIR, `zoom_${id}.mp4`);
        logger.info({ punchTs }, "[CaptionEngine] Applying punch zoom pre-process");
        await execFileAsync("ffmpeg", [
          "-i", videoPath,
          ...punchArgs,
          "-c:v", "libx264", "-preset", "fast", "-crf", "21",
          "-c:a", "aac", "-b:a", "192k",
          "-movflags", "+faststart",
          "-y", zoomPath,
        ], { maxBuffer: 500 * 1024 * 1024 });
        captionInputPath = zoomPath;
        logger.info({ count: punchTs.length }, "[CaptionEngine] Punch zoom applied ✓");
      }
    }

    // 5. Burn with FFmpeg — pass fontsdir so libass finds our bundled fonts
    logger.info("[CaptionEngine] Running FFmpeg (ass filter)...");

    const assFilter = `${rotationFilter}ass='${assPath}':fontsdir='${FONTS_DIR}'`;

    const { stderr } = await execFileAsync("ffmpeg", [
      "-noautorotate",          // read raw frames without auto-rotating; we handle it via transpose
      "-i", captionInputPath,
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

    // 6. Upload to Object Storage for permanent persistence
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — Object Storage not provisioned");
    }

    const filename       = path.basename(outputPath);
    const gcsObjectName  = `captioned-videos/${filename}`;
    const bucket         = objectStorageClient.bucket(bucketId);
    const gcsFile        = bucket.file(gcsObjectName);

    logger.info({ gcsObjectName }, "[CaptionEngine] Uploading captioned video to Object Storage...");
    const fileBuffer = await fs.readFile(outputPath);
    await gcsFile.save(fileBuffer, { contentType: "video/mp4" });
    // Note: do NOT call makePublic() — Replit buckets have public access prevention enforced.
    // Instead, serve the file through the API server's /api/captioned-objects/* proxy route.

    // Clean up the local output file now that it's in GCS
    await fs.unlink(outputPath).catch(() => {});

    // Build a stable public URL through the API server proxy.
    // REPLIT_DEV_DOMAIN is always set on Replit (dev and production deployments).
    const domain = process.env.REPLIT_DEV_DOMAIN;
    if (!domain) throw new Error("REPLIT_DEV_DOMAIN not set — cannot build captioned video URL");
    const publicUrl = `https://${domain}/api/captioned-objects/${gcsObjectName}`;
    logger.info({ publicUrl }, "[CaptionEngine] Captioned video persisted to Object Storage");
    return { url: publicUrl };
  } catch (err) {
    logger.error({ err }, "[CaptionEngine] Failed");
    return { url: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Presets ──────────────────────────────────────────────────────────────────
//
// Visual vocabulary of Caption Studio.
// highlightMode "color"        → Highlight Line (show N words, accent active)
// highlightMode "scale"/"both" → Pop (one word at a time, big)
// highlightMode "zoom"         → Zoom In (one word, scale+fade animation)

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
  highlightMode: "color" | "scale" | "both" | "mixed" | "zoom";
  autoMovement: boolean;
  subtleRotation: boolean;
  wordsPerLine?: number;
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
    fontSize: 130,
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
  {
    id: "zoomin",
    name: "Zoom In",
    description: "Una palabra a la vez con animación de zoom + fade. Efecto cinematográfico de alto impacto.",
    primaryColor: "#FFE600",
    activeWordColor: "#FFE600",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Oswald",
    fontSize: 150,
    activeWordScale: 1,
    highlightMode: "zoom",
    autoMovement: false,
    subtleRotation: false,
  },
  {
    id: "bold_stack",
    name: "Bold Stack",
    description: "2 palabras en Poppins bold, activa en amarillo. El estilo más viral en TikTok e IG Reels.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFE600",
    outlineColor: "#000000",
    backgroundColor: null,
    fontFamily: "Poppins",
    fontSize: 105,
    activeWordScale: 1.2,
    highlightMode: "color",
    autoMovement: false,
    subtleRotation: false,
    wordsPerLine: 2,
  },
  {
    id: "hot_box",
    name: "Hot Box",
    description: "Caja roja intensa en cada palabra. Alto contraste, máximo impacto para Reels de ventas.",
    primaryColor: "#FFFFFF",
    activeWordColor: "#FFFFFF",
    outlineColor: "#7F1D1D",
    backgroundColor: "rgba(220,38,38,0.92)",
    fontFamily: "Oswald",
    fontSize: 96,
    activeWordScale: 1,
    highlightMode: "scale",
    autoMovement: false,
    subtleRotation: false,
  },
];
