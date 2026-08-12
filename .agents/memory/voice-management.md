---
name: Voice management feature
description: Voces tab in Avatars page — clone, assign, preview voices; wizard voice picker; backend ownership table.
---

## Architecture

- **DB table**: `heygen_cloned_voices` (userId, voiceId, displayName, status, timestamps) — Migration 012 in seed.ts.
- **Backend routes** (artifacts/api-server/src/routes/heygen.ts):
  - `GET /heygen/voices` — enriched with `is_mine: true` for voices owned by the user (joins heygen_cloned_voices).
  - `POST /heygen/voices/clone` — multer (audio, 25 MB), calls `cloneVoice()` lib fn, inserts ownership row.
  - `DELETE /heygen/voices/:voiceId` — ownership check then HeyGen DELETE.
  - `PATCH /heygen/voices/:voiceId` — ownership check then HeyGen PATCH rename.
- **lib/heygen.ts fns**: `cloneVoice(buffer, filename, displayName, apiKey?)` uses native Node 24 `FormData` + `new Blob([new Uint8Array(buffer)])` (not form-data npm package).

## Frontend hooks (lib/api-client-react/src/custom-endpoints.ts)

- `useCloneVoice()` — POST FormData to `/api/heygen/voices/clone`
- `useDeleteVoice()` — DELETE `/api/heygen/voices/:voiceId`
- `useRenameVoice()` — PATCH `/api/heygen/voices/:voiceId` with `{ name }`

## Types

- `HeyGenVoice` interface (lib/api-client-react/src/generated/api.schemas.ts) — added `is_mine?: boolean`.
- `GetHeyGenVoicesResponseItem` Zod schema (lib/api-zod/src/generated/api.ts) — added `"is_mine": zod.boolean().optional()`.
- `VoiceOption` local type in Avatars.tsx — added `is_mine?: boolean`.

## Avatars page (artifacts/content-pilot/src/pages/Avatars.tsx)

- Third tab "Voces" added to `<Tabs>` alongside "Mi Avatar" and "Avatares públicos".
- `allVoices` useMemo: full voice list sorted clones-mine-first.
- Voice tab state: `showCloneDialog`, `assignVoice`, `voiceSearch`, `renamingVoiceId`, `renameValue`, `playingVoiceId`, `audioRef`.
- `CloneVoiceDialog` — drag-drop audio + name → POST clone; polling not needed (HeyGen may be async, user is told to wait).
- `AssignVoiceDialog` — multi-select active looks → writes `voice_overrides[lookId] = voiceId` in Avatars state → saved on next "Guardar" call.

## Wizard voice picker (AvatarCreationDialog prompt mode)

- `promptVoiceId` state added; Select with `__default__` sentinel after pose picker.
- `onCreated(groupId, lookId, voiceId?)` — third arg is the chosen voiceId.
- Parent merges `{ [tp:lookId]: voiceId }` into `voiceOverrides` state on creation.

**Why:** Ownership table needed because the app uses a shared HeyGen API key — the platform must track which user cloned each voice so only they can delete/rename it.

**How to apply:** When adding new voice-related features, check `is_mine` on `HeyGenVoice` to gate destructive operations. Rebuild `lib/api-client-react` after any change to `api.schemas.ts` or `custom-endpoints.ts`.
