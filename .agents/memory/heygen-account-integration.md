---
name: HeyGen account integration
description: How the HeyGen API key and credit quota are stored and exposed in ContentPilot.
---

## Storage
`settings.heygen_api_key TEXT` — user-stored key via settings page UI.
Priority: DB key → `process.env.HEYGEN_API_KEY` env var → throws.
`getClient(apiKey?: string)` in `heygen.ts` now accepts optional key; all existing callers pass no arg (use env).

## API routes (artifacts/api-server/src/routes/heygen.ts)
- `GET /heygen/account` — returns `{ connected, remaining_quota, total_quota, key_source: "db"|"env"|"none" }`
- `POST /heygen/account/connect` — validates key via HeyGen, saves to DB settings row
- `DELETE /heygen/account` — sets `heygen_api_key = null` in DB (falls back to env)

## Quota endpoint
HeyGen does NOT expose a public credits/quota API — `GET /v2/user/remaining.quota` returns 404.
**Validation endpoint**: `GET /v2/avatars` → HTTP 200 = valid key, HTTP 401 = invalid key.
`getHeyGenQuota(key)` always returns `{ remaining: null, total: null }` (no public endpoint exists).
`validateHeyGenKey(key)` uses `/v2/avatars` to confirm the key works.

## React hooks (lib/api-client-react/src/custom-endpoints.ts)
- `useHeyGenAccount()` — GET /heygen/account, staleTime 2 min, no retry
- `useConnectHeyGen()` — POST /heygen/account/connect mutation
- `useDisconnectHeyGen()` — DELETE /heygen/account mutation
- `HEYGEN_ACCOUNT_QUERY_KEY` exported for manual invalidation

## Settings UI
New "Integraciones" section at top of `artifacts/content-pilot/src/pages/Settings.tsx` above the content/tone cards.
- `HeyGenIntegrationCard` component — standalone, handles connect/disconnect/refresh.
- Credit bar: green when >50%, amber 20–50%, red <20% remaining.
- `key_source === "env"` shows read-only label (can't change from UI).

**Why:** Key stored in DB allows runtime changes without redeploying. Env var is the fallback for servers where the key is injected at deploy time (e.g. Replit Secrets).
