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

/** One independently-configurable card slot (v2 multi-card format). */
export interface CardSlotConfig {
  enabled: boolean;
  useAi: boolean;
  text?: string;       // hook, cta
  headline?: string;   // stat
  subtext?: string;    // stat
  templateId?: string; // visual style (see CARD_STYLE_TEMPLATES)
}

/** Multi-card configuration — hook, stat and CTA each configured independently (v2 format). */
export interface MultiCardConfig {
  version: 2;
  hook: CardSlotConfig;
  stat: CardSlotConfig;
  cta:  CardSlotConfig;
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

// ── Card visual templates ─────────────────────────────────────────────────────

export interface CanvasTemplate {
  id: string;
  name: string;
  bgColor?: string;
  bgGradient?: { from: string; to: string; dir: "h" | "v" };
  borderColor?: string;
  borderWidth?: number;
  /**
   * "all"         — border on all four sides (default)
   * "left"        — no surrounding border; thick accentColor bar on left edge
   * "none"        — no border
   * "double-line" — thin accentColor lines at top and bottom
   */
  borderStyle?: "all" | "left" | "none" | "double-line";
  accentColor?: string;    // left bar or double-line color
  textColor: string;
  subtextColor?: string;
  fontFamily: string;
  textGlow?: boolean;      // canvas shadowBlur around text (and border)
  glowColor?: string;      // defaults to textColor
  cardShadow?: boolean;    // offset shadow rect behind the card (sticker look)
  pillShape?: boolean;     // uses h/2 as corner radius
  textTransform?: "upper"; // uppercases all text
  /** CSS for the UI mini-swatch */
  previewBg: string;
  previewColor: string;
  previewBorder?: string;
}

export const CARD_STYLE_TEMPLATES: CanvasTemplate[] = [
  // 1 · Oscuro — semi-transparent dark, thin white border all around
  {
    id: "dark", name: "Oscuro",
    bgColor: "rgba(0,0,0,0.82)", borderStyle: "all",
    borderColor: "rgba(255,255,255,0.18)", borderWidth: 1.5,
    textColor: "#ffffff", fontFamily: "Poppins",
    previewBg: "rgba(0,0,0,0.82)", previewColor: "#fff", previewBorder: "rgba(255,255,255,0.35)",
  },
  // 2 · Barra — dark bg + thick orange stripe on left edge, text indented
  {
    id: "accent-bar", name: "Barra",
    bgColor: "rgba(8,8,18,0.90)", borderStyle: "left", accentColor: "#f97316",
    textColor: "#ffffff", fontFamily: "Poppins",
    previewBg: "rgba(8,8,18,0.90)", previewColor: "#fff",
  },
  // 3 · Neón — near-black + green glow on border and text
  {
    id: "neon", name: "Neón",
    bgColor: "#050a0e", borderStyle: "all",
    borderColor: "#00ff88", borderWidth: 2,
    textColor: "#00ff88", fontFamily: "Oswald",
    textGlow: true, glowColor: "#00ff88",
    previewBg: "#050a0e", previewColor: "#00ff88", previewBorder: "#00ff88",
  },
  // 4 · Sticker — white card with drop shadow
  {
    id: "sticker", name: "Sticker",
    bgColor: "rgba(255,255,255,0.97)", borderStyle: "none",
    textColor: "#0f172a", subtextColor: "#374151", fontFamily: "Poppins",
    cardShadow: true,
    previewBg: "rgba(255,255,255,0.97)", previewColor: "#0f172a",
  },
  // 5 · Gradiente — vivid gradient fill, no border
  {
    id: "gradient", name: "Gradiente",
    bgGradient: { from: "#f43f5e", to: "#f97316", dir: "h" }, borderStyle: "none",
    textColor: "#ffffff", fontFamily: "Poppins",
    previewBg: "linear-gradient(90deg,#f43f5e,#f97316)", previewColor: "#fff",
  },
  // 6 · Contorno — barely-there bg, bold white border only, text shadow for contrast
  {
    id: "outline", name: "Contorno",
    bgColor: "rgba(0,0,0,0.25)", borderStyle: "all",
    borderColor: "rgba(255,255,255,0.85)", borderWidth: 2.5,
    textColor: "#ffffff", fontFamily: "Poppins",
    textGlow: true, glowColor: "rgba(0,0,0,0.9)",
    previewBg: "rgba(0,0,0,0.25)", previewColor: "#fff", previewBorder: "rgba(255,255,255,0.85)",
  },
  // 7 · Cinta — pill shape, uppercase Oswald
  {
    id: "banner", name: "Cinta",
    bgColor: "rgba(0,0,0,0.88)", borderStyle: "none",
    textColor: "#ffffff", fontFamily: "Oswald",
    pillShape: true, textTransform: "upper",
    previewBg: "rgba(0,0,0,0.88)", previewColor: "#fff",
  },
  // 8 · Doble — dark bg framed by top and bottom orange lines
  {
    id: "double-line", name: "Doble",
    bgColor: "rgba(0,0,0,0.85)", borderStyle: "double-line", accentColor: "#f97316",
    textColor: "#ffffff", fontFamily: "Poppins",
    previewBg: "rgba(0,0,0,0.85)", previewColor: "#fff",
  },
];

function getTemplate(id?: string): CanvasTemplate {
  return CARD_STYLE_TEMPLATES.find(t => t.id === id) ?? CARD_STYLE_TEMPLATES[0];
}

// ── Card-specific renderers ───────────────────────────────────────────────────
// Each renderer fills a full-sized RGBA canvas (transparent bg) and draws
// only the card itself. FFmpeg composites it onto the video at the right time.

function drawCardBg(
  ctx: Ctx,
  x: number, y: number, w: number, h: number, r: number,
  tpl: CanvasTemplate,
  vw: number,
): void {
  const borderStyle = tpl.borderStyle ?? "all";

  // ── Drop shadow (sticker) ────────────────────────────────────────────────
  if (tpl.cardShadow) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.40)";
    roundedRect(ctx, x + sc(5, vw), y + sc(7, vw), w, h, r);
    ctx.fill();
    ctx.restore();
  }

  // ── Card background ──────────────────────────────────────────────────────
  ctx.save();
  roundedRect(ctx, x, y, w, h, r);
  if (tpl.bgGradient) {
    const { from, to, dir } = tpl.bgGradient;
    const grad = ctx.createLinearGradient(x, y, dir === "h" ? x + w : x, dir === "h" ? y : y + h);
    grad.addColorStop(0, from);
    grad.addColorStop(1, to);
    ctx.fillStyle = grad as unknown as string;
  } else {
    ctx.fillStyle = tpl.bgColor ?? "rgba(0,0,0,0.82)";
  }
  ctx.fill();

  // ── All-sides border ─────────────────────────────────────────────────────
  if (borderStyle === "all" && tpl.borderColor) {
    if (tpl.textGlow && tpl.glowColor) {
      ctx.shadowColor   = tpl.glowColor;
      ctx.shadowBlur    = sc(10, vw);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.strokeStyle = tpl.borderColor;
    ctx.lineWidth   = sc(tpl.borderWidth ?? 1.5, vw);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  // ── Left accent bar ──────────────────────────────────────────────────────
  if (borderStyle === "left" && tpl.accentColor) {
    const barW = sc(10, vw);
    ctx.save();
    ctx.fillStyle = tpl.accentColor;
    // Draw bar rect — left portion of card (small corner mismatch at card edge is imperceptible)
    ctx.fillRect(x, y, barW, h);
    ctx.restore();
  }

  // ── Double-line accent (top + bottom) ────────────────────────────────────
  if (borderStyle === "double-line" && tpl.accentColor) {
    const lineH = sc(4, vw);
    ctx.save();
    ctx.fillStyle = tpl.accentColor;
    ctx.fillRect(x, y, w, lineH);             // top line
    ctx.fillRect(x, y + h - lineH, w, lineH); // bottom line
    ctx.restore();
  }
}

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
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

/** Set / clear glow effect on ctx for text rendering. */
function setTextGlow(ctx: Ctx, tpl: CanvasTemplate, vw: number, on: boolean): void {
  if (!tpl.textGlow) return;
  if (on) {
    ctx.shadowColor   = tpl.glowColor ?? tpl.textColor;
    ctx.shadowBlur    = sc(10, vw);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
    ctx.shadowBlur = 0;
  }
}

/** For accent-bar: extra left indent so text starts past the bar. */
function barIndent(tpl: CanvasTemplate, vw: number): number {
  return tpl.borderStyle === "left" ? sc(10, vw) + sc(10, vw) : 0;
}

/** Apply textTransform. */
function applyTx(text: string, tpl: CanvasTemplate): string {
  return tpl.textTransform === "upper" ? text.toUpperCase() : text;
}

/** Corner radius — pill templates use h/2. */
function cardRadius(tpl: CanvasTemplate, ch: number, vw: number): number {
  return tpl.pillShape ? Math.floor(ch / 2) : sc(20, vw);
}

function renderHookCard(ctx: Ctx, card: HookCard, vw: number, vh: number, tpl: CanvasTemplate): void {
  const padX  = sc(64, vw);
  const cw    = vw - padX * 2;
  const px    = sc(28, vw);
  const py    = sc(22, vw);
  const fs    = sc(34, vw);
  const lh    = sc(42, vw);
  const extra = barIndent(tpl, vw);

  ctx.font = `bold ${fs}px ${tpl.fontFamily}, sans-serif`;
  const textW = cw - px * 2 - extra;
  const lines = wrapText(ctx, applyTx(card.text, tpl), textW);
  const ch    = py * 2 + lines.length * lh;
  const rad   = cardRadius(tpl, ch, vw);
  const cy    = Math.round(vh * 0.54) - ch / 2;

  drawCardBg(ctx, padX, cy, cw, ch, rad, tpl, vw);

  setTextGlow(ctx, tpl, vw, true);
  ctx.fillStyle    = tpl.textColor;
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padX + px + extra, cy + py + i * lh);
  }
  setTextGlow(ctx, tpl, vw, false);
}

