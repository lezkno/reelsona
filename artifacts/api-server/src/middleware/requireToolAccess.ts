/**
 * requireToolAccess — checks user_entitlements before tool routes.
 *
 * Bypass (no tool check):
 *   /healthz, /auth/*, /admin/*, /captioned-objects/*,
 *   /users/*, /course/*, /dashboard*, /storage/*
 *
 * Admin (role='admin') always passes without a DB query.
 *
 * Returns 403 { error: "plan_required", courseAccess }
 * for non-admin users with no active plan on blocked paths.
 * Returns 503 when entitlement verification is unavailable; protected tools
 * never fail open on a DB outage.
 *
 * Uses a 90-second in-memory cache per userId to avoid a DB hit on every request.
 */

import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import { userEntitlements } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// ── Simple TTL cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  toolAccessActive: boolean;
  courseAccess:     boolean;
  expiresAt:        number; // ms
}

const cache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 90_000; // 90 seconds

function getCached(userId: number): CacheEntry | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(userId); return null; }
  return entry;
}

function setCached(userId: number, entry: Omit<CacheEntry, "expiresAt">): void {
  cache.set(userId, { ...entry, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Call this to force a re-check on the next request (e.g. after provisioning). */
export function invalidateAccessCache(userId: number): void {
  cache.delete(userId);
}

/**
 * Write a synthetic entry into the in-memory cache.
 * Only intended for unit tests — do not call from production code.
 */
export function _setCacheEntryForTest(
  userId: number,
  entry: Omit<CacheEntry, "expiresAt">,
  ttlMs = CACHE_TTL_MS,
): void {
  cache.set(userId, { ...entry, expiresAt: Date.now() + ttlMs });
}

/**
 * Read the raw cache entry for a user (null = not cached).
 * Only intended for unit tests — do not call from production code.
 */
export function _getCacheEntryForTest(userId: number): CacheEntry | null {
  return cache.get(userId) ?? null;
}

// ── Paths that bypass tool-access check ──────────────────────────────────────

const BYPASS_PREFIXES = [
  "/auth/",
  "/admin/",
  "/captioned-objects/",
  "/users/",
  "/course/",
  "/storage/",
] as const;

// Exact paths or prefixes that no-plan users must always be able to reach
// (any HTTP method):
//   • /billing                             — plan detection and subscription management
//   • /credits                             — view credit balance without a plan
//   • /instagram/auth-url                  — start OAuth handshake
//   • /instagram/callback                  — complete OAuth handshake
//   • /instagram/disconnect                — remove connection
//   • /instagram/refresh-profile-picture   — refresh profile image
//   • /instagram/refresh-token             — maintain connection
const NOPLAN_BYPASS_PREFIXES = [
  "/billing",
  "/credits",
  "/instagram/auth-url",
  "/instagram/callback",
  "/instagram/disconnect",
  "/instagram/refresh-profile-picture",
  "/instagram/refresh-token",
] as const;

// Read-only paths accessible without a plan (GET only).
// POST/PUT/DELETE on the same paths must still be protected.
//   • /videos             — view/download historical videos without a plan
//   • /instagram/account  — view connection status on /connect page
//
// Avatars page — display-only so no-plan users can browse the library
// and see their historical resources (actions are gated in the frontend):
//   • /heygen/public-avatar-groups  — public avatar library
//   • /heygen/my-avatar-groups      — user's own avatar groups
//   • /heygen/avatar-groups         — group + looks metadata
//   • /heygen/v3-groups             — v3 group looks
//   • /heygen/avatar-config         — read avatar config
//   • /heygen/voices                — voices list (show cloning exists)
//   • /heygen/looks                 — look reverse-lookup
//   • /heygen/audio-proxy           — voice audio preview
//   • /heygen/avatars/looks         — look status polling
//   • /wavespeed/personas           — WaveSpeed persona list + status
//   • /wavespeed/voices             — WaveSpeed voice list + status
const NOPLAN_BYPASS_GET_PREFIXES = [
  "/videos",
  "/instagram/account",
  "/heygen/public-avatar-groups",
  "/heygen/my-avatar-groups",
  "/heygen/avatar-groups",
  "/heygen/v3-groups",
  "/heygen/avatar-config",
  "/heygen/voices",
  "/heygen/looks",
  "/heygen/audio-proxy",
  "/heygen/avatars/looks",
  "/wavespeed/personas",
  "/wavespeed/voices",
] as const;

const BYPASS_EXACT = ["/healthz", "/dashboard"] as const;

function bypasses(path: string, method: string): boolean {
  if ((BYPASS_EXACT as readonly string[]).includes(path)) return true;
  if (path.startsWith("/dashboard")) return true; // /dashboard, /dashboard/...
  if (NOPLAN_BYPASS_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (method === "GET" && NOPLAN_BYPASS_GET_PREFIXES.some((p) => path.startsWith(p))) return true;
  return BYPASS_PREFIXES.some((p) => path.startsWith(p));
}

// ── Middleware ────────────────────────────────────────────────────────────────

export const requireToolAccess: RequestHandler = async (req, res, next): Promise<void> => {
  // Skip unprotected paths
  if (bypasses(req.path, req.method)) { next(); return; }

  const session = req.session;
  if (!session?.authenticated || !session.user) { next(); return; } // let requireAuth handle 401

  const { role, userId } = session.user;

  // Admins always pass
  if (role === "admin") { next(); return; }

  // Check cache
  const cached = getCached(userId);
  if (cached) {
    if (cached.toolAccessActive) { next(); return; }
    res.status(403).json({
      error: "plan_required",
      courseAccess: cached.courseAccess,
    });
    return;
  }

  // DB lookup
  try {
    const [row] = await db
      .select({
        toolAccessStatus: userEntitlements.toolAccessStatus,
        toolAccessEndsAt: userEntitlements.toolAccessEndsAt,
        courseAccess:     userEntitlements.courseAccess,
      })
      .from(userEntitlements)
      .where(eq(userEntitlements.userId, userId))
      .limit(1);

    const courseAccess = row?.courseAccess ?? false;
    const status       = row?.toolAccessStatus ?? "disabled";
    const toolAccessActive =
      (status === "active" || status === "trialing") &&
      (!row?.toolAccessEndsAt || row.toolAccessEndsAt > new Date());

    setCached(userId, { toolAccessActive, courseAccess });

    if (toolAccessActive) { next(); return; }

    res.status(403).json({
      error: "plan_required",
      courseAccess,
    });
  } catch (err) {
    console.error("[requireToolAccess] DB error:", err);
    res.setHeader("Retry-After", "5");
    res.status(503).json({
      error: "access_check_unavailable",
      message: "No se pudo verificar temporalmente el acceso al plan. Intenta de nuevo en unos segundos.",
    });
  }
};
