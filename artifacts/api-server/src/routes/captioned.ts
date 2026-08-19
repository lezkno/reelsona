/**
 * Serve Reelsona media stored in Object Storage or the legacy /tmp caption dir.
 *
 * App-proxy URLs are available only to the authenticated owner of the video.
 * External services such as Instagram must receive a short-lived signed GCS URL
 * instead of calling this proxy directly.
 */
import { Router } from "express";
import path from "path";
import fs from "fs";
import { db, videosTable } from "@workspace/db";
import { and, eq, or, like } from "drizzle-orm";
import { CAPTION_DIR } from "../lib/caption-engine";
import { objectStorageClient } from "../lib/objectStorage";

const router = Router();

function sessionUserId(req: any): number | null {
  const userId = req.session?.authenticated ? req.session?.user?.userId : null;
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

async function ownsStoredMedia(userId: number, objectName: string): Promise<boolean> {
  // Fast path for provider assets whose canonical object name embeds the video id.
  const predictableMatch = objectName.match(/^(?:raw-videos|thumbnails|subtitles)\/(\d+)\.(?:mp4|jpg|srt)$/);
  if (predictableMatch) {
    const videoId = Number(predictableMatch[1]);
    const [owned] = await db
      .select({ id: videosTable.id })
      .from(videosTable)
      .where(and(eq(videosTable.id, videoId), eq(videosTable.userId, userId)))
      .limit(1);
    return Boolean(owned);
  }

  // Browser-caption outputs use a timestamp-based name. Resolve ownership from
  // the URLs persisted on the owner's video row instead of treating the path as
  // an authorization token.
  const suffix = `%/api/captioned-objects/${objectName}`;
  const [owned] = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(and(
      eq(videosTable.userId, userId),
      or(
        like(videosTable.captionedVideoUrl, suffix),
        like(videosTable.videoUrl, suffix),
        like(videosTable.thumbnailUrl, suffix),
        like(videosTable.heygenSubtitleUrl, suffix),
      ),
    ))
    .limit(1);
  return Boolean(owned);
}

async function ownsLegacyCaption(userId: number, filename: string): Promise<boolean> {
  const suffix = `%/api/captioned/${filename}`;
  const [owned] = await db
    .select({ id: videosTable.id })
    .from(videosTable)
    .where(and(
      eq(videosTable.userId, userId),
      like(videosTable.captionedVideoUrl, suffix),
    ))
    .limit(1);
  return Boolean(owned);
}

// ── GCS Object Storage ────────────────────────────────────────────────────────
router.use("/captioned-objects", async (req, res, next): Promise<void> => {
  if (req.method !== "GET") { next(); return; }

  const userId = sessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const objectName = req.path.replace(/^\//, "");
  const ALLOWED_NAMESPACES = ["captioned-videos/", "raw-videos/", "thumbnails/", "subtitles/"];
  if (
    !objectName ||
    objectName.includes("..") ||
    !ALLOWED_NAMESPACES.some((ns) => objectName.startsWith(ns)) ||
    objectName.split("/").some((part) => part === "")
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!(await ownsStoredMedia(userId, objectName))) {
    // Return 404 rather than 403 so object existence is not disclosed across tenants.
    res.status(404).json({ error: "Not found" });
    return;
  }

  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    res.status(500).json({ error: "Object storage not configured" });
    return;
  }

  try {
    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [metadata] = await file.getMetadata();
    const contentType = (metadata.contentType as string) || "video/mp4";
    const fileSize = Number(metadata.size) || 0;

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Accept-Ranges", "bytes");

    const rangeHeader = req.headers.range;
    if (rangeHeader && fileSize) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= fileSize) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
        res.end();
        return;
      }
      const chunk = end - start + 1;
      res.status(206);
      res.setHeader("Content-Length", chunk);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      file.createReadStream({ start, end }).pipe(res);
    } else {
      if (fileSize) res.setHeader("Content-Length", String(fileSize));
      file.createReadStream().pipe(res);
    }
  } catch {
    res.status(500).json({ error: "Failed to serve video" });
  }
});

// ── Legacy /tmp files ─────────────────────────────────────────────────────────
router.get("/captioned/:filename", async (req, res): Promise<void> => {
  const userId = sessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const filename = path.basename(req.params.filename);
  if (!filename.endsWith(".mp4")) {
    res.status(400).json({ error: "Invalid file" });
    return;
  }

  if (!(await ownsLegacyCaption(userId, filename))) {
    res.status(404).json({ error: "Captioned video not found" });
    return;
  }

  const filePath = path.join(CAPTION_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Captioned video not found" });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= fileSize) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
      res.end();
      return;
    }
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader("Content-Length", chunkSize);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", fileSize);
    fs.createReadStream(filePath).pipe(res);
  }
});

export default router;
