/**
 * Server-side feature access control.
 * Mirrors artifacts/content-pilot/src/lib/access.ts — keep in sync.
 *
 * UI checks are advisory; this file is the authoritative backend check.
 * All cost-generating or data-modifying operations must call canUseFeature()
 * before executing, even when protected by requireToolAccess globally.
 */

export type PlanSlug = "basic" | "pro" | "founder" | null

/**
 * Features that require backend enforcement (cost or data-generating ops).
 */
export type Feature =
  | "strategic_analysis"
  | "content_plan"
  | "generate_reel"
  | "use_public_avatar"
  | "create_avatar"
  | "create_look"
  | "clone_voice"
  | "caption_studio"
  | "broll"
  | "publish"
  | "schedule"
  | "autopilot"
  | "buy_topup"

/**
 * Returns true when a user with the given active plan slug may use the feature.
 * Pass null for planSlug when the user has no active subscription.
 *
 * Rule summary:
 *   null (no plan)     → no feature
 *   basic              → all features EXCEPT autopilot
 *   pro / founder      → all features
 */
export function canUseFeature(planSlug: PlanSlug, feature: Feature): boolean {
  if (!planSlug) return false
  if (feature === "autopilot") return planSlug === "pro" || planSlug === "founder"
  return true
}

/** Semantic error codes used in API responses for commercial gate violations. */
export const ACCESS_ERRORS = {
  PLAN_REQUIRED:          "plan_required",
  FEATURE_NOT_AVAILABLE:  "feature_not_available",
  ACCOUNT_CONNECTION_REQUIRED: "account_connection_required",
} as const
