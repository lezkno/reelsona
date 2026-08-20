---
name: WaveSpeed caption sync via Whisper
description: WaveSpeed captions must be transcribed from the final MP4 audio, NOT the TTS MP3 — InfiniteTalk may add pre-speech silence that shifts all timestamps.
---

## Root cause (confirmed by architect review)

Transcribing the TTS MP3 audio produces word timestamps relative to the raw audio file.
InfiniteTalk (WaveSpeed infinitetalk-fast) may prepend silence or apply time-stretch before the avatar begins speaking. The final MP4's audio track therefore starts at a different t=0 than the TTS MP3, causing ALL captions to appear ahead of the voice.

`asetpts=PTS-STARTPTS` cannot fix a SRT whose timestamps are anchored to a different media file.

## Rule

**Transcription must happen AFTER the talking-head MP4 is ready, using audio extracted from that MP4.**

In `scheduler.ts` — WaveSpeed `"th"` completion handler (NOT the `"tts"` handler):
1. `persistVideoAssetsToStorage` stores the MP4 → returns `persistent.videoUrl`
2. `transcribeAudioToSrt(persistent.videoUrl, videoId)` — FFmpeg extracts 16 kHz mono WAV from the MP4, Whisper transcribes word-level (`gpt-4o-mini-transcribe`, `verbose_json`, `timestamp_granularities: ["word"]`), SRT uploaded to `subtitles/{videoId}.srt`
3. SRT URL saved to `videos.heygen_subtitle_url`
4. `runCaptionProcessing(videoId, persistent.videoUrl, contentPlanId, undefined, srtUrl ?? null)` — explicit SRT URL passed so caption engine doesn't fall back to proportional timings

**Why FFmpeg extraction, not passing MP4 directly to Whisper:**
MP4 files at 352×640 can reach 15-30 MB and risk Whisper's 25 MB file limit. Extracting a 16 kHz mono WAV is ~1-3 MB for a 60 s clip, well within limits and ensures no format ambiguity.

**Non-fatal:** `transcribeAudioToSrt` returns `null` on any error — caption engine falls back to proportional timings so video generation is never blocked.

## Whisper model compatibility
`gpt-4o-mini-transcribe` — `whisper-1` is NOT supported by the Replit AI proxy.

The proxy's accepted transcription response formats can change. Production
currently rejects `response_format: "srt"` for this model with HTTP 400, and an
earlier proxy version rejected `verbose_json` plus timestamp granularities.

**Rule:** Verify the active proxy's supported formats before relying on a
format-specific parser. A transcription incompatibility must remain non-fatal:
log it and let the caption engine use proportional timings rather than blocking
the completed video.

## Storage
- SRT namespace: `subtitles/{videoId}.srt` in Object Storage
- Served via `/api/captioned-objects/subtitles/...` — `subtitles/` in `ALLOWED_NAMESPACES` in `captioned.ts`
- URL uses `REPLIT_DEV_DOMAIN`

## Relevant files
- `artifacts/api-server/src/lib/scheduler.ts` — `transcribeAudioToSrt()` + call in TH completion handler
- `artifacts/api-server/src/routes/captioned.ts` — ALLOWED_NAMESPACES includes `subtitles/`
