/**
 * Custom hooks for endpoints not covered by Orval codegen.
 * These are hand-written and can be imported from @workspace/api-client-react.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  username: string;
  role: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: AuthUser;
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

/** Login with username + password. */
export function useLogin() {
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      customFetch<{ ok: boolean }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
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

// ── Admin users ───────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

/** List all admin users. */
export function useAdminUsers() {
  return useQuery<AdminUser[]>({
    queryKey: ["admin", "users"],
    queryFn: () => customFetch<AdminUser[]>("/api/users"),
    staleTime: 1000 * 30,
  });
}

/** Create a new admin user. */
export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { username: string; password: string; role?: string }) =>
      customFetch<AdminUser>("/api/users", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

/** Delete an admin user by id. */
export function useDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      customFetch<{ ok: boolean }>(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}
