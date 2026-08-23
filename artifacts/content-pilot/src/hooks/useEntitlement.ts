/**
 * Shared hook for current user entitlement/access status.
 * Backed by GET /api/auth/entitlement with 5-minute stale time.
 * Used by Layout (banner), AccessStatus (settings card), AccessGuard (route protection).
 */

import { useQuery } from "@tanstack/react-query"

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")

export const ENTITLEMENT_QUERY_KEY = ["auth", "entitlement"] as const

export interface EntitlementData {
  isAdmin:           boolean
  courseAccess:      boolean
  toolAccessStatus:  "active" | "trialing" | "expired" | "disabled"
  toolAccessActive:  boolean
  toolAccessEndsAt:  string | null // ISO
  daysRemaining:     number | null
  source:            string | null
}

export function useEntitlement() {
  return useQuery<EntitlementData>({
    queryKey: ENTITLEMENT_QUERY_KEY,
    queryFn:  async () => {
      const res = await fetch(`${BASE}/api/auth/entitlement`, { credentials: "include" })
      if (!res.ok) {
        // Propagate HTTP status so the global 401 handler in App.tsx can redirect
        // unauthenticated / expired-session calls to /login instead of showing a
        // blank screen.
        const err: any = new Error("Error al cargar licencia")
        err.status = res.status
        throw err
      }
      return res.json()
    },
    staleTime: 1000 * 60 * 5, // 5 min — React Query deduplicates across components
    retry:     false,          // don't retry on 401 (unauthenticated = normal)
  })
}
