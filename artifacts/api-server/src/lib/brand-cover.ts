/**
 * brand-cover.ts — generate an AI-powered cover image for Instagram Reels.
 *
 * Primary path: gpt-image-1 in reference-based edit mode — the HeyGen avatar
 * thumbnail is passed as a visual reference so the model preserves the avatar's
 * look while composing a cinematic 9:16 cover with the hook text and brand colors.
 *
 * Fallback path: @napi-rs/canvas draws a simple but branded JPEG cover when the
 * AI call is unavailable (missing API keys, timeout, quota, etc.) so the publish
 * pipeline always has a cover to send to Instagram.
 */

import * as path from "path";
import * as os from "os";
import * as fsSync from "fs";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import axios from "axios";
import OpenAI, { toFile } from "openai";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { objectStorageClient } from "./objectStorage";
import { logger as rootLogger } from "./logger";

const logger = rootLogger.child({ module: "brand-cover" });

// ── helpers ──────────────────────────────────────────────────────────────────

function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
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

async function uploadJpegToGcs(
  buffer: Buffer,
  objectName: string
): Promise<string> {
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
  accentColor: string | null
): Promise<string | null> {
  try {
    const W = 1080, H = 1920;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, primaryColor);
    grad.addColorStop(1, primaryColor + "cc");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const accent = accentColor ?? "#ffffff";
    ctx.fillStyle = accent;
    ctx.fillRect(0, H - 16, W, 16);
    ctx.fillRect(0, 0, W, 8);

    const textColor = luminance(primaryColor) > 0.35 ? "#111111" : "#ffffff";
    const fontSize = hookText.length > 80 ? 62 : hookText.length > 50 ? 74 : 88;
    ctx.fillStyle = textColor;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const maxW = W - 120;
    const lines = wrapText(ctx, hookText, maxW);
    const lh = fontSize * 1.25;
    const totalH = lines.length * lh;
    const startY = H / 2 - totalH / 2 + lh / 2;

    ctx.shadowColor = luminance(primaryColor) > 0.35 ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    lines.forEach((line, i) => ctx.fillText(line, W / 2, startY + i * lh));

    const buffer = canvas.toBuffer("image/jpeg");
    const objectName = `brand-covers/${videoId}-${randomUUID().slice(0, 8)}.jpg`;
    const url = await uploadJpegToGcs(buffer, objectName);
    logger.info({ videoId, objectName }, "[BrandCover] Canvas cover uploaded");
    return url;
  } catch (err) {
    logger.error({ videoId, err }, "[BrandCover] Canvas cover failed");
    return null;
  }
}

// ── AI cover (gpt-image-1) ────────────────────────────────────────────────────

/**
 * Build the generation prompt. The model is steered toward the brand's visual
 * identity: primary/accent colors frame the hook text on the left while the
 * avatar (referenced from the thumbnail) anchors the right side.
 */
function buildCoverPrompt(
  hookText: string,
  primaryColor: string,
  accentColor: string | null
): string {
  const accent = accentColor ?? "#ffffff";
  return (
    `Create a professional Instagram Reel thumbnail cover (9:16 vertical format). ` +
    `The cover promotes a video with this hook: "${hookText}". ` +
    `Layout: the person/avatar from the reference image is positioned on the RIGHT side of the frame, ` +
    `showing an expressive, confident gesture. The LEFT 2/3 of the frame features the hook text ` +
    `"${hookText.toUpperCase()}" rendered in ultra-bold condensed white typography, large and impactful. ` +
    `Brand primary color ${primaryColor} is used as a background tone or gradient. ` +
    `Accent color ${accent} highlights the text or adds a glowing bar element. ` +
    `Background is dark and cinematic with bokeh depth-of-field. ` +
    `High contrast, agency-quality, photorealistic. No extra text, no watermarks, no logos. ` +
    `Vertical 9:16 composition filling the entire frame.`
  );
}

