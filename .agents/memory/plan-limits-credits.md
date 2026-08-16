---
name: Plan limits and look/voice credits
description: Avatar AI plan caps, per-look credit gate (4th+ look), per-voice-clone credit gate (2nd+), and where each is enforced.
---

# Plan limits and look/voice credits

## Avatar AI plan limits
- `AVATAR_LIMITS` in `artifacts/api-server/src/lib/planLimits.ts`: `{ basic: 1, pro: 3, founder: 3 }`
- `getUserPlanSlug(userId)` — 60 s in-memory cache; queries `subscriptionsTable`
- `computePersonaPlanEnabled(personas, limit)` — sorts by `createdAt ASC`, marks first N as enabled; used to downgrade-block without a DB flag column
- Enforcement: `POST /wavespeed/personas` returns 403 if at limit (admins bypass)
- UI: `GET /wavespeed/personas` returns `{ personas, planSlug, planLimit }`; Avatars.tsx shows counter and disables button; blocked cards get amber "Pro" badge + grayscale

## Look credits (4th+ look per persona)
- `FREE_LOOKS_PER_PERSONA = 3`, `LOOK_CREDIT_COST = 2`
- Count is total looks for the persona (any status) — pending counts to prevent over-generation during initial wizard
- Credit check: `POST /wavespeed/personas/:id/looks/generate` — 402 if not enough credits
- Reservation: after look row is created (so we have the look ID), `reserveLookCredits(userId, 2, look.id, ...)`
- Consume: `GET /wavespeed/personas/:id/looks/status` on `generationStatus → "ready"`, calls `consumeLookCredits(look.id)` — idempotent no-op if no reservation
- Release: same route on `generationStatus → "failed"`, calls `releaseLookCredits(look.id, ...)` — idempotent no-op
- `credit_ledger.look_id` column added in migration 026

## Voice clone credits (2nd+ clone per user)
- `FREE_VOICE_CLONES = 1`, `EXTRA_VOICE_CREDIT_COST = 10`
- WaveSpeed voices: counted via `countNonFailedWsVoices(userId)` (status != 'failed')
- HeyGen voices: counted directly from `heygenClonedVoicesTable` with `ne(status, 'failed')`
- WaveSpeed path: `POST /wavespeed/voices/clone` gates credits; `GET /wavespeed/voices/:id/status` consume/release on status transition
- HeyGen path: `POST /heygen/voices/clone` gates credits; scheduler's `pollPendingClonedVoices` `updateVoice` callback calls consume/release on `status === "ready"` / `"failed"`
- `credit_ledger.voice_clone_id` + `credit_ledger.voice_clone_type` ('wavespeed'|'heygen') added in migration 026

**Why separate WS and HeyGen counters?**
Cross-provider counting would require heygen.ts to query wavespeed tables and vice versa. Separate counters give each provider one free clone. Acceptable for now since WaveSpeed is the primary voice-clone UI path.

**Idempotency:**
`consumeLookCredits`, `releaseLookCredits`, `consumeVoiceCredits`, `releaseVoiceCredits` are all no-ops when no pending reservation exists for the given ID — safe to call even for free (unreserved) items.
