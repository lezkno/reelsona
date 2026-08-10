/**
 * brand-cover.ts — AI-powered Instagram Reel cover generator.
 *
 * Pipeline (stops at first success):
 *   1. images.edit  — gpt-image-1 with avatar + logo as visual references (9:16 portrait).
 *      Reference images are downloaded and transcoded to PNG before upload so
 *      the proxy always receives valid image data regardless of source format.
 *   2. images.generate — text-only prompt when no references are available.
 *   3. @napi-rs/canvas — fully branded fallback, always works without OpenAI.
 */

import * as path from "path";
import * as os from "os";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import { randomUUID } from "crypto";
import axios from "axios";
import OpenAI, { toFile } from "openai";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { objectStorageClient } from "./objectStorage";
import { logger as rootLogger } from "./logger";

const logger = rootLogger.child({ module: "brand-cover" });

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Download a URL and re-encode as a PNG temp file.
 * gpt-image-1 images.edit is most reliable when given PNG (not JPEG).
 * Returns the tmp file path, or null if download/decode fails.
 */
async function downloadAsPngTempFile(url: string, label: string): Promise<string | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 20_000,
    });
    const srcBuffer = Buffer.from(resp.data);

    // Decode with loadImage so any format (JPEG, PNG, WEBP…) is handled
    const img = await loadImage(srcBuffer);
    const W = img.width > 0 ? img.width : 512;
    const H = img.height > 0 ? img.height : 512;
    const cvs = createCanvas(W, H);
    const ctx = cvs.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    const pngBuffer = cvs.toBuffer("image/png");

    const tmpPath = path.join(os.tmpdir(), `cover_ref_${label}_${randomUUID().slice(0, 8)}.png`);
    await fs.writeFile(tmpPath, pngBuffer);
    return tmpPath;
  } catch (err) {
    logger.warn({ url, label, err }, "[BrandCover] Failed to download/decode reference image — skipping");
    return null;
  }
}

/** Validate that a buffer starts with recognised image magic bytes. */
function detectImageFormat(buf: Buffer): "png" | "jpeg" | "unknown" {
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8) return "jpeg";
  return "unknown";
}

/** Transcode any recognised image buffer to JPEG (for Instagram compatibility). */
async function toJpeg(imgBuffer: Buffer, W: number, H: number): Promise<Buffer> {
  const cvs = createCanvas(W, H);
  const ctx = cvs.getContext("2d");
  const img = await loadImage(imgBuffer);
  ctx.drawImage(img, 0, 0, W, H);
  return cvs.toBuffer("image/jpeg", 92);
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

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, W * 0.4, H);
    bgGrad.addColorStop(0, `rgb(${Math.max(0,pr-40)},${Math.max(0,pg-40)},${Math.max(0,pb-40)})`);
    bgGrad.addColorStop(0.55, primaryColor);
    bgGrad.addColorStop(1, `rgb(${Math.max(0,pr-40)},${Math.max(0,pg-40)},${Math.max(0,pb-40)})`);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Diagonal accent band
    ctx.save();
    ctx.globalAlpha = 0.13;
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

    // Left sidebar accent
    const sideGrad = ctx.createLinearGradient(0, 0, 0, H);
    sideGrad.addColorStop(0, "transparent");
    sideGrad.addColorStop(0.5, accent);
    sideGrad.addColorStop(1, "transparent");
    ctx.fillStyle = sideGrad;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(0, 0, 18, H);
    ctx.globalAlpha = 1;

    // Top + bottom bars
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 14);
    ctx.fillRect(0, H - 14, W, 14);

    // Hook text
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

    // Text shadow + text
    ctx.shadowColor = luminance(primaryColor) > 0.35 ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = textColor;
    lines.forEach((line, i) => ctx.fillText(line, W / 2, startY + i * lh));

    // Accent underline
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = accent;
    const underY = startY + (lines.length - 1) * lh + fontSize * 0.65;
    ctx.fillRect(W / 2 - 160, underY, 320, 10);

    const buffer = canvas.toBuffer("image/jpeg", 92);
    const objectName = `brand-covers/${videoId}-canvas-${randomUUID().slice(0, 8)}.jpg`;
    const url = await uploadJpegToGcs(buffer, objectName);
    logger.info({ videoId, objectName }, "[BrandCover] Canvas fallback cover uploaded");
    return url;
  } catch (err) {
    logger.error({ videoId, err }, "[BrandCover] Canvas cover failed");
    return null;
  }
}

