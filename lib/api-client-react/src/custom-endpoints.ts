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

export interface HeyGenQuotaDetails {
  api: number | null;
  generative_credit: number | null;
  plan_credit: number | null;
  instant_avatars: number | null;
}

export interface HeyGenAccountStatus {
  connected: boolean;
  remaining_quota: number | null;
  total_quota: number | null;
  details: HeyGenQuotaDetails | null;
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

// ── Caption rotation ──────────────────────────────────────────────────────────

export interface CaptionBrowserTemplate {
  id: string;
  name: string;
  description: string;
  primary_color: string;
  active_word_color: string;
  background_color: string | null;
  animation: string;
  font_family: string;
}

export function useGetCaptionBrowserTemplates() {
  return useQuery<CaptionBrowserTemplate[]>({
    queryKey: ["caption-browser-templates"],
    queryFn: () => customFetch<CaptionBrowserTemplate[]>("/api/captions/browser-templates"),
    staleTime: 1000 * 60 * 60, // 1 h — templates are static
  });
}

// ── HeyGen ───────────────────────────────────────────────────────────────────

/** Remove the user-stored HeyGen API key (falls back to env var if set). */
export function useDisconnectHeyGen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => customFetch<{ ok: boolean }>("/api/heygen/account", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HEYGEN_ACCOUNT_QUERY_KEY }),
  });
}

// ── Viral Editorial Engine ────────────────────────────────────────────────────

export type RegenerateCriterion = "educational" | "controversial" | "storytelling" | "sales" | "emotional";

export interface RegenerateScriptResult {
  success: boolean;
  criterion: RegenerateCriterion;
}

/** Regenerate the script for a content item with a specific editorial criterion emphasis. */
export function useRegenerateScript() {
  return useMutation({
    mutationFn: ({ id, criterion }: { id: number; criterion: RegenerateCriterion }) =>
      customFetch<RegenerateScriptResult>(`/api/content/${id}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ criterion }),
        headers: { "Content-Type": "application/json" },
      }),
  });
}

// ── Strategic Audit ───────────────────────────────────────────────────────────

import type {
  StrategyProfile,
  NicheRadarAccount,
  RadarSuggestion,
  RadarStatus,
} from "./generated/api.schemas";

export type { StrategyProfile, NicheRadarAccount, RadarSuggestion, RadarStatus };

const STRATEGY_PROFILE_KEY  = ["strategy", "profile"] as const;
const RADAR_ACCOUNTS_KEY    = ["strategy", "radar"]   as const;
const RADAR_STATUS_KEY      = ["strategy", "radar", "status"] as const;
const RADAR_SUGGESTIONS_KEY = ["strategy", "radar", "suggestions"] as const;

/** Current strategy profile (null if not yet built). */
export function useGetStrategyProfile() {
  return useQuery<{ profile: StrategyProfile | null }>({
    queryKey: STRATEGY_PROFILE_KEY,
    queryFn:  () => customFetch<{ profile: StrategyProfile | null }>("/api/strategy/profile"),
    staleTime: 1000 * 60 * 5,
  });
}

/** Run the Instagram account audit and save account_data to the strategy profile. */
export function useRunAccountAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ profile: StrategyProfile }>("/api/strategy/account", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: STRATEGY_PROFILE_KEY }),
  });
}

/** Whether the Apify radar is connected (APIFY_TOKEN env var set). */
export function useGetRadarStatus() {
  return useQuery<RadarStatus>({
    queryKey: RADAR_STATUS_KEY,
    queryFn:  () => customFetch<RadarStatus>("/api/strategy/radar/status"),
    staleTime: Infinity,
  });
}

/** AI-suggested accounts for the user's niche. */
export function useGetRadarSuggestions() {
  return useQuery<{ suggestions: RadarSuggestion[] }>({
    queryKey: RADAR_SUGGESTIONS_KEY,
    queryFn:  () => customFetch<{ suggestions: RadarSuggestion[] }>("/api/strategy/radar/suggestions"),
    staleTime: 1000 * 60 * 30,
  });
}

/** List saved niche radar accounts. */
export function useGetRadarAccounts() {
  return useQuery<{ accounts: NicheRadarAccount[] }>({
    queryKey: RADAR_ACCOUNTS_KEY,
    queryFn:  () => customFetch<{ accounts: NicheRadarAccount[] }>("/api/strategy/radar"),
    staleTime: 1000 * 30,
  });
}

/** Add an account to the niche radar. */
export function useAddRadarAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { ig_username: string; bio?: string; followers?: number; relevance_score?: number; source?: string }) =>
      customFetch<{ account: NicheRadarAccount }>("/api/strategy/radar", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: RADAR_ACCOUNTS_KEY }),
  });
}

/** Update use_as_reference / relevance_score for a radar account. */
export function useUpdateRadarAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; use_as_reference?: boolean; relevance_score?: number; bio?: string; followers?: number }) =>
      customFetch<{ account: NicheRadarAccount }>(`/api/strategy/radar/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: RADAR_ACCOUNTS_KEY }),
  });
}

/** Remove an account from the niche radar. */
export function useDeleteRadarAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<{ success: boolean }>(`/api/strategy/radar/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: RADAR_ACCOUNTS_KEY }),
  });
}

/** Synthesize market insights from account data + radar. */
export function useRunMarketStudy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ profile: StrategyProfile }>("/api/strategy/market", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: STRATEGY_PROFILE_KEY }),
  });
}

/** Generate the content strategy from market insights. */
export function useRunContentStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ profile: StrategyProfile }>("/api/strategy/strategy", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: STRATEGY_PROFILE_KEY }),
  });
}
