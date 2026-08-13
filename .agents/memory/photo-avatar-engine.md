---
name: Photo avatar engine restriction
description: History of tp: photo avatar engine selection. The old restriction forcing avatar_iv is now REMOVED — HeyGen fixed the bug.
---

# Photo avatars and Avatar V engine

## Current state (mid-2026 onwards)

**Photo avatars (tp: prefix) NOW support Avatar V.** Trust `getLookSupportedEngines` exclusively.

HeyGen confirmed this via:
- `GET /v3/avatars/looks/{id}` returns `supported_api_engines: ["avatar_v","avatar_iv","avatar_iii"]` for photo_avatar looks
- Sending `avatar_id` (tp: look, raw) + `engine: {type: "avatar_v"}` passes schema validation — HeyGen progresses to voice validation, not avatar/engine rejection
- `avatar_image_url` and `photo_url` are **not** valid v3 payload fields (rejected as "Extra inputs") — no need to pass the image separately

**Code:** `const supportsAvatarV = supportedEngines.includes("avatar_v")` — no `!isPhotoAvatar` guard.

**Why:** HeyGen fixed the silent failure bug that caused tp: + avatar_v videos to fail with `error: null` after ~60 s. That restriction was added based on empirical evidence of past failures but is now obsolete.

## Historical context (no longer applicable)

Previously `const supportsAvatarV = !isPhotoAvatar && supportedEngines.includes("avatar_v")` was used because:
- Production videos using `tp:11cb4a6bff8c42c1bbd349986e85f8eb` and `tp:75301275b9c348fb8b6bcfb141cc83ea` with `avatar_v` silently failed (~62 s, `error: null`)
- `getLookSupportedEngines` was incorrectly reporting `avatar_v` as supported even then

This is no longer true as of mid-2026.
