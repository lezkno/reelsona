---
name: Browser Caption Engine — resolution matching
description: PNGs composited onto video must be rendered at the actual video resolution, not a hardcoded default.
---

## Rule
Before rendering any caption PNGs, probe the source video with `ffprobe` and use the returned dimensions for both the canvas size and the FFmpeg scale filter. The fallback constants (`VIDEO_WIDTH_DEFAULT=1080`, `VIDEO_HEIGHT_DEFAULT=1920`) exist only for the probe-failure case.

**Why:**
When a 1080×1920 PNG is overlaid with `overlay=0:0` on a 720×1280 video, FFmpeg clips the overlay at the video frame boundaries. Text at y=83% of 1920=1593px falls entirely outside the 1280px frame — invisible. The symptom is captions completely absent OR tiny orange box fragments visible only at the left/bottom frame edge.

HeyGen's portrait videos are 720×1280, not 1080×1920. The test video used during development happened to be 720×1280 — rendering at 1080×1920 would always have produced broken production output.

**How to apply:**
- `probeVideoDimensions(videoPath)` in `browser-caption-engine.ts` wraps the ffprobe call and returns `{width, height}` (falls back to defaults on error).
- `renderCueFrame(canvas, template, cue, videoW, videoH)` — `videoW/videoH` replace all `VIDEO_WIDTH`/`VIDEO_HEIGHT` usages inside the function (canvas size, `scaleToHeight` calls, `getBaselineY`, `getSafeMarginX`, line centering).
- In `applyCaptionsBrowser`, probe BEFORE the PNG render loop (so dimensions are available when calling `renderCueFrame`), and use them in the FFmpeg `scale=${dims.width}:${dims.height}` filter too.
- `test-template.mjs` follows the same pattern: probe BEFORE rendering, pass `VW/VH` to `renderCueFrame`.
- `renderDiagnosticFrame` uses the default dimensions (fine — it's a UI preview, not composited onto a real video).
