/**
 * Serve captioned videos produced by Caption Studio (FFmpeg).
 * Files are stored in CAPTION_DIR (/tmp/contentpilot-captioned/).
 *
 * GET /api/captioned/:filename → streams the MP4 file with Range support
 *   so Instagram and browsers can seek/stream it correctly.
 */
import { Router } from "express";
import path from "path";
import fs from "fs";
import { CAPTION_DIR } from "../lib/caption-engine";

const router = Router();

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
