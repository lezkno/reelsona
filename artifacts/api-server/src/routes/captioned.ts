/**
 * Serve captioned videos — two routes, both auth-free (Instagram fetches these
 * without a session cookie when processing media containers):
 *
 * GET /api/captioned/:filename         — legacy /tmp-based files (FFmpeg ASS engine)
 * GET /api/captioned-objects/:objectName — GCS Object Storage files (browser engine)
 *
 * This router is mounted in app.ts BEFORE requireAuth / requireToolAccess so that
 * external services (Instagram, CDNs) can always reach the video files.
 */
import { Router } from "express";
import path from "path";
import fs from "fs";
import { CAPTION_DIR } from "../lib/caption-engine";
import { objectStorageClient } from "../lib/objectStorage";

const router = Router();

// ── GCS Object Storage (browser caption engine) ──────────────────────────────
// router.use strips the mount prefix, so req.path here is "/<objectName>"
router.use("/captioned-objects", async (req, res, next): Promise<void> => {
  if (req.method !== "GET") { next(); return; }
  // req.path = "/captioned-videos/file.mp4" → strip leading slash
  const objectName = req.path.replace(/^\//, "");

  // Security: only serve objects in explicitly allowed namespaces.
  // captioned-videos/ — browser caption engine output videos
  // brand-covers/     — branded Reel cover images (fetched by Instagram)
  const ALLOWED_NAMESPACES = ["captioned-videos/", "brand-covers/"];
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
    const file   = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", (metadata.contentType as string) || "video/mp4");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Accept-Ranges", "bytes");
    file.createReadStream().pipe(res);
  } catch {
    res.status(500).json({ error: "Failed to serve video" });
  }
});

// ── /tmp legacy files (ASS/FFmpeg caption engine) ────────────────────────────
router.get("/captioned/:filename", (req, res): void => {
  const filename = path.basename(req.params.filename); // prevent path traversal
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
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (rangeHeader) {
    // Partial content for Range requests (required for Instagram uploads)
    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader("Content-Length", chunkSize);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    res.setHeader("Content-Length", fileSize);
    fs.createReadStream(filePath).pipe(res);
  }
});

export default router;
