---
name: Voice overrides clean bug
description: The avatar config auto-save debounce was stripping voice overrides for any look not in selectedIds, silently deleting public look voice assignments.
---

# Voice Overrides Clean Bug

## The Rule
When the debounced save fires in `Avatars.tsx`, the `cleanedOverrides` loop MUST NOT filter by `selectedIds.has(lookId)`. Voice overrides for ANY look (public or private, selected or not) must be preserved.

**Why:** The old guard `if (snapshotIds.has(lookId) && voiceId && ...)` was intended to remove orphaned overrides. But users assign voices to public avatar looks before (or independently of) selecting them for the rotation. The 700ms debounce would then fire and strip those assignments immediately.

**How to apply:** In `artifacts/content-pilot/src/pages/Avatars.tsx` inside `doSave()`, the condition is now just:
```typescript
if (voiceId && voiceId !== LOOK_DEFAULT_VOICE_SENTINEL) {
  cleanedOverrides[lookId] = voiceId
}
```
Do not add `snapshotIds.has(lookId)` back even if someone refactors the save logic.
