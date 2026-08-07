---
name: Avatar rotation bug and fix
description: Stored avatarId on content items must be re-validated against current selection before use.
---

## The bug

When a content plan item is first scripted, an `avatarId` is assigned and stored in the DB. If the user later removes that avatar from their `selectedAvatarIds`, the scheduler and manual-generate route still used the stored ID — calling HeyGen with an avatar the user no longer wants.

## The fix (applied in scheduler.ts and videos.ts)

Before using a stored `avatarId`, always check:
```typescript
const valid = storedId && selectedAvatarIds.includes(storedId);
const avatarId = valid ? storedId : pickNextAvatar(selectedAvatarIds, ...);
if (!valid) contentItem.voiceId = null; // force voice re-resolution for new avatar
```

This applies in three places:
1. `runAutomationCycle` — draft path (assigning avatar to a scripted item)
2. `runAutomationCycle` — backfill path (scripted items about to generate video)
3. `videos.ts` manual generate route

**Why:** The `??` pattern (`stored ?? pickNext()`) only fills null values. Removed avatars are not null — they're stale non-null values that bypass the rotation entirely.
