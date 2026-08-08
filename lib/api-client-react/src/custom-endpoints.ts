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
    staleTime: 1000 * 60 * 5,
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
  fullName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  notes: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAdminUserInput {
  fullName?: string;
  email?: string;
  phone?: string;
  role?: string;
  isActive?: boolean;
  notes?: string;
  password?: string;
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
    mutationFn: (data: {
      username: string;
      password: string;
      fullName?: string;
      email?: string;
      phone?: string;
      role?: string;
      notes?: string;
    }) =>
      customFetch<AdminUser>("/api/users", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

/** Update an admin user's fields. */
export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number } & UpdateAdminUserInput) =>
      customFetch<AdminUser>(`/api/users/${id}`, {
        method: "PATCH",
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

// ── HeyGen account integration ────────────────────────────────────────────────

export interface HeyGenAccountStatus {
  connected: boolean;
  remaining_quota: number | null;
  total_quota: number | null;
  /** Where the key came from: "db" = user-stored, "env" = server env var, "none" = not set */
  key_source: "db" | "env" | "none";
  error?: string;
}

export const HEYGEN_ACCOUNT_QUERY_KEY = ["heygen", "account"] as const;

/** Fetch HeyGen connection status and remaining API credits. */
export function useHeyGenAccount() {
  return useQuery<HeyGenAccountStatus>({
    queryKey: HEYGEN_ACCOUNT_QUERY_KEY,
    queryFn: () => customFetch<HeyGenAccountStatus>("/api/heygen/account"),
    staleTime: 1000 * 60 * 2,   // 2 minutes — quota changes slowly
    retry: false,
  });
}

/** Save a HeyGen API key (validates before saving). */
export function useConnectHeyGen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ api_key }: { api_key: string }) =>
      customFetch<HeyGenAccountStatus>("/api/heygen/account/connect", {
        method: "POST",
        body: JSON.stringify({ api_key }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HEYGEN_ACCOUNT_QUERY_KEY }),
  });
}

/** Remove the user-stored HeyGen API key (falls back to env var if set). */
export function useDisconnectHeyGen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => customFetch<{ ok: boolean }>("/api/heygen/account", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HEYGEN_ACCOUNT_QUERY_KEY }),
  });
}
