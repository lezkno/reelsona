---
name: HeyGen account integration
description: How the HeyGen API key and credit quota are stored and exposed in ContentPilot — per-user BYOK architecture.
---

## Storage (per-user)
`settings.heygen_api_key TEXT` — per-user key, stored on the user's own `settings` row.
`settings.user_id INTEGER NOT NULL UNIQUE` — FK to `users.id`; every settings row is owned by one user.
Key resolution priority for user-facing routes: DB (user's own row) only — no env var fallback.
Key resolution for scheduler background jobs: first settings row with a key → env var `HEYGEN_API_KEY`.

## Per-user settings architecture
- `settings` table now has `user_id` (unique) — one row per user.
- Session stores `{ username, role, userId: number }` — `userId` is the numeric `users.id`.
- All settings routes (GET/PUT `/settings`) and HeyGen account routes scope queries with `WHERE user_id = req.session.user.userId`.
- Scheduler uses `resolveHeyGenApiKey()` (first row with a key + env var fallback).

## API routes (artifacts/api-server/src/routes/heygen.ts)
- `GET /heygen/account` — returns `{ connected, remaining_quota, total_quota, details, key_source: "db"|"env"|"none" }` for the logged-in user
- `POST /heygen/account/connect` — validates key, saves to logged-in user's settings row
- `DELETE /heygen/account` — clears `heygen_api_key` from logged-in user's settings row

## Quota endpoint
`GET /v2/user/remaining_quota` (underscore, NOT dot — `/v2/user/remaining.quota` returns 404).
Response: `{ data: { remaining_quota: number, details: { api, generative_credit, plan_credit, instant_avatars } } }`
`details` is a flat object, not an array.
**Validation endpoint**: `GET /v2/avatars` → HTTP 200 = valid key, HTTP 401 = invalid key.
`getHeyGenQuota(key)` returns `{ remaining, total: null, details }` — HeyGen has no plan total endpoint.

## HeyGen function signatures
All exported heygen.ts functions (`listAvatars`, `listVoices`, `listAvatarGroups`, `listGroupLooks`, `getAvatarDefaultVoiceId`, `getLookSupportedEngines`, `generateVideo`, `getVideoStatus`) accept an optional `apiKey?: string` param passed through to `getClient(apiKey)`.

## React hooks (lib/api-client-react/src/custom-endpoints.ts)
- `useHeyGenAccount()` — GET /heygen/account
- `useConnectHeyGen()` — POST /heygen/account/connect
- `useDisconnectHeyGen()` — DELETE /heygen/account
- `HEYGEN_ACCOUNT_QUERY_KEY` exported for manual invalidation

**Why:** BYOK so platform owner doesn't pay for user HeyGen usage. Env var `HEYGEN_API_KEY` is only a fallback for scheduler background jobs; remove it from Replit Secrets (Settings → Secrets) to go fully BYOK.
