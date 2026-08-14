---
name: WaveSpeed voice speed/pitch tuning
description: How the tuning UX works for WaveSpeed cloned voices, and why the browser preview approach was abandoned.
---

# WaveSpeed voice speed/pitch tuning

## What was built
- `speed` (real) and `pitch` (real) columns on `wavespeed_voices` (migration 024).
- `PATCH /wavespeed/voices/:id` — saves speed/pitch and clears `previewAudioUrl` cache.
- Slider UI in the voice row: SlidersHorizontal button opens an inline editor inside the card.
- Scheduler passes speed/pitch to `submitSpeech()` so actual videos are generated with the configured values.

## Preview UX decision
**Do NOT attempt browser-side audio manipulation** (Web Audio API `AudioBufferSourceNode.playbackRate` / `detune`).

**Why:** Changing pitch independently of speed (or vice versa) requires a phase-vocoder / WSOLA algorithm. The Web Audio API only offers a single `playbackRate` param that couples both. Setting `detune` + a compensated `playbackRate` in a formula that should decouple them actually cancels out — the audio sounds identical regardless of slider value. The user confirmed this in testing.

**Correct UX:** Sliders save config only (zero cost). `Guardar` clears the preview cache. The existing ▶ play button on the voice row auto-regenerates the TTS preview with new settings on next press — same cost as the original preview generation, no extra cost.

**What to tell users:** "Guarda los ajustes y pulsa ▶ en la fila de la voz para escuchar el resultado."

## Backend endpoint
`GET /wavespeed/voices/:id/preview` accepts optional `?speed=&pitch=` query params (added but not used by UI currently). When present, bypasses cache and generates fresh TTS with those values, but does NOT update the DB cache. Useful for future tooling.
