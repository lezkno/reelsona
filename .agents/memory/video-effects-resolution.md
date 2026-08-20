---
name: Video effects resolution
description: Rules for deciding whether optional video effects and captions may run.
---

The current account settings row is authoritative for every effect switch. Normalize missing, null, malformed, and non-boolean values to false so an older video snapshot cannot revive zoom, AI B-roll, or text cards. Only fall back to the stored snapshot when no settings row exists; item overrides apply only the keys they explicitly provide.

**Why:** Partial or stale settings were previously merged with historical snapshots, causing disabled stages to run and potentially consume provider credits.

**How to apply:** Use the shared video-pipeline-effects resolver at video creation and immediately before rendering; keep reapply/admin paths explicit and never default costly effects to true.