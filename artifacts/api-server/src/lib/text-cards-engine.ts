/**
 * Text Cards Engine — hook / stat / CTA overlays composited onto video.
 *
 * Pipeline position:
 *   [zoom] → [B-roll] → [text cards] → [caption compositing]
 *
 * Each card is:
 *   • Identified by GPT-4o-mini from the video script
 *   • Rendered as a full-resolution RGBA PNG (card in frame, rest transparent)
 *   • Faded in (0.3 s) and out (0.3 s) at script-driven timestamps
 *   • Placed in the lower-middle zone, above the caption area
 *
 * Graceful degradation: any failure returns the source video unchanged.
 */

import fs   from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const _dir          = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR     = path.join(_dir, "../assets/fonts");

// ── Types ─────────────────────────────────────────────────────────────────────

export type CardType = "hook" | "stat" | "cta";

/**
 * A card template saved by the user in Effects Studio.
 * When useAi is false, the text fields are used directly (no AI call during processing).
 */
export interface SavedCardTemplate {
  type: CardType;
  useAi: boolean;
  /** Text for hook or cta cards (useAi: false) */
  text?: string;
  /** Headline for stat cards (useAi: false), e.g. "2.3M" */
  headline?: string;
  /** Subtext for stat cards (useAi: false), e.g. "usuarios activos" */
  subtext?: string;
}

export interface HookCard {
  type: "hook";
  /** Full sentence / question to display */
  text: string;
}

export interface StatCard {
  type: "stat";
  /** Large headline figure, e.g. "2.3M" or "73%" */
  headline: string;
  /** Short supporting line, e.g. "creadores ya usan IA" */
  subtext: string;
}

export interface CtaCard {
  type: "cta";
  /** CTA sentence, e.g. "Seguime para más estrategias" */
  text: string;
}

export type TextCard = HookCard | StatCard | CtaCard;

// ── Constants ─────────────────────────────────────────────────────────────────

const FADE_DUR  = 0.3;  // seconds — fade in and fade out
const HOLD_SEC  = 4.0;  // default hold duration (seconds)

/** Fractional positions (0-1) in the video timeline for each card type */
const TIMING: Record<CardType, number> = {
  hook: 0.06,
  stat: 0.44,
  cta:  0.81,
};

// ── Step 1: Script analysis ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a short-video content strategist. Analyze a video script and identify up to 3 overlay text card moments.

Return ONLY valid JSON (no markdown, no explanation):
{
  "cards": [
    // Include only the card types that fit the script naturally.
    // omit any type that doesn't fit.
    { "type": "hook", "text": "<strong opening statement or surprising claim, max 12 words>" },
    { "type": "stat", "headline": "<key number/%, max 8 chars>", "subtext": "<context, max 8 words>" },
    { "type": "cta",  "text": "<call to action, max 10 words>" }
  ]
}

