---
name: Zoom FFmpeg filter
description: crop+scale is the correct Ken Burns zoom implementation; zoompan with d=1 has frame-counting bugs in FFmpeg
---

## Rule
Use `scale` (with `eval=frame`) + `crop` (fixed size) for Ken Burns zoom in FFmpeg 6.x.

**Do NOT use:**
- `zoompan` with `d=1` — frame-counter quirks can produce invisible effect
- `crop` with `eval=frame` — this option does NOT exist in FFmpeg 6.1.2 (`Option not found` error)
- `crop` with variable `w`/`h` expressions — FFmpeg 6.x evaluates `w`/`h` once at init (t=0), zoom never moves

## Working formula
For a center zoom from 1.0× at t=0 to 1.3× at t=T (duration in seconds):
```
scale=w='W*(1+0.3*min(t,T)/T)':h='H*(1+0.3*min(t,T)/T)':eval=frame,crop=W:H:x='(in_w-W)/2':y='(in_h-H)/2'
```
Where T, W, H are the video's duration and pixel dimensions (substituted as literals, not variables).

**Why this works:**
- `scale` with `eval=frame` IS supported in FFmpeg 6.1.2 — grows output from W×H → 1.3W×1.3H
- `crop` with fixed `w=W h=H` — output is always constant size (H.264 encoder happy)
- `x='(in_w-W)/2'` and `y='(in_h-H)/2'` — `in_w`/`in_h` update per frame as scale output grows

**How to apply:** In browser-caption-engine.ts (pre-process step 3c) and caption-engine.ts (zoomFilter prefix). Both files now use this pattern.
