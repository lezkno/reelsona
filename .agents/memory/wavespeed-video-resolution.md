---
name: WaveSpeed video resolution quirks
description: infinitetalk-fast outputs at 352×640 (11:20, not 9:16) — significantly lower res than HeyGen's 720×1280, causing thinner captions.
---

## Rule
WaveSpeed `infinitetalk-fast` outputs video at the input image's native resolution. With the portrait avatar photos used in this project, output is **352×640** (11:20 aspect ratio, NOT the 9:16 of HeyGen's 720×1280).

**Why this matters:**
- Captions burned in at 352×640 look visibly thinner/smaller than at 720×1280 when both play at full-screen, because absolute font pixel size at 640px height is half that at 1280px height (even with proportional `scaleToHeight`).
- WaveSpeed videos have no `subtitleUrl` and no explicit `videoDurationSeconds` in the caption call — both must come from `ffprobe` or the pipeline fails.

## How to apply
Both fixes are in `artifacts/api-server/src/lib/browser-caption-engine.ts`:

1. **Resolution normalisation** (step 3c in `applyCaptionsBrowser`): if `videoInfo.height < 720`, upscale with FFmpeg `scale=${normW}:${normH}:flags=lanczos` before any effects. The normalized path becomes `captionSourcePath` and `videoInfo` is updated in-place.

2. **Probed duration fallback for timings**: use `opts?.videoDurationSeconds ?? videoInfo.duration` so WaveSpeed videos build proportional fallback timings from the probed duration instead of failing with "No word timings available".

3. **Zoom step reads from `captionSourcePath`** (not raw `videoPath`) so zoom operates on the already-normalised file.

## WaveSpeed pipeline notes
- No `subtitleUrl` in the `runCaptionProcessing` call (WaveSpeed has no SRT).
- No `durationSeconds` stored in `videos` table after talking-head completes (fix: use `videoInfo.duration` from probe as the fallback).
- infinitetalk-fast input field names: `image` and `audio` (NOT `image_url` / `audio_url`).
- TTS outputs: `string[]` (CloudFront URLs), not a keyed object — must `Array.isArray(outputs)` check before indexing.