Rules:
- Hook: appears early, creates curiosity or presents a problem. Use the most impactful sentence.
- Stat: only include if the script contains a real number/percentage/metric. Extract it verbatim.
- CTA: a direct invitation to follow, save, or act. Keep it concise.
- Return cards in the order: hook first, then stat, then cta.
- The script may be in any language — respond in the SAME language as the script.`;

async function analyzeScriptForCards(
  script: string,
  _durationSec: number,
): Promise<TextCard[]> {
  const openai = new OpenAI({
    apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system",  content: SYSTEM_PROMPT },
      { role: "user",    content: `Script:\n\n${script}` },
    ],
    temperature: 0.3,
    max_tokens:  300,
    response_format: { type: "json_object" },
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { cards?: TextCard[] };
  const cards  = Array.isArray(parsed.cards) ? parsed.cards : [];

  // Validate each card has required fields
  return cards.filter((c): c is TextCard => {
    if (c.type === "hook") return typeof (c as HookCard).text === "string";
    if (c.type === "stat") return typeof (c as StatCard).headline === "string" && typeof (c as StatCard).subtext === "string";
    if (c.type === "cta")  return typeof (c as CtaCard).text === "string";
    return false;
  });
}

// ── Step 2: Canvas rendering ──────────────────────────────────────────────────

/**
 * Scale factor relative to 1080px reference width.
 * All dimensions in this file are defined at 1080px and scaled up/down.
 */
function sc(value: number, videoWidth: number): number {
  return Math.round(value * (videoWidth / 1080));
}

/** Word-wrap text to fit maxWidth, returning array of lines. */
function wrapText(
  ctx: Ctx,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw a rounded rectangle path (without fill/stroke). */
function roundedRect(
  ctx: Ctx,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Lazy canvas module — same pattern as browser-caption-engine. */
type CanvasModule = typeof import("@napi-rs/canvas");
let _canvasPromise: Promise<CanvasModule | null> | null = null;

async function loadCanvas(): Promise<CanvasModule | null> {
  if (_canvasPromise) return _canvasPromise;
  _canvasPromise = (async () => {
    try {
      const mod = await import("@napi-rs/canvas");
      // Register bundled fonts
      const fonts = [
        { file: "Poppins-ExtraBold.ttf",  family: "Poppins"  },
        { file: "Montserrat-Black.ttf",    family: "Montserrat" },
        { file: "Oswald-Bold.ttf",         family: "Oswald"   },
      ];
      for (const { file, family } of fonts) {
        const fp = path.join(FONTS_DIR, file);
        try { await fs.access(fp); mod.GlobalFonts.registerFromPath(fp, family); } catch { /* skip */ }
      }
      return mod;
    } catch {
      return null;
    }
  })();
  return _canvasPromise;
}

// ── Card-specific renderers ───────────────────────────────────────────────────
// Each renderer fills a full-sized RGBA canvas (transparent bg) and draws
// only the card itself. FFmpeg composites it onto the video at the right time.

// Minimal canvas 2D context interface (avoids dependency on DOM lib types).
interface Ctx {
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, sa: number, ea: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  save(): void;
  restore(): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): {
    addColorStop(offset: number, color: string): void;
  };
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
}

function renderHookCard(ctx: Ctx, card: HookCard, vw: number, vh: number): void {
  const padX  = sc(64, vw);
  const cw    = vw - padX * 2;
  const px    = sc(28, vw);
  const py    = sc(22, vw);
  const rad   = sc(20, vw);
  const fs    = sc(34, vw);
  const lh    = sc(42, vw);

  ctx.font = `bold ${fs}px Poppins, Montserrat, sans-serif`;
  const lines = wrapText(ctx, card.text, cw - px * 2);
  const ch    = py * 2 + lines.length * lh;
  const cy    = Math.round(vh * 0.54) - ch / 2;

  // Background — dark glass
  ctx.save();
  roundedRect(ctx, padX, cy, cw, ch, rad);
  ctx.fillStyle   = "rgba(0,0,0,0.76)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth   = sc(1.5, vw);
  ctx.stroke();
  ctx.restore();

  // Text
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padX + px, cy + py + i * lh);
  }
}

function renderStatCard(ctx: Ctx, card: StatCard, vw: number, vh: number): void {
  const padX  = sc(64, vw);
  const cw    = vw - padX * 2;
  const px    = sc(28, vw);
  const py    = sc(20, vw);
  const rad   = sc(20, vw);
  const headFS = sc(80, vw);
  const subFS  = sc(28, vw);
  const gap    = sc(8, vw);
  const ch     = py * 2 + headFS + gap + subFS;
  const cy     = Math.round(vh * 0.54) - ch / 2;

  // Background — sky blue solid
  ctx.save();
  roundedRect(ctx, padX, cy, cw, ch, rad);
  ctx.fillStyle = "#0ea5e9"; // sky-500
  ctx.fill();
  ctx.restore();

  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  // Headline — big number
  ctx.font      = `900 ${headFS}px Montserrat, Oswald, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(card.headline, padX + cw / 2, cy + py);

  // Subtext
  ctx.font      = `bold ${subFS}px Poppins, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(card.subtext, padX + cw / 2, cy + py + headFS + gap);
}

function renderCtaCard(ctx: Ctx, card: CtaCard, vw: number, vh: number): void {
  const padX  = sc(64, vw);
  const cw    = vw - padX * 2;
  const px    = sc(28, vw);
  const py    = sc(22, vw);
  const rad   = sc(20, vw);
  const fs    = sc(32, vw);
  const lh    = sc(40, vw);
  const arrowSz = sc(48, vw);
  const textW   = cw - px * 2 - arrowSz - sc(16, vw);

  ctx.font = `bold ${fs}px Poppins, Montserrat, sans-serif`;
  const lines = wrapText(ctx, card.text, textW);
  const ch    = py * 2 + lines.length * lh;
  const cy    = Math.round(vh * 0.54) - ch / 2;

  // Background — rose → orange gradient
  ctx.save();
  roundedRect(ctx, padX, cy, cw, ch, rad);
  const grad = ctx.createLinearGradient(padX, 0, padX + cw, 0);
  grad.addColorStop(0, "#f43f5e"); // rose-500
  grad.addColorStop(1, "#f97316"); // orange-400
  ctx.fillStyle = grad as unknown as string;
  ctx.fill();
  ctx.restore();

  // Text
  ctx.fillStyle    = "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padX + px, cy + py + i * lh);
  }

  // Arrow circle
  const arrowX = padX + cw - px - arrowSz;
  const arrowY = cy + ch / 2 - arrowSz / 2;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(arrowX + arrowSz / 2, arrowY + arrowSz / 2, arrowSz / 2, 0, Math.PI * 2);
  ctx.fill();
  // Arrow chevron
  const ax = arrowX + arrowSz * 0.37;
  const ay = arrowY + arrowSz * 0.30;
  const as = arrowSz * 0.40;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth   = sc(3, vw);
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + as, ay + as / 2);
  ctx.lineTo(ax, ay + as);
  ctx.stroke();
  ctx.restore();
}

/** Render one card as a full-resolution RGBA PNG and return the file path. */
async function renderCardPng(
  card: TextCard,
  videoWidth: number,
  videoHeight: number,
  index: number,
  tmpDir: string,
): Promise<string> {
  const mod = await loadCanvas();
  if (!mod) throw new Error("@napi-rs/canvas not available");

  const { createCanvas } = mod;
  const canvas = createCanvas(videoWidth, videoHeight);
  const ctx    = canvas.getContext("2d") as unknown as Ctx;

  // Fully transparent base
  ctx.clearRect(0, 0, videoWidth, videoHeight);

  if (card.type === "hook") renderHookCard(ctx, card, videoWidth, videoHeight);
  else if (card.type === "stat") renderStatCard(ctx, card, videoWidth, videoHeight);
  else if (card.type === "cta")  renderCtaCard(ctx, card, videoWidth, videoHeight);

  const buf  = canvas.toBuffer("image/png");
  const dest = path.join(tmpDir, `card_${index}_${card.type}.png`);
  await fs.writeFile(dest, buf);
  return dest;
}

// ── Step 3: FFmpeg compositing ────────────────────────────────────────────────

interface CardWithTiming {
  card: TextCard;
  pngPath: string;
  startSec: number;
  endSec: number;
}

async function compositeCards(
  sourcePath: string,
  cards: CardWithTiming[],
  outputPath: string,
): Promise<void> {
  if (cards.length === 0) {
    await fs.copyFile(sourcePath, outputPath);
    return;
  }

  // Build filter_complex: fade each card input, chain overlays.
  // Each PNG must be looped for the full video duration so the image stream
  // is available when the fade filter fires (which can be several seconds in).
  // Without -loop 1 -t <dur>, FFmpeg consumes the single PNG frame at t=0 and
  // the stream ends before the fade ever starts — making the card invisible.
  const videoDurationSec = cards.reduce((max, c) => Math.max(max, c.endSec), 0);
  const inputArgs: string[] = [];
  for (const c of cards) {
    inputArgs.push("-loop", "1", "-t", String(Math.ceil(videoDurationSec + 1)), "-i", c.pngPath);
  }

  const filterParts: string[] = [];
  let prevLabel = "0:v";

  for (let i = 0; i < cards.length; i++) {
    const { startSec, endSec } = cards[i];
    const inputIdx  = i + 1;                         // 0 = source video
    const fadeLabel = `c${i}`;
    const outLabel  = `f${i}`;

    const fadeOutStart = Math.max(startSec + FADE_DUR, endSec - FADE_DUR);

    filterParts.push(
      // Convert to yuva420p first so the alpha channel is preserved through fade
      `[${inputIdx}:v]` +
      `format=yuva420p,` +
      `fade=t=in:st=${startSec.toFixed(3)}:d=${FADE_DUR}:alpha=1,` +
      `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DUR}:alpha=1` +
      `[${fadeLabel}]`,
    );

    filterParts.push(
      `[${prevLabel}][${fadeLabel}]overlay=0:0:eof_action=pass[${outLabel}]`,
    );

    prevLabel = outLabel;
  }

  await execFileAsync("ffmpeg", [
    "-i", sourcePath,
    ...inputArgs,
    "-filter_complex", filterParts.join(";"),
    "-map", `[${prevLabel}]`,
    "-map", "0:a",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-c:a", "copy",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ], { maxBuffer: 500 * 1024 * 1024 });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Main entry point — analyze the script, render cards, composite onto video.
 * Returns the path to the processed video (or the original source on failure).
 */
/** Builds a TextCard directly from a SavedCardTemplate (no AI needed). Returns null if fields are missing. */
function buildCardFromTemplate(t: SavedCardTemplate): TextCard | null {
  if (t.type === "hook" && t.text) return { type: "hook", text: t.text };
  if (t.type === "cta"  && t.text) return { type: "cta",  text: t.text };
  if (t.type === "stat" && t.headline && t.subtext)
    return { type: "stat", headline: t.headline, subtext: t.subtext };
  return null;
}

/** Time window during which a card is visible — used by caption engines to suppress captions. */
export interface CardWindow { startSec: number; endSec: number; }

export async function applyTextCards(
  sourcePath: string,
  script: string,
  videoWidth: number,
  videoHeight: number,
  videoDurationSec: number,
  tmpDir: string,
  cardTemplate?: SavedCardTemplate,
): Promise<{ outputPath: string; cardWindows: CardWindow[] }> {
  try {
    let cards: TextCard[];

    if (cardTemplate && !cardTemplate.useAi) {
      // ── Template mode: use fixed card text, skip AI entirely ────────────
      const fixed = buildCardFromTemplate(cardTemplate);
      if (!fixed) {
        logger.info("[TextCards] Card template has no content — skipping");
        return { outputPath: sourcePath, cardWindows: [] };
      }
      cards = [fixed];
      logger.info({ type: cardTemplate.type }, "[TextCards] Using saved card template (no AI)");
    } else {
      // ── AI mode: analyze script to identify card moments ────────────────
      logger.info("[TextCards] Analyzing script for card moments...");
      cards = await analyzeScriptForCards(script, videoDurationSec);
      if (cards.length === 0) {
        logger.info("[TextCards] No cards identified — skipping");
        return { outputPath: sourcePath, cardWindows: [] };
      }
    }

    logger.info({ count: cards.length, types: cards.map((c) => c.type) }, "[TextCards] Cards identified");

    // Compute timing for each card based on its type
    const cardsWithTiming: CardWithTiming[] = [];
    for (let i = 0; i < cards.length; i++) {
      const card     = cards[i];
      const fraction = TIMING[card.type];
      const startSec = Math.max(1.5, videoDurationSec * fraction);
      const maxHold  = Math.max(FADE_DUR * 2 + 0.5, videoDurationSec - startSec - 1);
      const holdSec  = Math.min(HOLD_SEC, maxHold);
      const endSec   = startSec + holdSec;

      // Render PNG
      const pngPath = await renderCardPng(card, videoWidth, videoHeight, i, tmpDir);
      cardsWithTiming.push({ card, pngPath, startSec, endSec });

      logger.info(
        { type: card.type, startSec: startSec.toFixed(1), endSec: endSec.toFixed(1) },
        "[TextCards] Card rendered",
      );
    }

    // Composite onto video
    const outputPath = path.join(tmpDir, `textcards_out_${Date.now()}.mp4`);
    logger.info("[TextCards] Compositing cards onto video...");
    await compositeCards(sourcePath, cardsWithTiming, outputPath);
    logger.info("[TextCards] Text cards applied ✓");

    const cardWindows: CardWindow[] = cardsWithTiming.map(({ startSec, endSec }) => ({ startSec, endSec }));
    return { outputPath, cardWindows };
  } catch (err) {
    logger.error({ err }, "[TextCards] Failed — returning source video unchanged");
    return { outputPath: sourcePath, cardWindows: [] };
  }
}
