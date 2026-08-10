/**
 * brand-cover.ts — generate a simple branded PNG cover for Instagram Reels.
 *
 * Uses @napi-rs/canvas to draw a 1080×1920 frame with the user's brand primary
 * color as the background, an accent bar, and the hook text centred over it.
 * The result is uploaded to Object Storage and the public HTTPS URL is returned
 * so it can be passed as cover_url when creating the Reel container.
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { objectStorageClient } from "./objectStorage";
import { logger as rootLogger } from "./logger";

const logger = rootLogger.child({ module: "brand-cover" });

/** Parse a hex color and return relative luminance (0–1). Used for text color choice. */
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const toLinear = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Wrap text into lines that fit within maxWidth (canvas ctx required for measureText). */
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

/**
 * Generate a branded 1080×1920 cover PNG with the given hook text and brand
 * colors, upload to Object Storage, and return the public HTTPS URL.
 *
 * Falls back gracefully: if canvas rendering or upload fails, returns null so
 * the Reel is published without a custom cover (rather than failing entirely).
 */
export async function generateBrandCover(
  videoId: number,
  hookText: string,
  primaryColor: string,
  accentColor: string | null
): Promise<string | null> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const domain   = process.env.REPLIT_DEV_DOMAIN;
  if (!bucketId || !domain) {
    logger.warn({ videoId }, "[BrandCover] Object Storage or domain not configured — skipping cover");
    return null;
  }

  try {
    const W = 1080, H = 1920;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // ── Background ────────────────────────────────────────────────────────────
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, primaryColor);
    // Darken slightly toward the bottom for depth
    grad.addColorStop(1, primaryColor + "cc");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ── Accent bar ────────────────────────────────────────────────────────────
    const accent = accentColor ?? "#ffffff";
    ctx.fillStyle = accent;
    ctx.fillRect(0, H - 16, W, 16);          // bottom bar
    ctx.fillRect(0, 0, W, 8);                // top bar

    // ── Hook text ────────────────────────────────────────────────────────────
    const textColor = luminance(primaryColor) > 0.35 ? "#111111" : "#ffffff";
    const fontSize  = hookText.length > 80 ? 62 : hookText.length > 50 ? 74 : 88;
    ctx.fillStyle   = textColor;
    ctx.font        = `bold ${fontSize}px sans-serif`;
    ctx.textAlign   = "center";
    ctx.textBaseline = "middle";

    const maxW  = W - 120;           // 60 px margin each side
    const lines = wrapText(ctx, hookText, maxW);
    const lh    = fontSize * 1.25;
    const totalH = lines.length * lh;
    const startY = H / 2 - totalH / 2 + lh / 2;

    // Subtle text shadow for legibility
    ctx.shadowColor   = luminance(primaryColor) > 0.35 ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.35)";
    ctx.shadowBlur    = 8;
    ctx.shadowOffsetY = 4;

    lines.forEach((line, i) => {
      ctx.fillText(line, W / 2, startY + i * lh);
    });

    // ── Upload ────────────────────────────────────────────────────────────────
    // Instagram cover_url requires JPEG; PNG is rejected by the Graph API.
    const buffer        = canvas.toBuffer("image/jpeg");
    const gcsObjectName = `brand-covers/${videoId}-${randomUUID().slice(0, 8)}.jpg`;
    const bucket        = objectStorageClient.bucket(bucketId);
    const gcsFile       = bucket.file(gcsObjectName);
    await gcsFile.save(buffer, { contentType: "image/jpeg" });

    const publicUrl = `https://${domain}/api/captioned-objects/${gcsObjectName}`;
    logger.info({ videoId, gcsObjectName, publicUrl: publicUrl.slice(0, 80) }, "[BrandCover] Cover uploaded");
    return publicUrl;

  } catch (err) {
    logger.error({ videoId, err }, "[BrandCover] Failed to generate brand cover — publishing without custom cover");
    return null;
  }
}
