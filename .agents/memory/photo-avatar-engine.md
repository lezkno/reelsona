---
name: Photo avatar engine restriction
description: tp: photo avatars must never use avatar_v engine; getLookSupportedEngines API incorrectly reports it as supported.
---

# Photo avatar must use avatar_iv, not avatar_v

## The rule
When `isPhotoAvatar = true` (avatar_id starts with `tp:`), always force `avatar_iv` regardless of what `getLookSupportedEngines` returns. Code: `const supportsAvatarV = !isPhotoAvatar && supportedEngines.includes("avatar_v")`.

**Why:** HeyGen's `getLookSupportedEngines` endpoint incorrectly lists `avatar_v` as a supported engine for many photo avatar looks. When you send a photo avatar with `engine: {type: "avatar_v"}`, HeyGen accepts the POST and returns a valid videoId, but then silently fails the video during processing (~60 seconds later) with `status: "failed"` and `error: null`. This produces the fallback error "Error desconocido en HeyGen" on our side.

**How to apply:** The check is in `generateVideo()` in `artifacts/api-server/src/lib/heygen.ts`. Any time you touch engine selection logic, preserve `!isPhotoAvatar &&`.

## How we confirmed it
- Dev DB had 20+ successful published videos — all used a single non-`tp:` avatar (`c880e13bfe004a649e26b96f11ced132`), so `isPhotoAvatar = false` and `avatar_v` worked fine.
- Production videos 2 & 3 used `tp:11cb4a6bff8c42c1bbd349986e85f8eb` and `tp:75301275b9c348fb8b6bcfb141cc83ea` with `avatar_v` — both failed within ~62 seconds with `error: null`.
- Pattern: non-photo + avatar_v = ✅; photo (tp:) + avatar_v = ❌ silent fail.
