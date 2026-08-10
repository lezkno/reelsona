---
name: Text cards FFmpeg overlay
description: Two non-obvious FFmpeg gotchas required to make transparent PNG overlays appear on video at specific timestamps
---

## Rules

1. **`-loop 1 -t <duration>`** — Static PNG inputs MUST use `-loop 1 -t <videoDuration+1>` so the image stream covers the full video duration. Without it, FFmpeg consumes the single frame at t=0 and the stream ends; any `fade=st=N` that fires after t=0 never activates and the overlay is invisible. `eof_action=pass` silently bypasses it.

2. **`format=yuva420p`** — Must be prepended to the fade filter on RGBA PNG inputs so the alpha channel is preserved through `fade=alpha=1`. Without it the PNG is treated as RGB (no alpha) and the overlay is a solid opaque rectangle.

**Why:** Both bugs produce the same symptom — FFmpeg exits code 0, logs say "applied ✓", but the cards are invisible in the output video. The overlay filter runs without error in both cases.

**How to apply:** For any static PNG overlaid on video at a specific timestamp, always use:
```
-loop 1 -t <ceil(videoDuration+1)> -i image.png
...
[N:v]format=yuva420p,fade=t=in:st=X:d=D:alpha=1,fade=t=out:st=Y:d=D:alpha=1[label];
[prev][label]overlay=0:0:eof_action=pass[out]
```

See `broll-engine.ts` (line 361) for the reference implementation that has both correct.
