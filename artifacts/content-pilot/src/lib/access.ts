/**
 * Central access control — single source of truth for feature permissions.
 * No permission logic should be duplicated across pages/components.
 *
 * Usage:
 *   const state = useAccessState()           // hook
 *   if (!canUseFeature(state, "autopilot")) showModal()
 */

/** Five mutually-exclusive access states for every authenticated user. */
export type AccessState =
  | "admin"           // role=admin, all features
  | "active_basic"    // active/trialing Basic subscription
  | "active_pro"      // active/trialing Pro subscription
  | "active_founder"  // active/trialing Founder subscription
  | "no_active_plan"  // no sub, cancelled, expired, or loading

/**
 * Every feature that requires a plan or specific plan tier.
 * autopilot requires Pro or Founder; all others require any active plan.
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
 * Returns true when a user in `state` may use `feature`.
 *
 * Rule summary:
 *   admin          → all features
 *   no_active_plan → no features
 *   active_basic   → all features EXCEPT autopilot
 *   active_pro     → all features
 *   active_founder → all features
 */
export function canUseFeature(state: AccessState, feature: Feature): boolean {
  if (state === "admin") return true
  if (state === "no_active_plan") return false
  if (feature === "autopilot") return state === "active_pro" || state === "active_founder"
  return true
}

/** True when the user has any active paid plan (or is admin). */
export function hasActivePlan(state: AccessState): boolean {
  return state !== "no_active_plan"
}
