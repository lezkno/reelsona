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

## Per-template override persistence
Caption Studio stores advanced style changes as a JSON map keyed by template ID, rather than one global override object. The scheduler must resolve the map entry for the template selected for the current render (including rotation) before passing it to the browser renderer; if that entry is absent, use the template default. Continue accepting the former flat override shape for existing users.

**Why:** Passing the entire map into a template spread silently ignores the intended `fontSize`, `wordsPerLine`, and style fields, and can apply another template's data in edge cases.

**How to apply:** Any new render path that calls the browser caption engine must resolve `templateOverrides[effectiveTemplateId]` first. UI saves must retain the complete map so switching templates never discards another template's settings.

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

## CSS preview vs canvas pixel calibration (Aug 2026)
**Problem:** `TemplateCaptionPreview` used CSS `flex items-end` with container height = `baselineY`. The CSS LINE BOX bottom sat at `baselineY`, but the canvas draws text with `textBaseline="alphabetic"` at `baselineY` — the alphabetic baseline is inside the line box, so CSS text appeared ~15px HIGHER than in the real video.

**Measurement (authority_bold, 1920px canvas):**
- ImageMagick trim on cue PNG → text bbox top=1486, bottom=1615
- Canvas baseline at yPercent=82 → `1574px`
- Visual text bottom (including descender + outline + shadow) → `1615px = 84.1%` (not 82%)
- 41px gap at 1920 scale = `41 × (444/1920) ≈ 10px` at preview scale

**Fix:** `extraBelowBaseline = ceil(scaledFS × 0.25 + scaledOW × 1.2 + scaledSY + scaledBlur × 0.4)`. Container height = `baselineY + extraBelowBaseline`. Guide line stays at `baselineY` (canvas baseline reference). Verified: 84.1% matches for all three templates.

**Why:** Font descender metric (~25% of em) + outline below baseline + shadow downward extent all contribute below the alphabetic baseline. CSS previews this space differently than `@napi-rs/canvas`.

## active_word backgroundMode (Dimigium template)
Added `"active_word"` to `BackgroundMode` union in `types.ts`. Canvas renderer (`browser-caption-engine.ts`) and CSS renderer (`renderer.ts → buildWordStyle`) both check `backgroundMode === "active_word" && isActive` to draw the pill only on the highlighted word. The test script (`test-template.mjs`) has its own inline `renderCueFrame` — must keep it in sync with the engine. `buildWordStyle` now accepts an optional `renderH = 444` param for scaling padding/radius to preview pixels.

## Diagnostic notes
- `GET /api/captions/browser/status` — returns `{ available: boolean }`, polled by CaptionStudio on mount
- `GET /api/captions/browser/preview-frame?templateId=clean_coach` — renders a single diagnostic PNG (no UI button yet)
- Pino's pretty-printer truncates error fields; embed error string in the log message body (not just as a field) for visibility
