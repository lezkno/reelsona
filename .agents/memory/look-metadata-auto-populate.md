---
name: Look metadata auto-populate
description: ensureSelectedLooksHaveMetadata() ensures Avatar V reference_look_id works without the user manually saving Avatar Config.
---

# Look metadata auto-populate

**Rule:** Every automation cycle proactively ensures all selected looks have a row in `avatar_look_metadata`. If rows are missing, HeyGen is queried and the rows are inserted.

**Why:** `generateHeyGenVideo` needs `groupId` + `isMasterLook` from `avatar_look_metadata` to set `reference_look_id` in the Avatar V engine payload. Without it, motion stabilization is silently skipped. Previously, population only happened when the user pressed Save on the Avatar Config page.

**How to apply:**
- `ensureSelectedLooksHaveMetadata(userId, selectedRawIds, apiKey)` is exported from `artifacts/api-server/src/lib/heygen.ts`.
- Called fire-and-forget in `runAutomationCycle` (scheduler.ts), just after `pruneDeletedAvatars`, using the platform `HEYGEN_API_KEY`.
- Errors per-look are non-fatal; generation falls back to Avatar V without `reference_look_id`.
- The same logic also exists in `PUT /heygen/avatar-config` (routes/heygen.ts) for the explicit-save path.
