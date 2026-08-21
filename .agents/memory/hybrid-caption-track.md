---
name: Hybrid Canvas caption track
description: Reliable FFmpeg composition for many full-resolution Canvas caption frames.
---

Build a single transparent Canvas caption stream from an ffconcat image sequence, with transparent frames for timeline gaps and a transparent final sentinel, then overlay it once on the picture lock. Stream-copy the picture-lock audio and do not use `-shortest` on the final composition.

**Why:** Chaining one looping 1080×1920 PNG input and overlay filter per cue exhausts FFmpeg resources around normal animated caption counts; a shorter AAC stream can also truncate otherwise valid video when `-shortest` is used.

**How to apply:** Keep normal zoom/typewriter timelines on the concat-track path; reserve the legacy batched video re-encodes only for pathological segment counts. When an FFmpeg invocation fails, log its stage, segment or batch context, exit state, and stderr tail.