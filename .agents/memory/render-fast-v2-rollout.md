---
name: Render Fast V2 rollout
description: Production rollout rule for the WaveSpeed caption-rendering path.
---

Render Fast V2 is the permanent default for every WaveSpeed talking-head video,
including production. The Browser caption renderer is not the normal
production path; it remains available only through the explicit
`VIDEO_RENDERER=legacy` emergency rollback.

**Why:** The Browser renderer's native PNG/canvas rendering can destabilize the
production process during caption work. V2 keeps zoom, B-roll, captions and
audio in one FFmpeg render, avoiding that native frame-rendering path.

**How to apply:** Do not add production opt-in flags around V2. A deployment
restart lets stale WaveSpeed caption leases be recovered through V2; retain the
legacy environment switch only for an intentional incident rollback.