---
name: B-roll credit billing invariants
description: Concurrency/idempotency invariants for per-image B-roll credit charges
---
- B-roll images are billed per-segment with feature-discriminated ledger rows; video-level settlement must exclude them or one reservation can settle the other.
- **Why:** the browser caption engine can bill B-roll then fail and fall back to the FFmpeg engine, and recovery can relaunch a caption job while the original is alive — both re-run B-roll for the same video.
- Invariants: (1) reserve is idempotent per video+segment — a consumed/pending prior attempt means regenerate free; a released one means re-charge; (2) the check-and-reserve must be serialized with a per-video+segment advisory lock, or two concurrent runs double-charge; (3) the orphan-reserve sweep must skip videos with an active caption job, or it releases work a live processor is about to consume (free image).
- **How to apply:** any billed sub-step of a retryable pipeline needs all three: discriminated rows, locked idempotent reserve, ownership-aware sweep.
