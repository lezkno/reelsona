---
name: Render failure publishing safety
description: Rules preventing a caption-render failure from publishing an uncaptioned original video.
---

A failed renderer is not a terminal caption state that is safe to publish. Its completion must atomically make the video visibly failed, preserve the exact error, clear scheduling, avoid copy generation, and be rejected by every publish entry point.

**Why:** Treating a failed render as “ready with original fallback” can silently publish the raw talking-head video, defeating the expected captions and effects.

**How to apply:** Keep an explicit renderer failure marker; protect scheduler, recovery, automatic publish, and manual publish paths independently. Clear that marker only after a successful re-render.