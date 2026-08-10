/**
 * brand-cover.ts — generate an AI-powered cover image for Instagram Reels.
 *
 * Primary path: gpt-image-1 images.generate — creates a professional branded
 * cover from the hook text and brand colors using a detailed text prompt.
 * No image reference upload needed (avoids proxy multipart issues).
 *
 * Fallback path: @napi-rs/canvas draws a styled branded JPEG cover when the
 * AI call is unavailable (missing API keys, timeout, quota, etc.).
 */

import { randomUUID } from "crypto";
import OpenAI from "openai";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { objectStorageClient } from "./objectStorage";
import { logger as rootLogger } from "./logger";

const logger = rootLogger.child({ module: "brand-cover" });

// ── helpers ───────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const c = hex.replace("#", "");
  return {
    r: parseInt(c.substring(0, 2), 16),
    g: parseInt(c.substring(2, 4), 16),
    b: parseInt(c.substring(4, 6), 16),
  };
}

function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.max(0, r - amount)},${Math.max(0, g - amount)},${Math.max(0, b - amount)})`;
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function uploadJpegToGcs(buffer: Buffer, objectName: string): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!bucketId || !domain) throw new Error("Object Storage not configured");
  const bucket = objectStorageClient.bucket(bucketId);
  await bucket.file(objectName).save(buffer, { contentType: "image/jpeg" });
  return `https://${domain}/api/captioned-objects/${objectName}`;
}

// ── Canvas fallback ───────────────────────────────────────────────────────────

async function generateCanvasCover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
): Promise<string | null> {
  try {
    const W = 1080, H = 1920;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    const accent = accentColor ?? "#ffffff";
    const { r: pr, g: pg, b: pb } = hexToRgb(primaryColor);
    const dark = darken(primaryColor, 40);

    // ── Background gradient ───────────────────────────────────────────────────
    const bgGrad = ctx.createLinearGradient(0, 0, W * 0.4, H);
    bgGrad.addColorStop(0, dark);
    bgGrad.addColorStop(0.5, primaryColor);
    bgGrad.addColorStop(1, dark);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // ── Diagonal accent band ──────────────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = 0.14;
    const bandGrad = ctx.createLinearGradient(0, H * 0.3, W, H * 0.7);
    bandGrad.addColorStop(0, "transparent");
    bandGrad.addColorStop(0.5, accent);
    bandGrad.addColorStop(1, "transparent");
    ctx.fillStyle = bandGrad;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.32);
    ctx.lineTo(W, H * 0.22);
    ctx.lineTo(W, H * 0.68);
    ctx.lineTo(0, H * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ── Left accent sidebar ───────────────────────────────────────────────────
    const sideGrad = ctx.createLinearGradient(0, 0, 0, H);
    sideGrad.addColorStop(0, "transparent");
    sideGrad.addColorStop(0.5, accent);
    sideGrad.addColorStop(1, "transparent");
    ctx.fillStyle = sideGrad;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, 18, H);
    ctx.globalAlpha = 1;

    // ── Top + bottom bars ─────────────────────────────────────────────────────
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 14);
    ctx.fillRect(0, H - 14, W, 14);

    // ── Hook text ─────────────────────────────────────────────────────────────
    const textColor = luminance(primaryColor) > 0.35 ? "#111111" : "#ffffff";
    const maxW = W - 120;
    const fontSize = hookText.length > 80 ? 72 : hookText.length > 50 ? 86 : 100;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines = wrapText(ctx, hookText.toUpperCase(), maxW);
    const lh = fontSize * 1.2;
    const totalH = lines.length * lh;
    const startY = H / 2 - totalH / 2 + lh / 2;

    // Subtle highlight box behind text
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = accent;
    ctx.fillRect(48, startY - fontSize * 0.8, W - 96, totalH + fontSize * 0.6);
    ctx.globalAlpha = 1;

    // Text shadow
    ctx.shadowColor = luminance(primaryColor) > 0.35 ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = textColor;
    lines.forEach((line, i) => ctx.fillText(line, W / 2, startY + i * lh));

    // Accent underline beneath last line
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = accent;
    const underY = startY + (lines.length - 1) * lh + fontSize * 0.65;
    ctx.fillRect(W / 2 - 160, underY, 320, 10);

    const buffer = canvas.toBuffer("image/jpeg", 92);
    const objectName = `brand-covers/${videoId}-canvas-${randomUUID().slice(0, 8)}.jpg`;
    const url = await uploadJpegToGcs(buffer, objectName);
    logger.info({ videoId, objectName }, "[BrandCover] Canvas cover uploaded");
    return url;
  } catch (err) {
    logger.error({ videoId, err }, "[BrandCover] Canvas cover failed");
    return null;
  }
}

// ── AI cover (gpt-image-1 generate) ──────────────────────────────────────────

/**
 * Build the generation prompt. Uses images.generate (no file upload) which is
 * reliably supported by the Replit AI proxy. The avatar/presenter appearance is
 * described textually instead of sent as a reference image.
 */
