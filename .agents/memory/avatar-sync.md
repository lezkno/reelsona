---
name: HeyGen avatar sync
description: Auto-sync selected avatars against live HeyGen account to prevent 400 errors from deleted/renamed looks.
---

## What was built

- `getAllAvailableAvatarIds(apiKey?, forceRefresh?)` in `lib/heygen.ts` — fetches all valid look/avatar IDs from the HeyGen account (standalone avatars + all group looks with tp: prefix for photo groups). Cached 5 min; returns `Set<string>`.
- `invalidateAvatarIdsCache()` in `lib/heygen.ts` — call after a confirmed deletion.
- `pruneDeletedAvatars(avatarCfg, heygenApiKey)` in `scheduler.ts` (private) — compares selectedAvatarIds against the live set, removes stale ones, writes to DB, returns updated row.
- Called at the top of every `runAutomationCycle` tick (every 5 min).
- Catch block in `submitVideoForGeneration` also auto-removes the avatar if error message contains "not found" / "avatar may have been deleted" and calls `invalidateAvatarIdsCache()`.

## Why

HeyGen 400 errors were opaque ("Request failed with status code 400") when an avatar was deleted from the account. The 400 body was never logged. Now:
1. Error body is logged via `.catch()` in `generateVideo`.
2. `getLookSupportedEngines` throws a clear error on 404 (avatar gone) instead of silently falling back to avatar_iv.
3. The prune step prevents future cycles from even attempting deleted avatars.

## Edge cases

- If `getAllAvailableAvatarIds` returns an empty set (network failure / auth issue), no pruning happens to avoid false positives.
- If all selected avatars are pruned, the cycle aborts with "No avatars configured" — user must add new avatars.
- `lastUsedAvatarId` is also cleared if it was one of the removed avatars.
