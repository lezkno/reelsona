---
name: B-Roll Engine
description: Durable constraints for the AI B-roll pipeline — ordering, model/size, and FFmpeg pattern.
---

## Rule
B-roll runs AFTER the zoom pre-pass and BEFORE caption compositing. This order must be preserved: captions always render on top of B-roll.

## Why
If B-roll were applied after captions, captions would be hidden behind the B-roll image. If before zoom, the zoom effect would land on the static B-roll frame instead of the avatar face.

## How to apply
Any new video effect that should appear "under captions" gets inserted between step 3c (zoom) and step 5 (caption cues) in both `browser-caption-engine.ts` and `caption-engine.ts`.

## gpt-image-1 portrait size
Use `size: "1024x1536"` (2:3, the supported portrait format). **Not** `"1024x1792"` — that is DALL-E 3 only and will cause the API to reject the request, silently skipping every segment.

**Why:** The SDK's TypeScript type only lists square sizes; use an `unknown` double-cast to bypass the overload union without losing type safety on the rest of the codebase.

## FFmpeg alpha-overlay pattern for static images
`-loop 1 -t {videoDuration} -i img.png` per image, then per image in filter_complex:
`scale=W:H:force_original_aspect_ratio=increase,crop=W:H,setsar=1,format=yuva420p,fade=t=in:st={startSec}:d=0.3:alpha=1,fade=t=out:st={fadeOutSt}:d=0.3:alpha=1` → `overlay=0:0:eof_action=pass`.
`alpha=1` on `fade` modulates the alpha channel (not brightness), making the image transparent before/after its window so the base video shows through.
