---
name: Browser Caption Engine
description: Canvas-based caption renderer using @napi-rs/canvas; feature-flagged on caption_config; falls back to ASS/FFmpeg on failure.
---

## Architecture
- **Shared contract:** `lib/caption-templates` (source-only package, no compile step) exports `CaptionTemplate`, `BROWSER_CAPTION_TEMPLATES`, `buildWordStyle`, `scaleToHeight`, `getBaselineY`, `getSafeMarginX`.
- **Three templates:** `authority_bold`, `viral_stack`, `clean_coach` — each defines fontSize, fontFamily, colors, outline, shadow, yPercent, wordsPerLine, uppercase, highlightColor.
- **Server renderer:** `artifacts/api-server/src/lib/browser-caption-engine.ts` — lazy loads `@napi-rs/canvas` (Skia, pre-built linux-x64 binaries), renders one PNG per caption cue, FFmpeg overlays them via `filter_complex` chain.
- **Fallback:** If canvas load fails or render errors, returns `{ url: null, error }`. Scheduler catches this and falls through to standard ASS/FFmpeg engine.
- **Feature flag:** `captionEngine` column on `caption_config` table (`"standard"` | `"browser_experimental"`), paired with `templateId` (nullable text).
- **Frontend:** `TemplateCaptionPreview` in CaptionStudio uses `buildWordStyle` + scaled values to render the same visual in CSS — true WYSIWYG. Selecting a standard preset resets `captionEngine` to `"standard"` and `templateId` to `null`.

## Scale formula
All template values are defined at 1920px reference height. Use `scaleToHeight(value, targetPx)` = `value * (targetPx / 1920)`. Frontend uses `PHONE_SCREEN_H = 444` as target; backend canvas uses `1080` (horizontal video) or a configurable height.

## Object Storage (server)
Upload uses the same GCS pattern as `caption-engine.ts`:
```typescript
const bucket  = objectStorageClient.bucket(bucketId);
const gcsFile = bucket.file(`captioned-videos/browser_${runId}.mp4`);
await gcsFile.save(fileBuffer, { contentType: "video/mp4" });
const url = `https://${domain}/api/captioned-objects/captioned-videos/browser_${runId}.mp4`;
```

## Scheduler integration (scheduler.ts)
Browser engine branch runs **before** the `const style: CaptionStyle = {` block. On success, writes to DB and returns early. On failure (url is null), logs a warning and falls through to the existing ASS engine code — no extra try/catch needed in the scheduler.

## Diagnostic endpoint
`GET /api/captions/browser/preview-frame?templateId=authority_bold` returns a raw 1080×1920 PNG. Use to verify canvas works in the deployed environment before enabling for users.
`GET /api/captions/browser/status` returns `{ available: boolean, error? }`.

## Known bug: loadCanvas() race condition (fixed)
The original `loadCanvas()` used a boolean flag `_loadAttempted`. If two callers raced (e.g. status endpoint + scheduler), the second caller saw `_loadAttempted=true` but `_canvasModule=null` and returned null — false negative. **Fix:** replaced with a Promise singleton `_loadPromise` so all concurrent callers await the same underlying import.

## ASS fallback colors (fixed)
When the browser engine fails, the ASS fallback uses `captionCfg.primaryColor` / `activeWordColor` from the DB. If the previous preset had both colors as `#FFFFFF`, the fallback output is all-white text. **Fix:** `applyBrowserTemplate()` in CaptionStudio now also saves the template's `primaryColor`, `activeWordColor`, and `outlineColor` to the DB alongside `caption_engine` + `template_id`.

## Error visibility (improved)
Pino's pretty-printer truncates JSON fields for long strings; the `error` field in the scheduler WARN was invisible. **Fix:** error string is now embedded in the WARN message body itself: `[BrowserEngine] Failed (${error}) — falling back...`. Also added `logger.info` checkpoints inside `applyCaptionsBrowser` before every early-exit path to make future tracing easier.
