---
name: WaveSpeed look cache images
description: WaveSpeed look PATCH responses contain canonical object paths that must be normalized before entering browser-side React Query caches.
---

# WaveSpeed look cache images

## The rule

When a WaveSpeed look mutation updates the client cache, normalize private `/objects/...` image paths to the authenticated `/api/storage/objects/...` browser route before replacing the cached look.

**Why:** The API stores and returns the canonical private object path. Replacing a previously usable cached look with that raw path makes the `<img>` request fail after assigning a voice, toggling selection, or renaming the look, even though the image remains intact in storage.

**How to apply:** Keep this conversion at the shared `usePatchWavespeedLook` cache boundary so every unrelated look-field mutation receives the same protection.