---
name: Punch Zoom FFmpeg implementation
description: How the punch-zoom video effect works, why zoompan was abandoned, and the SRT word-mapping bug fix. Also applies to B-roll engine.
---

## Rule
**Never use `zoompan` with dynamic expressions via execFile on this server.** It is broken in FFmpeg 6.1.2 (Replit NixOS). This applies to ALL video effects, including punch zoom AND B-roll Ken Burns animations.

- Punch zoom: use **trim + scale + crop + concat**.
- B-roll overlay: use **scale + crop** (center crop to exact video dims), no motion. Fade in/out is enough.
- Any future "Ken Burns" or camera-motion effect must avoid zoompan entirely.

## Why
In FFmpeg 6.1.2 (as installed on Replit via NixOS), `zoompan` with dynamic expressions fails:
- Commas inside functions (e.g. `if(between(t,5,8),...)`) cause "Error parsing filterchain" when NOT shell-escaped.
- With single quotes (`z='if(...)'`) passed via `execFile` (no shell), FFmpeg receives the literal single-quote chars. The filter initializes but fails with "Failed to configure output pad on Parsed_zoompan_0" / "Error while filtering: Invalid argument".
- A constant `zoompan=z=1.4:x=0:y=0` WORKS, but dynamic expressions do not.
- The filter_complex ordering for `concat` with both video AND audio must be interleaved per-segment: `[v0][a0][v1][a1]...:concat=n=N:v=1:a=1`, NOT all-v then all-a.

## How to apply
Use `buildPunchZoomArgs(timestamps, duration, W, H)` from `caption-engine.ts`:
- Returns `string[]` ready to spread into execFileAsync args: `["-filter_complex", "...", "-map", "[vout]", "-map", "[aout]"]`
- Returns `null` if no timestamps → skip pre-process
- Creates N+1 normal segments and N zoom segments, trims and concatenates them
- Zoom: scale × 1.4 (H.264 even-dimension rounded), crop back to original WxH from top-center (y=0, face area)
- 3-second zoom hold per event; timestamps come from script/SRT analysis

## AI Detection (findPunchZoomTimestampsAI in caption-engine.ts)
- OpenAI (gpt-4o-mini) receives numbered script sentences and returns N sentence indices
- Each index is mapped to an SRT timestamp using CLOSEST-MATCH, not first-occurrence
- **Critical bug fixed**: using `.find()` (first SRT occurrence) caused all sentences to map to early timestamps (first time a common word appears), then the 6 s spacing filter collapsed them to 1 zoom. Fix: estimate expected time proportionally from char offset in script, search all SRT hits for that word, pick the one with minimum `|hit.startMs - expectedMs|` within a ±35% window.
- Falls back to proportional position if no SRT match found for a sentence
- Gap-fill: if AI mapping yields fewer than maxZooms, pad with proportional fallback positions

## Detection count
- videoDuration < 30 s → 2 zooms; < 70 s → 3 zooms; ≥ 70 s → 4 zooms
- Minimum 6 s spacing between events; not in first 3 s or last 4 s

## Timing
~17 s pre-process overhead for a 68 s video with 1 punch zoom event (720×1280).
