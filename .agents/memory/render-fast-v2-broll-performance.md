---
name: Render Fast V2 B-roll performance
description: Keeps static B-roll images from becoming per-frame PNG decode and scale work in the V2 FFmpeg graph.
---

Render Fast V2 must scale each B-roll still once, then use FFmpeg's `loop` filter plus `setpts` to repeat that scaled frame before applying the animated crop and fade. Do not drive B-roll with input-level `-loop 1` for the full video duration.

**Why:** Re-reading and Lanczos-scaling every B-roll PNG at video FPS can make a short 1080×1920 render exceed its hard timeout on constrained production CPU. The failure surfaces as FFmpeg being killed (`SIGKILL`) and otherwise looks like a generic command failure.

**How to apply:** Keep the still as a single FFmpeg input, then order the branch as scale → loop/filter timestamp reset → animated crop → alpha fade → overlay. Preserve the renderer's terminal failure behavior; report a timeout as an actionable render message rather than exposing the full FFmpeg command.