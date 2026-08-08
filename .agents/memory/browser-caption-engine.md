---
name: Browser Caption Engine
description: Canvas-based caption renderer using @napi-rs/canvas. Key quirks, fixes, and architecture decisions.
---

## Architecture
- `@napi-rs/canvas` (Skia) renders transparent PNGs per caption cue
- PNGs composited onto video via FFmpeg **batch-segment approach** (15 overlays per batch, batches concatenated)
- Feature-flagged via `captionEngine: "browser_experimental"` in caption_config
- Falls back to ASS/FFmpeg on any failure
- Shared `CaptionTemplate` type drives both CaptionStudio WYSIWYG preview and server-side canvas renderer

## Word-wrap fix (Aug 2026)
**Problem:** `renderCueFrame` drew all words on a single horizontal line. The React preview uses CSS `flex-wrap: wrap` on a 250px container, causing 5 words to visually appear on 2 rows. The canvas rendered all 5 words in a single line — when long words exceeded available width (VIDEO_WIDTH − 2×marginX = 972px at 1080px wide), text overflowed the right margin.

**Fix:** Implemented greedy word-wrap in `renderCueFrame` (same algorithm as CSS `flex-wrap: wrap`):
- Words packed into lines until next word would exceed `availableW`
- Lines rendered bottom-up anchored at `baselineY` with `lineSpacing = fontSize × lineHeight` between them
- Each line centered independently within the safe area

**Why it matters:** Short words (≤972px combined) render as 1 line; longer words like "contenido puede transmitir mucha confianza" wrap to 2 lines. This matches what the user sees in the preview card thumbnail.

## FFmpeg batch compositing (Aug 2026)
**Problem:** Original code used up to 400 PNG files as simultaneous FFmpeg inputs with a single `filter_complex` chain. This approach failed silently (exit code 1) when cue count was large.

**Fix:** Batch-segment approach in `applyCaptionsBrowser`:
- Split cues into batches of `MAX_BATCH_OVERLAYS = 15`
- Each batch: `ffmpeg -ss batchStart -t batchDur -i video.mp4 [15 PNG inputs]` with relative timestamps + `setpts=PTS-STARTPTS`
- Each PNG scaled to source video dimensions (`scale=VW:VH`) before overlay
- All segments concatenated with `ffmpeg -f concat -c copy`

## loadCanvas() race condition fix
Promise singleton pattern replaces `_loadAttempted` boolean flag. Concurrent callers awaiting the same `import("@napi-rs/canvas")` previously saw `_loadAttempted=true` but `_canvasModule=null`, marking engine unavailable while the load was in flight.

## /api/captioned/:filename route
Moved to before `requireAuth` middleware in `app.ts` — serves from `/tmp/contentpilot-captioned/` without auth. Files are ephemeral (/tmp), so no auth needed. This route is used for both production captioned videos AND test videos.

## Diagnostic notes
- `GET /api/captions/browser/status` — returns `{ available: boolean }`, polled by CaptionStudio on mount
- `GET /api/captions/browser/preview-frame?templateId=clean_coach` — renders a single diagnostic PNG (no UI button yet)
- Pino's pretty-printer truncates error fields; embed error string in the log message body (not just as a field) for visibility
