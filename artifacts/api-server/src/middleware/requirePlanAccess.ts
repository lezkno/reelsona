/**
 * requirePlanAccess — plan-tier authorization middleware.
 *
 * Rejects non-qualifying users with 403 { error: "plan_access_required", requiredPlan }.
 *
 * Pass-through rules (no DB query):
 *   - role = 'admin'  → always allowed
 *   - user has a subscription with a slug in `allowedPlans` → allowed
 *   - no subscription / plan not in list → 403
 *
 * Uses a per-user in-memory cache (60 s TTL) to avoid a DB round-trip on
 * every request.
 *
 * Usage:
 *   router.post("/automation/trigger", requirePlanAccess(["pro","founder"]), handler)
 */

import type { RequestHandler } from "express";
import { db } from "@workspace/db";
import { subscriptionsTable } from "@workspace/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";

// ── Cache ─────────────────────────────────────────────────────────────────────

interface PlanEntry {
  planSlug:  string | null; // null = no active subscription
  expiresAt: number;
}

const PLAN_CACHE = new Map<number, PlanEntry>();
const PLAN_CACHE_TTL_MS = 60_000; // 60 s

function getCachedPlan(userId: number): PlanEntry | null {
  const entry = PLAN_CACHE.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { PLAN_CACHE.delete(userId); return null; }
  return entry;
}

function setCachedPlan(userId: number, planSlug: string | null): void {
  PLAN_CACHE.set(userId, { planSlug, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
}

/** Invalidate after a subscription change (e.g. from the webhook). */
export function invalidatePlanCache(userId: number): void {
  PLAN_CACHE.delete(userId);
}

/** Test-only helpers */
export function _setPlanCacheForTest(userId: number, planSlug: string | null, ttlMs = PLAN_CACHE_TTL_MS): void {
  PLAN_CACHE.set(userId, { planSlug, expiresAt: Date.now() + ttlMs });
}
export function _getPlanCacheForTest(userId: number): PlanEntry | null {
  return PLAN_CACHE.get(userId) ?? null;
}

// ── Middleware factory ─────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ["active", "trialing"] as const;

/**
 * Returns Express middleware that 403s unless the authenticated user has
 * an active subscription whose planSlug is in `allowedPlans`.
 * Admins always bypass.
 */
export function requirePlanAccess(allowedPlans: string[]): RequestHandler {
  return async (req, res, next): Promise<void> => {
    const session = req.session;
    if (!session?.authenticated || !session.user) { next(); return; } // 401 handled elsewhere

    const { role, userId } = session.user;

    // Admins are never gated
    if (role === "admin") { next(); return; }

    // Check cache first
    const cached = getCachedPlan(userId);
    if (cached) {
      if (cached.planSlug && allowedPlans.includes(cached.planSlug)) {
        next(); return;
      }
      res.status(403).json({
        error:        "plan_access_required",
        requiredPlan: allowedPlans[0] ?? "pro",
        currentPlan:  cached.planSlug,
        message:      `Esta función requiere el plan ${allowedPlans[0] ?? "Pro"} o superior.`,
      });
      return;
    }

    // DB lookup — find active subscription
    try {
      const [row] = await db
        .select({ planSlug: subscriptionsTable.planSlug, status: subscriptionsTable.status })
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.userId, userId),
            inArray(subscriptionsTable.status, [...ACTIVE_STATUSES]),
          ),
        )
        .orderBy(desc(subscriptionsTable.currentPeriodStart))
        .limit(1);

      const planSlug = row?.planSlug ?? null;
      setCachedPlan(userId, planSlug);

      if (planSlug && allowedPlans.includes(planSlug)) {
        next(); return;
      }

      res.status(403).json({
        error:        "plan_access_required",
        requiredPlan: allowedPlans[0] ?? "pro",
        currentPlan:  planSlug,
        message:      `Esta función requiere el plan ${allowedPlans[0] ?? "Pro"} o superior.`,
      });
    } catch (err) {
      console.error("[requirePlanAccess] DB error:", err);
      // Fail closed — a query failure must not grant Pro-only access
      res.status(503).json({
        error:   "plan_check_unavailable",
        message: "No se pudo verificar el plan de suscripción. Intenta de nuevo en unos segundos.",
      });
    }
  };
}
