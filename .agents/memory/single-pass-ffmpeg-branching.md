---
name: Single-pass FFmpeg branching
description: Constraints for composing normalized video, zoom segments, overlays and captions in one FFmpeg graph.
---

When one normalized video stream feeds several zoom/normal `trim` segments, it must first pass through `split`; FFmpeg filter outputs cannot be consumed by multiple branches directly. Each segment, especially one containing `scale`, must finish with `setsar=1` before `concat`.

**Why:** FFmpeg rejects a reused filter output or concat inputs whose sample-aspect ratios diverge after scaling, even when their visible width and height match.

**How to apply:** Any single-pass renderer that branches a shared video source should calculate the segment count first, split the normalized source into that many labels, and normalize SAR on every branch before concatenation.