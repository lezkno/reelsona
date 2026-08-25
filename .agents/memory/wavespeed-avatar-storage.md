---
name: WaveSpeed avatar storage
description: WaveSpeed-generated avatar looks are persisted in private App Storage with per-user ownership.
---

WaveSpeed is only the generation provider. Completed look images must be downloaded into private App Storage under a user-scoped path, registered in `private_object_ownership`, and stored in the database as `/objects/...`; provider URLs are never durable application data.

**Why:** Provider result URLs are temporary and would make each user's avatars depend on WaveSpeed availability and retention.

**How to apply:** Use a signed App Storage URL only at the boundary when sending a private look back to WaveSpeed. Browser responses should expose `/api/storage/objects/...` so the existing authenticated ownership check protects tenant data.