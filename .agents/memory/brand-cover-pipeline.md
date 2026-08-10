---
name: Brand cover pipeline
description: How Reel cover generation works; C2PA PNG gotcha; current UI status
---

# Brand cover pipeline

## Pipeline (stops at first success)
1. **Canvas composite** (`generateCanvasCompositeCover`) — downloads the real HeyGen avatar photo, draws it as a full-bleed background at 1080×1920, overlays a brand-color gradient on the left, adds hook text. Fast, deterministic, 100% avatar-consistent. PRIMARY path when `avatarImageUrl` is available.
2. **gpt-image-1 images.generate** — AI text-only cover at `1024×1536`. Only used when no avatar photo is available.
3. **Canvas fallback** (`generateCanvasCover`) — pure brand-gradient canvas, no photo.

## C2PA PNG gotcha
gpt-image-1 returns **C2PA-signed PNGs**. `@napi-rs/canvas loadImage()` cannot handle them (throws "Invalid SVG image"). Fix: upload the raw buffer directly via `uploadImageToGcs` — **never** pass the result through `loadImage` or any canvas transcoding step.

## Avatar photo lookup (HeyGen)
`fetchAvatarPreviewImage(heygenApiKey, avatarId)` in `lib/heygen.ts`. Talking-photo avatars use `tp:` prefix — match as `tp:${look.id}` in group looks, use `look.image_url`.

## images.edit dropped
`images.edit` was tried (avatar + logo as references) but gpt-image-1 interprets the face creatively — each call produces a different-looking person. Canvas composite is the correct approach for avatar consistency.

## UI status (Aug 2026)
Cover generation UI is **hidden** in `Videos.tsx` while the feature matures:
- `RegenarCoverButton` component exists but is not rendered
- `thumbnail_cover_url` is not shown in video card thumbnails (only `thumbnail_url` is used)
- Download cover button removed; only "Descargar video" remains

Re-enable by adding `<RegenarCoverButton>` back to the ready/published card sections and restoring `thumbnail_cover_url ?? thumbnail_url` in the thumbnail `<img src>`.

**Why:** AI-generated faces were inconsistent; canvas composite was judged not professional enough yet for users to see.
