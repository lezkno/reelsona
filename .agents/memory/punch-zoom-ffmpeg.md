---
name: Punch Zoom FFmpeg implementation
description: How the punch-zoom video effect works and why zoompan was abandoned.
---

## Rule
Implement punch zoom via **trim + scale + crop + concat**, NOT via zoompan with expressions.

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

## Detection
- Browser engine: `findPunchZoomTimestamps(script, wordTimings, duration)` — uses SRT word timings for precise mapping
- ASS engine: `buildProportionalPunchTimestamps(script, duration)` — proportional position in script text

## Timing
~17s pre-process overhead for a 68s video with 1 punch zoom event (720×1280).
