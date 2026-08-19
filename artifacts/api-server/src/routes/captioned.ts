/**
 * Serve Reelsona media stored in Object Storage or the legacy /tmp caption dir.
 *
 * These app-proxy URLs are for authenticated Reelsona users only. External
 * services such as Instagram must receive short-lived signed GCS URLs instead
 * of using this proxy. Session middleware is mounted before this router in
 * app.ts, even though requireAuth itself is mounted later.
 */
import { Router } from "express";
import path from "path";
import fs from "fs";
import { CAPTION_DIR } from "../lib/caption-engine";
import { objectStorageClient } from "../lib/objectStorage";

const router = Router();

function hasAuthenticatedSession(req: any): boolean {
  return Boolean(req.session?.authenticated && req.session?.user?.userId);
}

// ── GCS Object Storage (browser caption engine / persisted provider assets) ──
router.use("/captioned-objects", async (req, res, next): Promise<void> => {
  if (req.method !== "GET") { next(); return; }
  if (!hasAuthenticatedSession(req)) {
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

// ── /tmp legacy files (ASS/FFmpeg caption engine) ────────────────────────────
router.get("/captioned/:filename", (req, res): void => {
  if (!hasAuthenticatedSession(req)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const filename = path.basename(req.params.filename);
  if (!filename.endsWith(".mp4")) {
    res.status(400).json({ error: "Invalid file" });
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
