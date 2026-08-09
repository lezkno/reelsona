---
name: Commercial access pipeline
description: Architecture of the tool access enforcement system — backend middleware, frontend guards, email URL handling, and admin provisioning UI.
---

## Backend middleware — requireToolAccess

- File: `artifacts/api-server/src/middleware/requireToolAccess.ts`
- Mounted in `app.ts` AFTER `requireAuth`, BEFORE main router: `app.use("/api", requireToolAccess)`
- Admins (role='admin') always bypass — no DB query
- 90-second in-memory cache per userId to avoid DB hit on every request
- `invalidateAccessCache(userId)` export for post-provision cache busting

**Bypass paths** (no tool check needed):
`/auth/`, `/admin/`, `/captioned-objects/`, `/users/`, `/course/`, `/storage/`, `/dashboard`, `/healthz`

**Response for blocked users:**
`403 { error: "tool_access_expired" | "tool_access_required", courseAccess: boolean }`

## Email URL consistency

- `getAppUrl()` in `lib/email.ts` — reads `process.env.APP_URL`, logs warning (deduplicated) if not set, falls back to `https://reelsona.com`
- All 4 email templates now use `getAppUrl()` or accept `appUrl` param
- `welcomeEmail(name, appUrl?)` — optional param; uses `getAppUrl()` if omitted
- Callers: `routes/users.ts` passes `getAppUrl()` explicitly; `routes/auth.ts` uses it for verify URLs

**Why:** APP_URL was previously hardcoded in 2 places independently. Centralized to avoid silent mismatches.

## Frontend shared hook

- `artifacts/content-pilot/src/hooks/useEntitlement.ts` — exports `useEntitlement()` and `EntitlementData`
- React Query key: `["auth", "entitlement"]` — deduplicated across Layout + AccessStatus + ToolRoute
- staleTime: 5 min; retry: false (don't retry 401)

## Frontend guards

**AccessBanner** (in `Layout.tsx`):
- Shows amber banner if `daysRemaining ≤ 7 && toolAccessActive`
- Shows red banner if `!toolAccessActive && !isAdmin`
- Has link to /course if courseAccess=true

**ToolRoute** (in `App.tsx`):
- Wraps: /connect, /audit, /content, /avatars, /videos, /automation, /captions
- If `data && !data.isAdmin && !data.toolAccessActive` → renders `<AccessExpired />` inline
- NOT wrapped: /, /settings, /profile, /course, /users, /access-expired

**AccessExpired** page at `/access-expired`:
- Shows "acceso vencido" card
- If courseAccess → link to /course
- Contact asesor CTA (info@reelsona.com)

## Admin provisioning UI (Users.tsx)

- `ProvisionDialog` component: calls `POST /api/admin/provision` with session auth (admin session cookie)
- `EntitlementsSection` component: fetches `GET /api/admin/entitlements`, TanStack Query key `["admin","entitlements"]`
- Both use direct fetch with `credentials: "include"` (not generated client)
- ProvisionDialog shows success state with `emailSent` and `warning` differentiation

## Critical config (production blocking)

- `APP_URL` secret must be set to the deployment URL before sending any emails
- `RESEND_FROM_EMAIL` secret should match a verified domain in Resend
- Without APP_URL: emails send but links point to https://reelsona.com (warning in logs)
