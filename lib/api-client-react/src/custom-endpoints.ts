/**
 * Custom hooks for endpoints not covered by Orval codegen.
 * These are hand-written and can be imported from @workspace/api-client-react.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  authenticated: boolean;
}

/** Check whether the current session is authenticated. */
export function useAuthStatus() {
  return useQuery<AuthStatus>({
    queryKey: ["auth", "me"],
    queryFn: () => customFetch<AuthStatus>("/api/auth/me"),
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 min
  });
}

/** Login with password. */
export function useLogin() {
  return useMutation({
    mutationFn: ({ password }: { password: string }) =>
      customFetch<{ ok: boolean }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
        headers: { "Content-Type": "application/json" },
      }),
  });
}

/** Logout. */
export function useLogout() {
  return useMutation({
    mutationFn: () =>
      customFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  });
}

// ── Video retry ───────────────────────────────────────────────────────────────

export interface RetryVideoResult {
  success: boolean;
}

/**
 * Retry a failed video: deletes the failed video row and resets the linked
 * content plan item back to 'scripted' so it can be regenerated.
 */
export function useRetryVideo() {
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      customFetch<RetryVideoResult>(`/api/videos/${id}/retry`, {
        method: "POST",
      }),
  });
}