function renderStatCard(ctx: Ctx, card: StatCard, vw: number, vh: number, tpl: CanvasTemplate): void {
  const padX   = sc(64, vw);
  const cw     = vw - padX * 2;
  const px     = sc(28, vw);
  const py     = sc(20, vw);
  const headFS = sc(80, vw);
  const subFS  = sc(28, vw);
  const gap    = sc(8, vw);
  const ch     = py * 2 + headFS + gap + subFS;
  const rad    = cardRadius(tpl, ch, vw);
  const cy     = Math.round(vh * 0.54) - ch / 2;

  drawCardBg(ctx, padX, cy, cw, ch, rad, tpl, vw);

  setTextGlow(ctx, tpl, vw, true);
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  ctx.font      = `900 ${headFS}px ${tpl.fontFamily}, sans-serif`;
  ctx.fillStyle = tpl.textColor;
  ctx.fillText(applyTx(card.headline, tpl), padX + cw / 2, cy + py);

  ctx.font      = `bold ${subFS}px Poppins, sans-serif`;
  ctx.fillStyle = tpl.subtextColor ?? `${tpl.textColor}cc`;
  ctx.fillText(applyTx(card.subtext, tpl), padX + cw / 2, cy + py + headFS + gap);
  setTextGlow(ctx, tpl, vw, false);
}