// ── AI cover prompts ──────────────────────────────────────────────────────────

/** Prompt for images.edit — reference images present (avatar [+ logo]) */
function buildEditPrompt(
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
  hasLogo: boolean,
): string {
  const accent = accentColor ?? "#ffffff";
  const logoLine = hasLogo
    ? `\nBRAND LOGO: The last reference image is the brand logo — place it small in the bottom-left corner.`
    : "";
  return (
    `Create a professional Instagram Reel thumbnail cover (portrait 9:16, 1024×1536 px).\n\n` +
    `PRESENTER (reference image 1): Use the PERSON from this image as the on-screen avatar:\n` +
    `- Preserve their actual face, hair, skin tone, and clothing from the reference photo\n` +
    `- Position them on the RIGHT side of the frame, confident expression, well-lit\n` +
    `- Full portrait crop from roughly mid-torso upward\n\n` +
    `HOOK TEXT — render EXACTLY these words, ultra-bold condensed sans-serif, LEFT 55% of frame:\n` +
    `"${hookText}"\n\n` +
    `BRAND DESIGN:\n` +
    `- Background: dark cinematic gradient using ${primaryColor} as the dominant hue\n` +
    `- Accent ${accent}: glowing underline bar below the hook text + edge highlight stripe on the left\n` +
    `- Bokeh depth-of-field atmosphere, light particles in brand colors\n` +
    `- High contrast between text and background for mobile legibility\n` +
    `${logoLine}\n\n` +
    `HARD CONSTRAINTS:\n` +
    `- ONLY the hook text above — zero other words, no subtitles, no watermarks, no UI chrome\n` +
    `- Full bleed composition, no borders or padding\n` +
    `- Agency-quality Instagram/TikTok production value, photorealistic presenter`
  );
}

/** Prompt for images.generate — text-only, no reference images */
function buildGeneratePrompt(
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
): string {
  const accent = accentColor ?? "#ffffff";
  return (
    `Instagram Reel thumbnail cover, portrait 9:16, ultra-high quality.\n\n` +
    `HERO TEXT — render EXACTLY, ultra-bold condensed sans-serif, ~75% frame width:\n` +
    `"${hookText}"\n\n` +
    `Design:\n` +
    `- Background: deep cinematic gradient built around ${primaryColor}, dark and moody\n` +
    `- Accent ${accent}: neon underline bar beneath the text + left-edge glow stripe\n` +
    `- Add a confident human presenter/influencer silhouette on the RIGHT side\n` +
    `- Bokeh light particles, cinematic depth-of-field atmosphere\n` +
    `- NO watermarks, NO logos, NO extra text. Full bleed 9:16, no borders.\n` +
    `- Modern Instagram/TikTok agency-grade thumbnail, vibrant and professional`
  );
}

// ── AI cover (gpt-image-1) ────────────────────────────────────────────────────