async function generateAICover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
  thumbnailUrl: string
): Promise<string | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    logger.warn({ videoId }, "[BrandCover] OpenAI not configured — skipping AI cover");
    return null;
  }

  let tmpFile: string | null = null;
  try {
    // Download the HeyGen thumbnail to a temp file
    const thumbResp = await axios.get<ArrayBuffer>(thumbnailUrl, {
      responseType: "arraybuffer",
      timeout: 30_000,
    });
    const thumbBuffer = Buffer.from(thumbResp.data);

    // Write to /tmp so toFile can reference it
    tmpFile = path.join(os.tmpdir(), `thumb_${videoId}_${randomUUID().slice(0, 8)}.jpg`);
    await fs.writeFile(tmpFile, thumbBuffer);

    const client = new OpenAI({ apiKey, baseURL, timeout: 120_000 });
    const prompt = buildCoverPrompt(hookText, primaryColor, accentColor);

    logger.info({ videoId, prompt: prompt.slice(0, 120) }, "[BrandCover] Requesting AI cover from gpt-image-1");

    // Use images.edit with the avatar thumbnail as a visual reference.
    // gpt-image-1 in reference-based mode (no mask) uses the input image as
    // compositional context while generating a fresh stylised frame.
    const response = await (client.images.edit as unknown as (
      body: Record<string, unknown>
    ) => Promise<{ data?: Array<{ b64_json?: string }> }>)({
      model: "gpt-image-1",
      image: await toFile(fsSync.createReadStream(tmpFile), "thumbnail.jpg", { type: "image/jpeg" }),
      prompt,
      // 1024x1536 is the documented gpt-image-1 portrait size (9:16 ≈ 2:3).
      size: "1024x1536",
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      logger.warn({ videoId }, "[BrandCover] gpt-image-1 returned no image data");
      return null;
    }

    // gpt-image-1 edit output is always PNG. Re-encode to JPEG so Instagram
    // accepts it as cover_url (Instagram rejects non-JPEG cover images).
    const pngBuffer = Buffer.from(b64, "base64");
    const W = 1024, H = 1536;
    const cvs = createCanvas(W, H);
    const ctx2 = cvs.getContext("2d");
    const { Image } = await import("@napi-rs/canvas");
    const img = new Image();
    img.src = pngBuffer;
    ctx2.drawImage(img, 0, 0, W, H);
    const imageBuffer = cvs.toBuffer("image/jpeg");

    const objectName = `brand-covers/${videoId}-ai-${randomUUID().slice(0, 8)}.jpg`;
    const url = await uploadJpegToGcs(imageBuffer, objectName);
    logger.info({ videoId, objectName }, "[BrandCover] AI cover uploaded ✓");
    return url;
  } catch (err) {
    logger.warn({ videoId, err }, "[BrandCover] AI cover generation failed — will fall back to canvas");
    return null;
  } finally {
    if (tmpFile) fs.unlink(tmpFile).catch(() => {});
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Generate a branded Reel cover image and return its public HTTPS URL.
 *
 * Strategy:
 *   1. If thumbnailUrl is available, try gpt-image-1 reference-based edit.
 *   2. Fall back to a canvas-drawn branded cover (always available, no AI cost).
 *   3. If both fail, return null (publish proceeds without a custom cover).
 */
export async function generateBrandCover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
  thumbnailUrl?: string | null
): Promise<string | null> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!bucketId || !domain) {
    logger.warn({ videoId }, "[BrandCover] Object Storage or domain not configured — skipping");
    return null;
  }

  // Try AI cover first (requires thumbnail + OpenAI keys)
  if (thumbnailUrl) {
    const aiUrl = await generateAICover(videoId, hookText, primaryColor, accentColor, thumbnailUrl);
    if (aiUrl) return aiUrl;
  }

  // Canvas fallback
  return generateCanvasCover(videoId, hookText, primaryColor, accentColor);
}
