/**
 * Plan-limit constants and helpers for Reelsona's Avatar AI / Look / Voice features.
 *
 * Limits enforced here (never leak provider names to the user):
 *   - Avatar AI per plan:     basic = 1, pro = 3, founder = 3
 *   - Free looks per persona: 3 (Profesional / Cercano / Dinámico — first batch)
 *   - Extra look cost:        2 credits each (4th look onwards)
 *   - Free voice clones:      1 (first clone is always free regardless of provider)
 *   - Extra voice cost:       10 credits each (2nd clone onwards)
 *
 * getUserPlanSlug() uses a short in-memory cache (60 s TTL) that mirrors the
 * same cache in requirePlanAccess.ts — both can coexist without interference.
 */

import { db } from "@workspace/db";
import {
  subscriptionsTable,
  wavespeedPersonasTable,
  wavespeedVoicesTable,
  heygenClonedVoicesTable,
  users,
} from "@workspace/db";
import { and, eq, inArray, ne, count as drizzleCount } from "drizzle-orm";

// ── Limit constants ───────────────────────────────────────────────────────────

/** Maximum number of Avatar AI personas allowed per plan slug. */
export const AVATAR_LIMITS: Record<string, number> = {
  basic:   1,
  pro:     3,
  founder: 3,
  admin:   999, // internal sentinel — admins are not subject to plan limits
};

/** Default limit when the user has no active subscription. */
export const DEFAULT_AVATAR_LIMIT = 0;

/** Number of looks included for free when a persona is created. */
export const FREE_LOOKS_PER_PERSONA = 3;

/** Number of voice clones included for free (per user, across all providers). */
export const FREE_VOICE_CLONES = 1;

// Credit costs are defined in credits.ts (LOOK_CREDIT_COST, EXTRA_VOICE_CREDIT_COST)
// and re-exported here for co-location.
export { LOOK_CREDIT_COST, EXTRA_VOICE_CREDIT_COST } from "./credits";

// ── Plan cache ────────────────────────────────────────────────────────────────

interface PlanEntry {
  planSlug:  string | null;
  expiresAt: number;
}

const PLAN_CACHE     = new Map<number, PlanEntry>();
const PLAN_TTL_MS    = 60_000;
const ACTIVE_STATUSES = ["active", "trialing"] as const;

/** Force a cache eviction after a subscription change (e.g. Stripe webhook). */
export function invalidateUserPlanCache(userId: number): void {
  PLAN_CACHE.delete(userId);
}

/**
 * Return the user's active plan slug, or null if they have no active subscription.
 * Results are cached for 60 s to avoid repeated DB lookups on every request.
 * Admins bypass plan limits at the route level; this function has no special admin logic.
 */
export async function getUserPlanSlug(userId: number): Promise<string | null> {
  const cached = PLAN_CACHE.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.planSlug;

  // Admins bypass all plan limits — they are treated as having unlimited access.
  const [userRow] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (userRow?.role === "admin") {
    PLAN_CACHE.set(userId, { planSlug: "admin", expiresAt: Date.now() + PLAN_TTL_MS });
    return "admin";
  }

  const [row] = await db
    .select({ planSlug: subscriptionsTable.planSlug })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.userId, userId),
        inArray(subscriptionsTable.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(1);

  const planSlug = row?.planSlug ?? null;
  PLAN_CACHE.set(userId, { planSlug, expiresAt: Date.now() + PLAN_TTL_MS });
  return planSlug;
}

/**
 * Return how many Avatar AI personas this user is allowed to create.
 * 0 = no plan (creation blocked).
 */
export function getAvatarLimit(planSlug: string | null): number {
  if (!planSlug) return DEFAULT_AVATAR_LIMIT;
  return AVATAR_LIMITS[planSlug] ?? DEFAULT_AVATAR_LIMIT;
}

/**
 * Count how many WaveSpeed personas the user currently owns.
 * Used to enforce per-plan avatar creation limits.
 */
export async function countUserPersonas(userId: number): Promise<number> {
  const [row] = await db
    .select({ cnt: drizzleCount() })
    .from(wavespeedPersonasTable)
    .where(eq(wavespeedPersonasTable.userId, userId));
  return Number(row?.cnt ?? 0);
}

/**
 * Return the ordinal position of the persona among the user's personas sorted by
 * createdAt ASC. Used to determine which personas are "enabled" by the plan limit.
 * Personas with position ≤ planLimit are enabled; the rest are blocked.
 *
 * @param personas - all personas for the user sorted by createdAt ASC.
 * @param planLimit - the user's current avatar limit.
 */
export function computePersonaPlanEnabled(
  personas: Array<{ id: number }>,
  planLimit: number,
): Map<number, boolean> {
  const map = new Map<number, boolean>();
  personas.forEach((p, idx) => {
    map.set(p.id, idx < planLimit);
  });
  return map;
}

/**
 * Error thrown when a WaveSpeed persona is blocked because the user's current plan
 * does not allow that many avatars (e.g. downgraded from Pro → Basic).
 * Callers can catch this specifically to surface a user-friendly message without
 * crashing the automation cycle.
 */
export class PlanBlockedError extends Error {
  readonly code = "PERSONA_PLAN_BLOCKED" as const;
  constructor(message = "Este Avatar AI no está disponible con tu plan actual.") {
    super(message);
    this.name = "PlanBlockedError";
  }
}

// ── Voice clone counting ───────────────────────────────────────────────────────
//
// The free-voice rule is GLOBAL across all providers: the user gets exactly ONE
// free voice clone total (WaveSpeed + HeyGen combined).  Subsequent clones from
// either provider cost EXTRA_VOICE_CREDIT_COST credits each.
// Failed clones never count — the user can retry for free.

/**
 * Count non-failed WaveSpeed voice clones only.
 * Kept for internal use; prefer countNonFailedVoiceClones for credit-gate logic.
 */
export async function countNonFailedWsVoices(userId: number): Promise<number> {
  const [row] = await db
    .select({ cnt: drizzleCount() })
    .from(wavespeedVoicesTable)
    .where(
      and(
        eq(wavespeedVoicesTable.userId, userId),
        ne(wavespeedVoicesTable.status, "failed"),
      ),
    );
  return Number(row?.cnt ?? 0);
}

/**
 * Count ALL non-failed voice clones for the user across BOTH WaveSpeed and HeyGen.
 * This is the authoritative counter for the "first voice free" credit rule.
 *
 *   total = 0  → next clone is FREE
 *   total ≥ 1  → next clone costs EXTRA_VOICE_CREDIT_COST credits
 *
 * A failed clone never counts: if the user's only clone attempt failed they keep
 * their free slot.
 */
export async function countNonFailedVoiceClones(userId: number): Promise<number> {
  const [wsRow] = await db
    .select({ cnt: drizzleCount() })
    .from(wavespeedVoicesTable)
    .where(and(eq(wavespeedVoicesTable.userId, userId), ne(wavespeedVoicesTable.status, "failed")));

  const [hgRow] = await db
    .select({ cnt: drizzleCount() })
    .from(heygenClonedVoicesTable)
    .where(and(eq(heygenClonedVoicesTable.userId, userId), ne(heygenClonedVoicesTable.status, "failed")));

  return Number(wsRow?.cnt ?? 0) + Number(hgRow?.cnt ?? 0);
}
