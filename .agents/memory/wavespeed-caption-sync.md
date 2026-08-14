---
name: WaveSpeed caption sync via Whisper
description: WaveSpeed has no HeyGen SRT — Whisper transcribes TTS audio for accurate word-level caption timing.
---

## Rule
WaveSpeed videos have no `subtitle_url` from the API (unlike HeyGen). The browser caption engine uses `heygenSubtitleUrl` as `subtitleUrl`. For WaveSpeed, this must be generated via Whisper transcription of the TTS audio.

## How to apply
After TTS completes in the WaveSpeed polling loop (`scheduler.ts` — stage `"tts"`), the pipeline:

1. Extracts `audioUrl` from TTS outputs
2. Calls `transcribeAudioToSrt(audioUrl, videoId)` — downloads audio, calls `openai.audio.transcriptions.create({ model: "whisper-1", language: "es", response_format: "verbose_json", timestamp_granularities: ["word"] })`, converts word-level timings to SRT, uploads to `subtitles/{videoId}.srt` in Object Storage
3. Saves the returned URL to `videos.heygen_subtitle_url`
4. `runCaptionProcessing` already reads `heygenSubtitleUrl` → passes as `opts.subtitleUrl` → `applyCaptionsBrowser` fetches and parses the SRT → accurate word-level timings

**Why:** Without Whisper, `buildFallbackTimings` distributes all words proportionally across the full video duration. Natural speech has pauses and speed variation, so captions drift visibly. Whisper gives exact per-word timestamps.

**Non-fatal:** `transcribeAudioToSrt` returns `null` on any error — caption engine falls back to proportional timings so video generation is never blocked.

## Storage
- SRT namespace: `subtitles/{videoId}.srt` in Object Storage
- Served via `/api/captioned-objects/subtitles/...` — `subtitles/` added to `ALLOWED_NAMESPACES` in `captioned.ts`
- URL uses `REPLIT_DEV_DOMAIN` (same pattern as captioned videos and thumbnails)

## Relevant files
- `artifacts/api-server/src/lib/scheduler.ts` — `transcribeAudioToSrt()` helper + call in TTS completion handler
- `artifacts/api-server/src/routes/captioned.ts` — ALLOWED_NAMESPACES includes `subtitles/`
