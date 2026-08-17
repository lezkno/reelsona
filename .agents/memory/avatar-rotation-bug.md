---
name: Avatar rotation bug and fix
description: Two separate bugs cause a manually-pinned WaveSpeed look to be replaced by rotation.
---

## Bug A — HeyGen stored avatarId not re-validated (original fix)

When a content plan item is scripted, an `avatarId` is stored. If the user later removes that avatar from `selectedAvatarIds`, the scheduler still used the stale stored ID.

Fix: before using stored `avatarId`, check `selectedAvatarIds.includes(storedId)`. Re-pick and clear voiceId if stale. Applied in `runAutomationCycle` (draft + backfill paths) and `videos.ts`.

## Bug B — WaveSpeed pinned look replaced by rotation across personas (found Aug 2026)

**Root cause:** `getWavespeedContext` in `scheduler.ts` verified the pinned look's persona was plan-enabled, then iterated ALL plan-enabled personas newest-first. If the pinned look lived in an older persona and a newer persona existed, the loop landed on the newer persona first, found `preferredIdx=-1` there, and rotated to that persona's look — returning the wrong avatar silently.

**Fix:** After the plan-block check, capture `preferredPersonaId` from the look-row query. Filter the personas array to only that persona when a look is pinned. The loop always finds `preferredIdx>=0` and never falls through to another persona.

## Bug C — UI race: picker PATCH vs approval PATCH (found Aug 2026)

The avatar picker saves `wavespeed_look_id` via an async PATCH. `handleApproveAndGenerate` triggers the cycle from its own PATCH's `onSuccess`. If both PATCHes overlap, the cycle may read the item before the picker PATCH commits.

**Fix:** `handleApproveAndGenerate` now re-asserts `wavespeed_look_id` (or `avatar_id`) from `scriptModalItem` in the approval PATCH body, so the correct look is always in DB before the cycle reads the item.

## Bug D — Admin blocked by plan enforcement (found Aug 2026)

Admin users have no subscription row → `getUserPlanSlug` returned null → `getAvatarLimit(null)=0` → all WaveSpeed personas plan-blocked → `PlanBlockedError` thrown → cycle aborted silently.

**Fix:** `getUserPlanSlug` now checks user role first. Admins get internal slug `'admin'`; `AVATAR_LIMITS.admin=999` gives effectively unlimited persona access.
