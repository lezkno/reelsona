---
name: HeyGen v3 migration
description: Key differences between HeyGen v2 and v3 APIs and how ContentPilot uses them.
---

## v2 → v3 differences

| v2 | v3 |
|----|----|
| `POST /v2/video/generate` | `POST /v3/videos` |
| `video_inputs: [{ character, voice }]` array | Flat payload: `type, avatar_id, script, voice_id` at top level |
| `dimension: { width, height }` | `aspect_ratio: "9:16"` |
| `character.type: "talking_photo"` for photo avatars | All avatars use `type: "avatar"` at request level |
| `character.type: "avatar"` for video avatars | Same |
| No engine selector | `engine: { type: "avatar_v" }` selects Avatar V |
| No expressiveness | `expressiveness: "high"` for photo avatars |
| `GET /v1/video_status.get?video_id=` | `GET /v3/videos/{video_id}` |
| v3 response uses `id` (not `video_id`) | Extract: `res.data?.data?.id ?? res.data?.data?.video_id` |

## How ContentPilot uses v3

- **Video avatars** (no `tp:` prefix): `engine: { type: "avatar_v" }` — best lipsync
- **Photo avatars** (`tp:` prefix, strip it when calling API): `expressiveness: "high"` — most natural for photo-based
- **Captions**: `caption: { file_format: "srt" }` (no `style`) — HeyGen returns `subtitle_url` without burning captions; we burn our own styled captions via FFmpeg

## `tp:` prefix convention

ContentPilot uses `tp:` prefix internally in the DB to flag photo-avatar looks (from HeyGen group type PHOTO/GENERATED_PHOTO). When calling v3, always strip this prefix. The prefix is preserved in `selectedAvatarIds` and `lastUsedAvatarId` in the DB.

**Why:** The v2 group API returned two field shapes: `avatar_id` for video avatars and `id` for photo avatars. We added `tp:` to distinguish them. v3 uses one unified `avatar_id` field but we kept the internal convention for is_talking_photo detection.
