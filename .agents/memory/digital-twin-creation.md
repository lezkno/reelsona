---
name: Digital Twin creation pipeline
description: How the Digital Twin avatar creation flow works end-to-end, including known API quirks and browser recording issues.
---

# Digital Twin creation pipeline

## Browser recording quirks
- `MediaRecorder.mimeType` returns `"text/plain"` in Replit's embedded Chromium — this is a falsy-looking truthy value, so `|| "video/webm"` fallback never fires.
- **Fix:** always validate `rawMime.startsWith("video/")` before using it; otherwise force `"video/webm"`.
- Limit future recordings with `{ videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 96_000 }` to keep files ≤ 20 MB for a 2.5-min clip.
- The `File` object must carry a valid `video/*` MIME type; the server accepts any MIME type and normalises it.

## HeyGen /v3/assets file size limit
- HeyGen rejects uploads over ~20 MB on `/v3/assets` with `{"code":"invalid_parameter","message":"File is too large... MB."}`.
- **Fix:** server-side FFmpeg compression before `uploadAsset()`: scale to 720p, 800 kbps H.264 + 96 kbps AAC → MP4. A 2.5-min clip goes from ~47 MB to ~16 MB.
- Compression is in `POST /heygen/avatars/create-digital-twin` in `routes/heygen.ts`; threshold is 20 MB.

## HeyGen POST /v3/avatars payload for Digital Twin
- `type` must be `"digital_twin"` — NOT `"video"` (rejected with invalid_parameter listing valid types: prompt, digital_twin, photo).
- `file` field: `{ type: "asset_id", asset_id: <id from /v3/assets> }` — this structure is correct.
- Full payload: `{ type: "digital_twin", name, file: { type: "asset_id", asset_id } }`.

**Why:** HeyGen v3 uses a discriminated union type for avatar creation; the type tag must exactly match one of the enum values.

## HeyGen video generation payload (v3)
- Remove `width` and `height` — v3 only accepts `aspect_ratio` (e.g. `"9:16"`).
- `motion_prompt` is only accepted when `reference_look_id` is present in the engine payload; omit it for photo avatars without a digital twin reference.
- Engine payload for Avatar V: `{ type: "avatar_v" }` (optionally `{ type: "avatar_v", reference_look_id: <id> }`).

## Scheduler credit and rate-limit fixes
- `reserveCredits` failure now rethrows so the outer catch block aborts generation (no HeyGen call without a reservation).
- HeyGen 429 → content item reset to `"scripted"` (retryable next cycle); video row stays `"failed"` as a record.
- Detection string: `error.includes("generation deferred to next cycle") || error.includes("rate limit")`.
