/**
 * useAccessState — derives the current user's AccessState from auth + billing.
 *
 * Returns "no_active_plan" while loading (safe gate default: UI shows locked
 * state but doesn't error; once data resolves, gates open or close correctly).
 */

import { useAuthStatus, useBilling } from "@workspace/api-client-react"
import type { AccessState } from "@/lib/access"

export function useAccessState(): AccessState {
  const { data: auth }    = useAuthStatus()
  const { data: billing } = useBilling()

  if (auth?.user?.role === "admin") return "admin"

  const sub = billing?.subscription
  if (!sub || !["active", "trialing"].includes(sub.status ?? "")) return "no_active_plan"

  if (sub.planSlug === "basic")   return "active_basic"
  if (sub.planSlug === "pro")     return "active_pro"
  if (sub.planSlug === "founder") return "active_founder"

  return "no_active_plan"
}
