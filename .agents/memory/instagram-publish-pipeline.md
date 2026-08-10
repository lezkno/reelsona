---
name: Instagram Publish Pipeline
description: Hard-won lessons about the publish route, auth bypass, and timeout behavior.
---

## Rule: /captioned-objects must be in captioned.ts (before requireAuth)

Any route that Instagram's servers need to download must live in `artifacts/api-server/src/routes/captioned.ts`, which is mounted in `app.ts` at line ~95 **before** `requireAuth` and `requireToolAccess`.

If the route is inside `videosRouter` (mounted with `requireToolAccess` in `routes/index.ts`), Instagram's unauthenticated request gets 403.

**Why:** Instagram fetches the video URL when creating a media container — it sends no session cookie. The `videosRouter` is wrapped in `requireToolAccess` which blocks unauthenticated requests even though `requireAuth` has a `/captioned-objects/` bypass.

**How to apply:** If a new media endpoint needs to be public (e.g., thumbnail, audio), add it to `captioned.ts`, not to any router mounted after `requireAuth`.

## Rule: path-to-regexp v8 rejects bare `*` wildcards

Express in this project uses `router@2` + `path-to-regexp@8`, which requires named parameters instead of bare `*`. `router.get("/path/*", ...)` throws at startup.

Use `router.use("/path", handler)` instead — it matches all sub-paths and `req.path` inside the handler is the remaining path after stripping the mount prefix.

## Rule: Publish endpoint must fire-and-forget

The Replit proxy times out HTTP requests after ~30 seconds. An Instagram publish can take 30–120 seconds (container processing + polling). If the route awaits `publishVideoToInstagram`, the request will 502.

The publish route now fires `publishVideoToInstagram(videoId).catch(logger.error)` without `await` and returns immediately. The UI polls `/api/videos` every 5 s and picks up `publishing → published/failed` status changes.

**Why:** Replit's proxy enforces a hard timeout; polling is already implemented in the UI.

## Container error recovery

When Instagram returns `ERROR` for a container:
1. The code clears `igContainerId` (sets to null) and sets `status: "failed"` in the DB.
2. The publish route resets `failed` → `ready` when the user retries (provided `videoUrl` exists).
3. A fresh container is created on retry with the now-public URL.

If signing the GCS URL fails (sidecar unavailable), the fallback is the stored dev-domain URL — which now works because `/captioned-objects` is served before auth.
