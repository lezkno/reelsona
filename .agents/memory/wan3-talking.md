---
name: WAN 3.0 talking-head
description: WaveSpeed avatar video step now uses alibaba/wan-3.0/reference-to-video (segmented ≤36 words, joined with FFmpeg); InfiniteTalk is the automatic fallback.
---

## Rule
The WaveSpeed pipeline is still script → MiniMax TTS → avatar video → Whisper SRT → captions → publish.
Only the avatar video step changed (`artifacts/api-server/src/lib/wan3-talking.ts` + `scheduler.ts`: `submitWan3Handoff`, `advanceWan3Segments`, `finalizeWavespeedTalkingHead(..., { clipUrls })`):

- Look image → `reference_images[0]` (start frame + identity). The endpoint silently DROPS an `image` field.
- First 10 s of the TTS audio → `reference_audios` (voice identity). Stored as `voice-references/wan3-{videoId}.mp3` + signed URL; falls back to the full TTS URL.
- WAN generates the speech itself from the `EXACT DIALOGUE … spoken once` block (without it WAN repeats phrases). Captions still work because they are transcribed from the final MP4.
- WAN caps at 30 s and repeats phrases on long dialogues → script split into ≤36-word segments (sentence boundaries), one job each, `duration = ceil(words/2.2 + 1.5)`. Sentinel `wavespeed-wan:{id1},{id2},…` → lease `wavespeed-wan-finalizing:` (stages in `wavespeed-video-pipeline-policy.ts`). When all complete: FFmpeg concat at 720×1280/30 fps → `raw-videos/{id}.mp4`.
- Language comes from `settings.language` (never hard-coded).
- Owner wants DYNAMIC reels, not a static presenter: ACTIVE PERFORMANCE block (gestures, leaning, walking; hands never cover the mouth) and a different shot per segment in the SAME location (`wan3ShotFor`: opening handheld medium → close-up / three-quarter arc / walk-and-talk → closing pull-back). A single-segment reel does three shot sizes in one take. Chosen over per-segment Seedream scenes (extra cost) and rotating looks (outfit changes).
- Trailing silence (~1.5 s headroom per segment) is trimmed with FFmpeg silencedetect before concat so shots cut on the beat.

## Safety
- Every accepted WAN job is inserted in `wavespeed_jobs` right after submission; a retry reuses them and NEVER resubmits.
- WAN is submitted inside the `tts-handoff` lease (crash there → fail safely, like InfiniteTalk). WaveSpeed rejected the FIRST request (4xx, nothing billed) → InfiniteTalk. Partial/ambiguous submission or a failed segment → terminal failure + credit release (never resubmitted).
- `WAVESPEED_TALKING_MODEL=infinitetalk` → old behaviour. `WAN3_RESOLUTION` = 480p | 720p (default) | 1080p.
- Voice Director preview (`wavespeed-voice-director-video.ts`) also uses WAN 3.0; multi-segment ids are comma-separated in `videoRequestId` and GET /wavespeed/voice-director/job/:ids joins them (cached in `vd-video-previews/`).
- First segment rejected (HTTP/API 4xx ≠ 429) at 720p/1080p → retried once at 480p (rejections are not billed). Timeouts/5xx are never retried.
- On startup (index.ts) the log line `[WaveSpeed] Modelo de video de avatar activo` shows the active model.
- Replit works on branch `stabilization-current-workspace` (remote `gitsafe-backup`), NOT `main`. Always base changes on origin/stabilization-current-workspace; a change on `main` never reaches the running app.
- Credits estimate is unchanged (same as InfiniteTalk); WAN cost per second is higher on WaveSpeed.
