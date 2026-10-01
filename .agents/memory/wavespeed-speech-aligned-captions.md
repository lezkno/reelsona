---
name: WaveSpeed speech-aligned captions
description: The proxy's gpt-4o-mini-transcribe returns text only (response_format json, no timestamps); captions are laid over FFmpeg-detected speech intervals instead of spread evenly.
---

## Rule
`transcribeAudioToSrt` (scheduler.ts) gets a plain-text transcript — the Replit proxy rejects `srt`/`verbose_json` for gpt-4o-mini-transcribe. Spreading that text evenly over the whole MP4 (`generateBasicSRT`) drifted on every pause and on leading silence.

Now `detectSpeechIntervals` (silencedetect -35 dB, 0.2 s on the extracted 16 kHz WAV) feeds `transcriptionResponseToSrt(..., speechIntervals)` → `speechAlignedSrt` (`speech-aligned-srt.ts`), source `"speech_aligned"`:
- words go only on speech intervals; split between intervals ∝ speaking time, snapped (±3 words) to punctuation;
- inside an interval words are timed by vowel-group syllables, not characters;
- phrase blocks ≤5 words never span a pause (phrase-level SRT → `buildPhraseCues`).

Real provider word/segment timestamps still win when present. Detection failure → old even spread (`"transcript"`).
Check the log line `[WaveSpeed] Whisper SRT uploaded ✓` → `timingSource`.
