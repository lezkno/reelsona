---
name: HeyGen API quirks
description: Field-shape gotchas in HeyGen v2 API responses that break naive parsing
---

- `/v2/voices` returns the sample audio in `preview_audio`, NOT `preview_audio_url`. Mapping the wrong field silently yields null previews.
- `/v2/avatar_group/{id}/avatars` returns a MIXED list of two shapes: video-avatar looks (`avatar_id`, `avatar_name`, `preview_image_url`) and talking-photo looks (`id`, `name`, `image_url`). Handle both per-entry; some entries also come with no name.
- Talking-photo ids are prefixed `tp:` in this app so video generation picks character type `talking_photo`.
- `/v2/avatars` is slow (~11s) and mixes in ~1.4k public avatars with duplicate ids; prefer `avatar_group.list?include_public=false` + per-group looks.

**Why:** each of these caused a real bug (dead play button, ZodError 500, duplicate React keys).
**How to apply:** whenever consuming a new HeyGen endpoint, dump one raw response first and validate field names before wiring zod schemas.
