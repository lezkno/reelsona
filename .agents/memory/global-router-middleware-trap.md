---
name: Global router middleware trap
description: router.use(fn) without a path prefix blocks ALL requests that pass through the router, including paths the router has no route for — causing silent cross-route 403s.
---

## The Rule
Never use `router.use(fn)` (no path argument) in a sub-router that is mounted broadly (e.g. `app.use("/api", router)`). It will intercept **every** request whose URL starts with the mount path, including ones the router has no route for — Express still runs all registered middleware before concluding "no route matched, call next()".

## Why it happened
`routes/users.ts` had `router.use(requireAdmin)` at the top, mounted at `app.use("/api", usersRouter)`. Every request to `/api/*` (including `/api/billing`, `/api/credits`) passed through requireAdmin before it could reach billingRouter (mounted later in app.ts). Non-admin users got 403 "Se requiere rol de administrador" before the billing handler ran.

The misleading symptom: billing returned 403 in ~6–12ms (a role check, not a DB entitlement query), so the initial diagnosis pointed at requireToolAccess (the entitlement middleware) instead of requireAdmin.

## How to apply
- Scope role/auth middleware to the paths it should protect: `router.use("/users", requireAdmin)` instead of `router.use(requireAdmin)`.
- OR apply the middleware per-route: `router.get("/users", requireAdmin, handler)`.
- When debugging unexpected 403s, grep for the exact error message string to find the source middleware immediately — don't assume which middleware is responsible based on timing alone.
- The actual root cause was found by adding `console.log(req.path)` to requireToolAccess and then reading the error body (`{"error":"Se requiere rol de administrador"}`), which revealed it was a *different* middleware entirely.