async function generateAICover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
  avatarImageUrl: string | null,
  brandLogoUrl: string | null,
): Promise<string | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    logger.warn({ videoId }, "[BrandCover] OpenAI not configured — skipping AI cover");
    return null;
  }

  const tmpFiles: string[] = [];

  try {
    const client = new OpenAI({ apiKey, baseURL, timeout: 120_000 });

    // ── Try images.edit with reference photos ──────────────────────────────
    const refPaths: string[] = [];

    if (avatarImageUrl) {
      const p = await downloadAsPngTempFile(avatarImageUrl, "avatar");
      if (p) { refPaths.push(p); tmpFiles.push(p); }
    }
    if (brandLogoUrl) {
      const p = await downloadAsPngTempFile(brandLogoUrl, "logo");
      if (p) { refPaths.push(p); tmpFiles.push(p); }
    }

    if (refPaths.length > 0) {
      const hasLogo = refPaths.length > 1;
      const prompt = buildEditPrompt(hookText, primaryColor, accentColor, hasLogo);

      logger.info(
        { videoId, hookText, primaryColor, accentColor, refCount: refPaths.length },
        "[BrandCover] images.edit with reference images",
      );

      try {
        const imageFiles = await Promise.all(
          refPaths.map((p) =>
            toFile(fsSync.createReadStream(p), path.basename(p), { type: "image/png" })
          )
        );

        const editResponse = await (client.images as any).edit({
          model: "gpt-image-1",
          image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
          prompt,
          size: "1024x1536",
          n: 1,
        });

        const b64 = editResponse?.data?.[0]?.b64_json as string | undefined;
        if (b64) {
          const imgBuffer = Buffer.from(b64, "base64");
          const fmt = detectImageFormat(imgBuffer);
          if (fmt !== "unknown") {
            const jpegBuf = fmt === "jpeg" ? imgBuffer : await toJpeg(imgBuffer, 1024, 1536);
            const objectName = `brand-covers/${videoId}-edit-${randomUUID().slice(0, 8)}.jpg`;
            const url = await uploadJpegToGcs(jpegBuf, objectName);
            logger.info({ videoId, objectName }, "[BrandCover] images.edit cover uploaded ✓");
            return url;
          }
          logger.warn(
            { videoId, prefix: imgBuffer.slice(0, 200).toString("utf-8") },
            "[BrandCover] images.edit returned unrecognised format — trying generate",
          );
        } else {
          logger.warn({ videoId }, "[BrandCover] images.edit returned no b64_json — trying generate");
        }
      } catch (editErr: any) {
        logger.warn(
          { videoId, errMessage: editErr?.message, errStatus: editErr?.status },
          "[BrandCover] images.edit failed — trying generate",
        );
      }
    }

    // ── Fallback: images.generate (text-only) ─────────────────────────────
    const genPrompt = buildGeneratePrompt(hookText, primaryColor, accentColor);

    logger.info({ videoId, hookText }, "[BrandCover] images.generate (text-only)");

    const genResponse = await (client.images as any).generate({
      model: "gpt-image-1",
      prompt: genPrompt,
      size: "1024x1536",
      n: 1,
    });

    const genB64 = genResponse?.data?.[0]?.b64_json as string | undefined;
    if (!genB64) {
      logger.warn({ videoId }, "[BrandCover] images.generate returned no b64_json");
      return null;
    }

    const genBuffer = Buffer.from(genB64, "base64");
    const genFmt = detectImageFormat(genBuffer);
    if (genFmt === "unknown") {
      logger.warn(
        { videoId, prefix: genBuffer.slice(0, 200).toString("utf-8") },
        "[BrandCover] images.generate returned unrecognised format",
      );
      return null;
    }

    const genJpeg = genFmt === "jpeg" ? genBuffer : await toJpeg(genBuffer, 1024, 1536);
    const genObjectName = `brand-covers/${videoId}-gen-${randomUUID().slice(0, 8)}.jpg`;
    const genUrl = await uploadJpegToGcs(genJpeg, genObjectName);
    logger.info({ videoId, objectName: genObjectName }, "[BrandCover] images.generate cover uploaded ✓");
    return genUrl;

  } catch (err: any) {
    logger.warn(
      { videoId, errMessage: err?.message, errStatus: err?.status },
      "[BrandCover] AI cover generation failed — will fall back to canvas",
    );
    return null;
  } finally {
    // Always clean up temp files
    for (const p of tmpFiles) {
      fs.unlink(p).catch(() => {});
    }
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Generate a branded Reel cover and return its public HTTPS URL.
 *
 * @param avatarImageUrl - Clean portrait photo of the HeyGen avatar/look (used as
 *   visual reference for gpt-image-1 images.edit so the presenter appears in the cover).
 * @param brandLogoUrl   - Brand logo from settings (optional second reference image).
 *
 * Pipeline: images.edit (with references) → images.generate (text-only) → canvas fallback.
 */
export async function generateBrandCover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
  avatarImageUrl?: string | null,
  brandLogoUrl?: string | null,
): Promise<string | null> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!bucketId || !domain) {
    logger.warn({ videoId }, "[BrandCover] Object Storage or domain not configured — skipping");
    return null;
  }

  const aiUrl = await generateAICover(
    videoId, hookText, primaryColor, accentColor,
    avatarImageUrl ?? null,
    brandLogoUrl ?? null,
  );
  if (aiUrl) return aiUrl;

  return generateCanvasCover(videoId, hookText, primaryColor, accentColor);
}