function buildCoverPrompt(hookText: string, primaryColor: string, accentColor: string | null): string {
  const accent = accentColor ?? "#ffffff";
  return (
    `Instagram Reel thumbnail cover image, portrait 9:16 format, 1024×1536 px, ultra-high quality photography and design.\n\n` +
    `HERO TEXT — render these words exactly, large, ultra-bold condensed sans-serif, covering ~75% of the frame width:\n` +
    `"${hookText}"\n\n` +
    `Visual design requirements:\n` +
    `• Background: deep cinematic gradient built around the primary brand color ${primaryColor} — dark, moody, professional\n` +
    `• Accent color ${accent}: applied as a glowing neon underline bar beneath the text AND as an edge light stripe on one side\n` +
    `• Add a confident, well-lit human presenter or influencer standing on the RIGHT side of the frame, facing the camera, professional attire, photographically realistic\n` +
    `• The hero text occupies the LEFT ~60% of the frame in a bold vertical stack\n` +
    `• Background atmosphere: bokeh light particles, cinematic depth-of-field, subtle abstract light streaks in ${primaryColor} tones\n` +
    `• Overall mood: high-energy modern social media advertising, vibrant yet professional, agency-grade production\n\n` +
    `Hard constraints:\n` +
    `• ONLY text allowed is the hook above — no other words, labels, captions, or UI elements\n` +
    `• No logos, watermarks, borders, or padding — full bleed edge to edge\n` +
    `• Maximum contrast between text and background for legibility on mobile screens`
  );
}

async function generateAICover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
): Promise<string | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    logger.warn({ videoId }, "[BrandCover] OpenAI not configured — skipping AI cover");
    return null;
  }

  try {
    const client = new OpenAI({ apiKey, baseURL, timeout: 120_000 });
    const prompt = buildCoverPrompt(hookText, primaryColor, accentColor);

    logger.info({ videoId, hookText, primaryColor, accentColor, promptLength: prompt.length }, "[BrandCover] Requesting AI cover from gpt-image-1 (generate)");

    // images.generate — no file upload required, works reliably with the Replit proxy.
    // images.edit was abandoned because multipart form uploads were returning non-image
    // data (SVG error placeholders) from the proxy.
    const response = await (client.images as any).generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1536",
      n: 1,
    });

    const b64 = response?.data?.[0]?.b64_json;
    if (!b64) {
      logger.warn({ videoId, responseKeys: Object.keys(response ?? {}) }, "[BrandCover] gpt-image-1 returned no b64_json");
      return null;
    }

    const imgBuffer = Buffer.from(b64, "base64");

    // Detect image format via magic bytes
    const isPng  = imgBuffer.length >= 4 && imgBuffer.readUInt32BE(0) === 0x89504e47;
    const isJpeg = imgBuffer.length >= 2 && imgBuffer[0] === 0xFF && imgBuffer[1] === 0xD8;

    if (!isPng && !isJpeg) {
      logger.warn(
        { videoId, byteLength: imgBuffer.length, prefix: imgBuffer.slice(0, 200).toString("utf-8") },
        "[BrandCover] gpt-image-1 returned unrecognised format — falling back to canvas",
      );
      return null;
    }

    let jpegBuffer: Buffer;
    if (isPng) {
      // Transcode PNG → JPEG (Instagram rejects PNG cover_url)
      const W = 1024, H = 1536;
      const cvs = createCanvas(W, H);
      const ctx2 = cvs.getContext("2d");
      const img = await loadImage(imgBuffer);  // awaits decode before drawImage
      ctx2.drawImage(img, 0, 0, W, H);
      jpegBuffer = cvs.toBuffer("image/jpeg", 92);
    } else {
      jpegBuffer = imgBuffer;
    }

    const objectName = `brand-covers/${videoId}-ai-${randomUUID().slice(0, 8)}.jpg`;
    const url = await uploadJpegToGcs(jpegBuffer, objectName);
    logger.info({ videoId, objectName }, "[BrandCover] AI cover uploaded ✓");
    return url;
  } catch (err: any) {
    logger.warn(
      { videoId, errMessage: err?.message, errStatus: err?.status },
      "[BrandCover] AI cover generation failed — will fall back to canvas"
    );
    return null;
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Generate a branded Reel cover image and return its public HTTPS URL.
 *
 * Strategy:
 *   1. Try gpt-image-1 images.generate (text prompt, no file upload).
 *   2. Fall back to a canvas-drawn branded cover (always available).
 *   3. If both fail, return null (publish proceeds without a custom cover).
 *
 * The thumbnailUrl parameter is kept for API compatibility but is no longer
 * used as an input image (the edit endpoint caused proxy issues). Instead, the
 * avatar/presenter look is described textually in the generation prompt.
 */
export async function generateBrandCover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _thumbnailUrl?: string | null,
): Promise<string | null> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!bucketId || !domain) {
    logger.warn({ videoId }, "[BrandCover] Object Storage or domain not configured — skipping");
    return null;
  }

  // 1. AI cover (gpt-image-1 generate)
  const aiUrl = await generateAICover(videoId, hookText, primaryColor, accentColor);
  if (aiUrl) return aiUrl;

  // 2. Canvas fallback
  return generateCanvasCover(videoId, hookText, primaryColor, accentColor);
}
