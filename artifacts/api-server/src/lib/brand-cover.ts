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
import { toFile } from "openai";
import { makeOpenAIClient } from "./openai-client";
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

async function uploadImageToGcs(
  buffer: Buffer,
  objectName: string,
  contentType: "image/jpeg" | "image/png" = "image/jpeg",
): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!bucketId || !domain) throw new Error("Object Storage not configured");
  const bucket = objectStorageClient.bucket(bucketId);
  await bucket.file(objectName).save(buffer, { contentType });
  return `https://${domain}/api/captioned-objects/${objectName}`;
}

/**
 * Download/read an image and re-encode it as a PNG temp file.
 * Accepts:
 *   - Absolute HTTPS URLs (fetched via axios)
 *   - Object Storage paths starting with "/objects/" or "objects/"
 *     (read directly from the bucket — no HTTP roundtrip needed)
 * gpt-image-1 images.edit is most reliable when given PNG (not JPEG).
 * Returns the tmp file path, or null if download/decode fails.
 */
async function downloadAsPngTempFile(urlOrPath: string, label: string): Promise<string | null> {
  try {
    let srcBuffer: Buffer;

    if (urlOrPath.startsWith("/objects/") || urlOrPath.startsWith("objects/")) {
      // Object Storage path — read directly from the bucket, no HTTP needed
      const objectKey = urlOrPath.replace(/^\/?objects\//, "");
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
      if (!bucketId) {
        logger.warn({ label }, "[BrandCover] DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — skipping reference");
        return null;
      }
      const bucket = objectStorageClient.bucket(bucketId);
      const [data] = await bucket.file(objectKey).download();
      srcBuffer = Buffer.from(data);
    } else if (urlOrPath.startsWith("http")) {
      // Absolute URL — fetch via axios
      const resp = await axios.get<ArrayBuffer>(urlOrPath, {
        responseType: "arraybuffer",
        timeout: 20_000,
      });
      srcBuffer = Buffer.from(resp.data);
    } else {
      // Relative path — convert to absolute using REPLIT_DEV_DOMAIN
      const domain = process.env.REPLIT_DEV_DOMAIN;
      if (!domain) {
        logger.warn({ label, urlOrPath }, "[BrandCover] No domain for relative URL — skipping reference");
        return null;
      }
      const fullUrl = `https://${domain}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
      const resp = await axios.get<ArrayBuffer>(fullUrl, {
        responseType: "arraybuffer",
        timeout: 20_000,
      });
      srcBuffer = Buffer.from(resp.data);
    }

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
    logger.warn({ urlOrPath, label, err }, "[BrandCover] Failed to download/decode reference image — skipping");
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
  try {
    const img = await loadImage(imgBuffer);
    ctx.drawImage(img, 0, 0, W, H);
  } catch (loadErr: any) {
    // Log the actual buffer prefix to diagnose what the proxy returned
    const prefix = imgBuffer.slice(0, 64).toString("hex");
    const text = imgBuffer.slice(0, 120).toString("utf-8").replace(/[^\x20-\x7E]/g, ".");
    throw new Error(`loadImage failed (${loadErr?.message}). Buffer[0..63]=${prefix} text="${text}"`);
  }
  return cvs.toBuffer("image/jpeg", 92);
}

// ── Canvas composite with real avatar photo (PRIMARY path) ───────────────────
/**
 * Compose a Reels cover at 1080×1920 by placing the actual avatar photo as a
 * full-bleed background, then layering a brand-colored gradient on the left so
 * the hook text is always readable.  100% deterministic — uses the real face/look.
 */
async function generateCanvasCompositeCover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
  avatarImageUrl: string,
): Promise<string | null> {
  try {
    const W = 1080, H = 1920;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    const accent = accentColor ?? "#ffffff";
    const { r: pr, g: pg, b: pb } = hexToRgb(primaryColor);

    // 1. Solid brand-color base (shown if avatar load fails)
    ctx.fillStyle = primaryColor;
    ctx.fillRect(0, 0, W, H);

    // 2. Avatar photo — scale to cover the full 1080×1920 canvas (like bg-cover)
    let avatarLoaded = false;
    let tmpPath: string | null = null;
    try {
      tmpPath = await downloadAsPngTempFile(avatarImageUrl, "composite-avatar");
      if (tmpPath) {
        const img = await loadImage(tmpPath);
        const scale = Math.max(W / img.width, H / img.height);
        const sw = img.width * scale;
        const sh = img.height * scale;
        const ox = (W - sw) / 2;
        const oy = (H - sh) / 2;
        ctx.drawImage(img, ox, oy, sw, sh);
        avatarLoaded = true;
      }
    } catch (e) {
      logger.warn({ videoId, e }, "[BrandCover] Composite: avatar draw failed — using solid bg");
    } finally {
      if (tmpPath) fs.unlink(tmpPath).catch(() => {});
    }

    // 3. Left gradient overlay — brand color, fully opaque left → transparent right
    //    This gives the text area a solid readable background while revealing the
    //    avatar photo on the right side.
    const gradX = avatarLoaded ? W * 0.72 : W;
    const leftGrad = ctx.createLinearGradient(0, 0, gradX, 0);
    leftGrad.addColorStop(0,    `rgba(${pr},${pg},${pb},1)`);
    leftGrad.addColorStop(0.55, `rgba(${pr},${pg},${pb},0.96)`);
    leftGrad.addColorStop(0.80, `rgba(${pr},${pg},${pb},0.55)`);
    leftGrad.addColorStop(1,    `rgba(${pr},${pg},${pb},0)`);
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, 0, gradX, H);

    // Bottom gradient for depth
    const btmGrad = ctx.createLinearGradient(0, H * 0.75, 0, H);
    btmGrad.addColorStop(0, "rgba(0,0,0,0)");
    btmGrad.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = btmGrad;
    ctx.fillRect(0, H * 0.75, W, H * 0.25);

    // 4. Left accent stripe
    const stripeGrad = ctx.createLinearGradient(0, 0, 0, H);
    stripeGrad.addColorStop(0,   "rgba(255,255,255,0)");
    stripeGrad.addColorStop(0.3, accent);
    stripeGrad.addColorStop(0.7, accent);
    stripeGrad.addColorStop(1,   "rgba(255,255,255,0)");
    ctx.fillStyle = stripeGrad;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, 10, H);
    ctx.globalAlpha = 1;

    // 5. Top + bottom accent bars
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 10);
    ctx.fillRect(0, H - 10, W, 10);

    // 6. Hook text — left-aligned, left 65% of canvas
    const textMaxW = W * 0.60;
    const marginL = 68;
    const fontSize = hookText.length > 90 ? 68 : hookText.length > 65 ? 80 : hookText.length > 40 ? 92 : 108;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    const words = hookText.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > textMaxW && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);

    const lh = fontSize * 1.18;
    const totalTextH = lines.length * lh;
    // Place text in the upper-middle third
    const textStartY = H * 0.38 - totalTextH / 2;

    // Shadow for depth
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#ffffff";
    lines.forEach((line, i) => ctx.fillText(line, marginL, textStartY + i * lh));

    // 7. Accent underline below text
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = accent;
    const underlineY = textStartY + totalTextH + 18;
    ctx.fillRect(marginL, underlineY, Math.min(textMaxW * 0.55, 360), 8);

    const buffer = canvas.toBuffer("image/jpeg", 92);
    const objectName = `brand-covers/${videoId}-composite-${randomUUID().slice(0, 8)}.jpg`;
    const url = await uploadImageToGcs(buffer, objectName, "image/jpeg");
    logger.info({ videoId, objectName, avatarLoaded }, "[BrandCover] Composite cover uploaded ✓");
    return url;
  } catch (err) {
    logger.error({ videoId, err }, "[BrandCover] Composite cover failed");
    return null;
  }
}

// ── Canvas fallback (no avatar photo) ────────────────────────────────────────

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
    const url = await uploadImageToGcs(buffer, objectName, "image/jpeg");
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
  openaiApiKey?: string | null,
): Promise<string | null> {
  const platformKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const platformBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!openaiApiKey && (!platformKey || !platformBase)) {
    logger.warn({ videoId }, "[BrandCover] OpenAI not configured — skipping AI cover");
    return null;
  }

  const tmpFiles: string[] = [];

  try {
    const client = makeOpenAIClient(openaiApiKey, { timeout: 120_000 });

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
        });

        const b64 = editResponse?.data?.[0]?.b64_json as string | undefined;
        if (b64) {
          const imgBuffer = Buffer.from(b64, "base64");
          const fmt = detectImageFormat(imgBuffer);
          if (fmt !== "unknown") {
            // gpt-image-1 returns C2PA-signed PNGs. @napi-rs/canvas cannot load them
            // (loadImage throws "Invalid SVG image"). Upload the raw buffer directly.
            const ext = fmt === "jpeg" ? "jpg" : "png";
            const ct: "image/jpeg" | "image/png" = fmt === "jpeg" ? "image/jpeg" : "image/png";
            const objectName = `brand-covers/${videoId}-edit-${randomUUID().slice(0, 8)}.${ext}`;
            const url = await uploadImageToGcs(imgBuffer, objectName, ct);
            logger.info({ videoId, objectName, fmt }, "[BrandCover] images.edit cover uploaded ✓");
            return url;
          }
          logger.warn(
            { videoId, prefix: imgBuffer.slice(0, 64).toString("hex") },
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
        { videoId, prefix: genBuffer.slice(0, 64).toString("hex") },
        "[BrandCover] images.generate returned unrecognised format",
      );
      return null;
    }

    // gpt-image-1 returns C2PA-signed PNGs. Upload raw buffer — do NOT transcode
    // through @napi-rs/canvas which cannot handle the C2PA provenance metadata.
    const genExt = genFmt === "jpeg" ? "jpg" : "png";
    const genCt: "image/jpeg" | "image/png" = genFmt === "jpeg" ? "image/jpeg" : "image/png";
    const genObjectName = `brand-covers/${videoId}-gen-${randomUUID().slice(0, 8)}.${genExt}`;
    const genUrl = await uploadImageToGcs(genBuffer, genObjectName, genCt);
    logger.info({ videoId, objectName: genObjectName, fmt: genFmt }, "[BrandCover] images.generate cover uploaded ✓");
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
 * Pipeline (stops at first success):
 *   1. Canvas composite  — real avatar photo + brand colors on canvas (1080×1920).
 *      Fast, deterministic, 100% consistent avatar appearance. PRIMARY path.
 *   2. gpt-image-1 generate — AI-only when no avatar photo is available.
 *   3. Canvas fallback   — brand-colored gradient, no photo needed.
 */
export async function generateBrandCover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null,
  avatarImageUrl?: string | null,
  brandLogoUrl?: string | null,
  openaiApiKey?: string | null,
): Promise<string | null> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!bucketId || !domain) {
    logger.warn({ videoId }, "[BrandCover] Object Storage or domain not configured — skipping");
    return null;
  }

  // 1. Canvas composite with real avatar photo (fast + consistent)
  if (avatarImageUrl) {
    const compositeUrl = await generateCanvasCompositeCover(
      videoId, hookText, primaryColor, accentColor, avatarImageUrl,
    );
    if (compositeUrl) return compositeUrl;
  }

  // 2. AI generation (no avatar available)
  const aiUrl = await generateAICover(
    videoId, hookText, primaryColor, accentColor,
    null, // avatar already handled above
    brandLogoUrl ?? null,
    openaiApiKey,
  );
  if (aiUrl) return aiUrl;

  // 3. Canvas fallback (no photo, no AI)
  return generateCanvasCover(videoId, hookText, primaryColor, accentColor);
}
