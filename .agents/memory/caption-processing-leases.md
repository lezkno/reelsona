---
name: Caption processing leases
description: Concurrency rule for recovery-safe long-running caption and effects jobs.
---

Caption processing must use a durable, opaque owner token in addition to its
state and timestamp lease. Every claim assigns a fresh token; heartbeats and
terminal writes must require that exact token.

**Why:** A status plus heartbeat timestamp prevents ordinary overlapping
claims, but a worker that resumes after its lease expires can otherwise renew
the replacement worker's lease or overwrite its finished output.

**How to apply:** Any recovery path may select stale work, but it must
compare-and-set the current state at action time. When a job is reclaimed,
fence all renewals and final result writes by its owner token; clear the token
only when the owning worker transitions to a terminal state.