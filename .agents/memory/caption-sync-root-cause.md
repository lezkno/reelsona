---
name: Caption sync root causes
description: Two root-cause bugs found and fixed for caption A/V drift; phrase-level SRT architecture and overlay guard pattern.
---

## The two root causes of caption drift

### 1. Character-proportional word splitting in parseSRT (DOMINANT)
HeyGen and Whisper SRTs are phrase-level (3–6 words per block). The old `parseSRT` split each block into per-word timings proportional to character count, fabricating timestamps that were consistently wrong (Spanish phonetic duration ≠ orthographic length). Errors of 200–600 ms per phrase, alternating early/late.

**Fix:** `parseSRT` now keeps each SRT block as one `WordTiming` entry with the full phrase text. Detection in `applyCaptionsBrowser`: if any `WordTiming.text` contains a space → phrase-level → `buildPhraseCues`. Otherwise (Whisper word-level or fallback) → `buildCaptionCues`.

**`buildPhraseCues`:** splits phrase text into words, creates chunks of `wordsPerLine` with equal time per chunk. Sets `activeWordIndex = -1` (phrase mode). `renderCueFrame` treats `phraseMode = cue.activeWordIndex === -1` as "all words active" (activeWordColor, full opacity).

### 2. AAC encoder delay accumulating across batches
Each batch (~15 cues) encoded its own audio to AAC. Each AAC encode adds ~1024 samples (~21 ms at 48 kHz) of priming delay. With ~10 batches → ~210 ms of accumulated A/V drift by end of video. FFmpeg concat `-c copy` cannot compose per-file edit lists correctly.

**Fix:** batch FFmpeg now uses `-an` (no audio). After concat of all video-only segments, a final mux copies source audio with `-c copy` from `captionSourcePath` — one AAC lifecycle, zero accumulation.

## Overlay hasPlayable guard rule
Any "processing" card overlay (GeneratingCardOverlay or similar) that covers the entire card MUST check `!hasPlayable` before rendering. Otherwise it blocks the play button on videos that already have a `captioned_video_url` but a stale `caption_status = null` in the DB (common for legacy videos or status not yet written).

**Why:** `caption_status` in the DB can lag behind `captioned_video_url` for older videos. `hasPlayable = !!(captioned_video_url || video_url)` is the ground truth for whether the video is done.

## SRT granularity detection
- Phrase-level: `wordTimings.some(wt => wt.text.includes(" "))` → use `buildPhraseCues`
- Word-level: no spaces in any text token → use `buildCaptionCues` / `buildBuildingCues`
- `buildFallbackTimings` produces word-level (one token per word, no spaces) → correct path

## Files
- `artifacts/api-server/src/lib/browser-caption-engine.ts` — parseSRT, buildPhraseCues, applyCaptionsBrowser
- `lib/caption-templates/src/renderer.ts` — buildCaptionCues, buildBuildingCues
- `artifacts/content-pilot/src/pages/Videos.tsx` — hasPlayable guard on overlays and badges
