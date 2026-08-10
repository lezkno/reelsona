---
name: Zoom FFmpeg filter
description: crop+scale is the correct Ken Burns zoom implementation; zoompan with d=1 has frame-counting bugs in FFmpeg
---

## Rule
Use `crop` + `scale` with the timestamp variable `t` for Ken Burns zoom. **Do not use `zoompan` with `d=1`** — it has frame-counting quirks that can produce a video with incorrect output duration or no visible effect.

## Working formula
For a center zoom from 1.0× at t=0 to 1.3× at t=T (duration in seconds):
```
crop=w='iw/(1+0.3*min(t,T)/T)':h='ih/(1+0.3*min(t,T)/T)':x='(iw-iw/(1+0.3*min(t,T)/T))/2':y='(ih-ih/(1+0.3*min(t,T)/T))/2':exact=1,scale=WxH
```
Where T, W, H are substituted as string values from `videoInfo`.

**Why:** `crop` uses real frame timestamps (the `t` variable = seconds since stream start), is continuous regardless of dropped/duplicate frames, and always produces the same output dimensions as input. `zoompan` with `d=1` uses an internal frame counter that can desync from actual timestamps, and in practice produced no visible zoom at 1.3× over 68 seconds.

**How to apply:** Anywhere in the codebase where Ken Burns zoom is applied as an FFmpeg pre-process (browser-caption-engine.ts and caption-engine.ts). After the filter, always `scale=W:H` to restore the exact output size.