function renderCtaCard(ctx: Ctx, card: CtaCard, vw: number, vh: number, tpl: CanvasTemplate): void {
  const padX    = sc(64, vw);
  const cw      = vw - padX * 2;
  const px      = sc(28, vw);
  const py      = sc(22, vw);
  const fs      = sc(32, vw);
  const lh      = sc(40, vw);
  const arrowSz = sc(48, vw);
  const extra   = barIndent(tpl, vw);
  const textW   = cw - px * 2 - arrowSz - sc(16, vw) - extra;

  ctx.font = `bold ${fs}px ${tpl.fontFamily}, sans-serif`;
  const lines = wrapText(ctx, applyTx(card.text, tpl), textW);
  const ch    = py * 2 + lines.length * lh;
  const rad   = cardRadius(tpl, ch, vw);
  const cy    = Math.round(vh * 0.54) - ch / 2;

  drawCardBg(ctx, padX, cy, cw, ch, rad, tpl, vw);

  setTextGlow(ctx, tpl, vw, true);
  ctx.fillStyle    = tpl.textColor;
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padX + px + extra, cy + py + i * lh);
  }
  setTextGlow(ctx, tpl, vw, false);

  // Arrow circle — semi-transparent version of text color
  const arrowX = padX + cw - px - arrowSz;
  const arrowY = cy + ch / 2 - arrowSz / 2;
  ctx.save();
  ctx.fillStyle = `${tpl.textColor}33`;
  ctx.beginPath();
  ctx.arc(arrowX + arrowSz / 2, arrowY + arrowSz / 2, arrowSz / 2, 0, Math.PI * 2);
  ctx.fill();
  const ax = arrowX + arrowSz * 0.37;
  const ay = arrowY + arrowSz * 0.30;
  const as = arrowSz * 0.40;
  ctx.strokeStyle = tpl.textColor;
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
  templateId?: string,
): Promise<string> {
  const mod = await loadCanvas();
  if (!mod) throw new Error("@napi-rs/canvas not available");

  const { createCanvas } = mod;
  const canvas = createCanvas(videoWidth, videoHeight);
  const ctx    = canvas.getContext("2d") as unknown as Ctx;

  ctx.clearRect(0, 0, videoWidth, videoHeight);

  const tpl = getTemplate(templateId);

  if (card.type === "hook") renderHookCard(ctx, card, videoWidth, videoHeight, tpl);
  else if (card.type === "stat") renderStatCard(ctx, card, videoWidth, videoHeight, tpl);
  else if (card.type === "cta")  renderCtaCard(ctx, card, videoWidth, videoHeight, tpl);

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
/** Builds a TextCard from a CardSlotConfig (manual mode). Returns null if required fields are missing. */
function buildSlotCard(type: CardType, slot: CardSlotConfig): TextCard | null {
  if (type === "hook" && slot.text) return { type: "hook", text: slot.text };
  if (type === "cta"  && slot.text) return { type: "cta",  text: slot.text };
  if (type === "stat" && slot.headline && slot.subtext)
    return { type: "stat", headline: slot.headline, subtext: slot.subtext };
  return null;
}

/**
 * Builds TextCard[] from a MultiCardConfig.
 * Manual slots are built directly; AI slots call analyzeScriptForCards filtered to those types.
 * Cards are returned in canonical order: hook → stat → cta.
 */
async function buildCardsFromMultiConfig(
  config: MultiCardConfig,
  script: string,
  durationSec: number,
): Promise<TextCard[]> {
  const manual: TextCard[] = [];
  const aiTypes: CardType[] = [];

  const slots: Array<[CardType, CardSlotConfig]> = [
    ["hook", config.hook],
    ["stat", config.stat],
    ["cta",  config.cta],
  ];

  for (const [type, slot] of slots) {
    if (!slot.enabled) continue;
    if (slot.useAi) {
      aiTypes.push(type);
    } else {
      const card = buildSlotCard(type, slot);
      if (card) manual.push(card);
    }
  }

  if (aiTypes.length > 0) {
    const aiCards = await analyzeScriptForCards(script, durationSec);
    manual.push(...aiCards.filter(c => aiTypes.includes(c.type)));
  }

  const ORDER: CardType[] = ["hook", "stat", "cta"];
  return manual.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}

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
  cardConfig?: MultiCardConfig | SavedCardTemplate,
): Promise<{ outputPath: string; cardWindows: CardWindow[] }> {
  try {
    let cards: TextCard[];

    if (cardConfig && "version" in cardConfig) {
      // ── Multi-card config (v2) — process each enabled slot ───────────────
      cards = await buildCardsFromMultiConfig(cardConfig, script, videoDurationSec);
      if (cards.length === 0) {
        logger.info("[TextCards] No enabled cards in multi-card config — skipping");
        return { outputPath: sourcePath, cardWindows: [] };
      }
    } else if (cardConfig && !cardConfig.useAi) {
      // ── Legacy single-card template, manual text ─────────────────────────
      const fixed = buildCardFromTemplate(cardConfig);
      if (!fixed) {
        logger.info("[TextCards] Card template has no content — skipping");
        return { outputPath: sourcePath, cardWindows: [] };
      }
      cards = [fixed];
      logger.info({ type: cardConfig.type }, "[TextCards] Using legacy card template (no AI)");
    } else {
      // ── Legacy AI mode / no config — analyze full script ─────────────────
      logger.info("[TextCards] Analyzing script for card moments...");
      cards = await analyzeScriptForCards(script, videoDurationSec);
      if (cards.length === 0) {
        logger.info("[TextCards] No cards identified — skipping");
        return { outputPath: sourcePath, cardWindows: [] };
      }
    }

    logger.info({ count: cards.length, types: cards.map((c) => c.type) }, "[TextCards] Cards identified");

    // Build template map: card type → templateId
    const templateMap: Partial<Record<CardType, string>> = {};
    if (cardConfig && "version" in cardConfig) {
      if (cardConfig.hook.templateId) templateMap.hook = cardConfig.hook.templateId;
      if (cardConfig.stat.templateId) templateMap.stat = cardConfig.stat.templateId;
      if (cardConfig.cta.templateId)  templateMap.cta  = cardConfig.cta.templateId;
    }

    // Compute timing for each card based on its type
    const cardsWithTiming: CardWithTiming[] = [];
    for (let i = 0; i < cards.length; i++) {
      const card     = cards[i];
      const fraction = TIMING[card.type];
      const startSec = Math.max(1.5, videoDurationSec * fraction);
      const maxHold  = Math.max(FADE_DUR * 2 + 0.5, videoDurationSec - startSec - 1);
      const holdSec  = Math.min(HOLD_SEC, maxHold);
      const endSec   = startSec + holdSec;

      // Render PNG with the template selected for this card type
      const pngPath = await renderCardPng(card, videoWidth, videoHeight, i, tmpDir, templateMap[card.type]);
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
