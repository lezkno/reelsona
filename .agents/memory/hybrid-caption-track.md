---
name: Hybrid Canvas caption track
description: Reliable FFmpeg composition for many full-resolution Canvas caption frames.
---

Build a single transparent Canvas caption stream from an ffconcat image sequence, with transparent frames for timeline gaps and a transparent final sentinel, then overlay it once on the picture lock. Stream-copy the picture-lock audio and do not use `-shortest` on the final composition.

**Why:** Chaining one looping 1080×1920 PNG input and overlay filter per cue exhausts FFmpeg resources around normal animated caption counts; a shorter AAC stream can also truncate otherwise valid video when `-shortest` is used.

**How to apply:** Keep normal zoom/typewriter timelines on the concat-track path; reserve the legacy batched video re-encodes only for pathological segment counts. When an FFmpeg invocation fails, log its stage, segment or batch context, exit state, and stderr tail.

Standalone renderer outputs are not readable through the authenticated media proxy until their proxy URL is persisted on an owned video record.

**Why:** The media proxy authorizes dynamic captioned filenames by checking stored video URLs, so an ad-hoc test output is deliberately rejected even for a valid object.

**How to apply:** Use the normal persisted processing flow for in-app playback. For a one-off verification, retrieve the generated object internally and present it as a test asset rather than sharing its protected proxy URL.