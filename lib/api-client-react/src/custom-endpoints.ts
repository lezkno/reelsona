/**
 * Custom hooks for endpoints not covered by Orval codegen.
 * These are hand-written and can be imported from @workspace/api-client-react.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Constants ─────────────────────────────────────────────────────────────────

import type { VideoEffects } from "./generated/api.schemas";

/** Default video effects configuration (all effects disabled). */
export const DEFAULT_VIDEO_EFFECTS: VideoEffects = {
  zoom: false,
  ai_broll: false,
  text_cards: false,
};

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  username: string;
  role: string;
  userId: number;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: AuthUser;
}

/** Update the current user's profile (name, email, phone, avatarUrl). */
export function useUpdateProfile() {
  return useMutation({
    mutationFn: (data: { fullName?: string; email?: string; phone?: string; avatarUrl?: string }) =>
      customFetch<{ ok: boolean }>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
  });
}

/** Change the current user's password. */
export function useChangePassword() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      customFetch<{ ok: boolean }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
        headers: { "Content-Type": "application/json" },
      }),
  });
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

// ── Reschedule overdue content items ─────────────────────────────────────────

export interface RescheduleOverdueResult {
  rescheduled: number;
}

export function useRescheduleOverdue() {
  return useMutation({
    mutationFn: () =>
      customFetch<RescheduleOverdueResult>("/api/content/plan/reschedule-overdue", {
        method: "POST",
      }),
  });
}

// ── Video retry ───────────────────────────────────────────────────────────────

export interface RetryVideoResult {
  success: boolean;
}

export function useDeleteVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      customFetch<{ ok: boolean }>(`/api/videos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
  });
}

export function useRetryVideo() {
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      customFetch<RetryVideoResult>(`/api/videos/${id}/retry`, {
        method: "POST",
      }),
  });
}

export function useReapplyCaptions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) =>
      customFetch<{ success: boolean; message: string }>(`/api/videos/${id}/reapply-captions`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
    },
  });
}

// ── Admin student provisioning ────────────────────────────────────────────────

export interface AdminEntitlement {
  userId:           number;
  username:         string;
  fullName:         string | null;
  isActive:         boolean;
  courseAccess:     boolean;
  toolAccessStatus: string;
  toolAccessEndsAt: string | null;
  source:           string | null;
  createdAt:        string;
}

export interface ProvisionStudentInput {
  email:          string;
  fullName:       string;
  toolAccessDays: number;
  courseAccess?:  boolean;
  source?:        string;
}

export interface ProvisionResult {
  ok:        boolean;
  userId:    number;
  created:   boolean;
  emailSent: boolean;
  warning?:  string;
}

export const ADMIN_ENTITLEMENTS_KEY = ["admin", "entitlements"] as const;

/** List all student entitlements. */
export function useAdminEntitlements() {
  return useQuery<{ entitlements: AdminEntitlement[] }>({
    queryKey: ADMIN_ENTITLEMENTS_KEY,
    queryFn:  () => customFetch<{ entitlements: AdminEntitlement[] }>("/api/admin/entitlements"),
    staleTime: 1000 * 30,
  });
}

/** Provision (create or update) a student with tool access. */
export function useProvisionStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ProvisionStudentInput) =>
      customFetch<ProvisionResult>("/api/admin/provision", {
        method:  "POST",
        body:    JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_ENTITLEMENTS_KEY }),
  });
}

/** Resend the activation email for a student (refreshes the token). */
export function useResendActivation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email }: { email: string }) =>
      customFetch<{ ok: boolean; emailSent: boolean; warning?: string }>("/api/admin/resend-activation", {
        method:  "POST",
        body:    JSON.stringify({ email }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_ENTITLEMENTS_KEY }),
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
// These types are not in the OpenAPI spec (strategy routes use custom fetchers).
// They are defined here alongside the hooks that use them.

interface AccountDataTopPost {
  id: string; thumbnail_url: string | null; caption: string | null;
  like_count: number; comments_count: number; plays: number | null;
  engagement_rate: number | null; permalink: string | null;
}
interface AccountData {
  avg_engagement: number; avg_reach: number; best_posting_times: string[];
  top_posts: AccountDataTopPost[]; top_captions: string[];
  follower_count: number; media_count: number; fetched_at: string;
}
interface MarketInsights {
  top_themes: string[]; working_formats: string[]; audience_pains: string[];
  content_gaps: string[]; saturated_topics: string[]; opportunities: string[];
  shareable_hooks: string[]; analyzed_at: string;
}
interface ContentStrategyPillar {
  name: string; objective: string; frequency_pct: number; example_topics: string[];
}
interface ContentStrategy {
  pillars: ContentStrategyPillar[];
  editorial_angles: string[];
  format_mix: { educational: number; emotional: number; sales: number; controversial: number; storytelling: number };
  unique_value_prop: string; hook_types: string[]; recommended_ctas: string[];
  posting_frequency: string; generated_at: string;
}

export interface StrategyProfile {
  id: number;
  account_data: AccountData | null;
  market_insights: MarketInsights | null;
  content_strategy: ContentStrategy | null;
  steps_completed: string[];
  created_at: string;
  updated_at: string;
}

export interface NicheRadarAccount {
  id: number;
  ig_username: string;
  profile_url: string | null;
  bio: string | null;
  followers: number | null;
  relevance_score: number | null;
  use_as_reference: boolean;
  source: string;
  top_posts_json: unknown | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface RadarSuggestion {
  ig_username: string;
  reason: string;
  approximate_followers: string;
  content_type: string;
}

export interface RadarStatus {
  apify_available: boolean;
}

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
/** Re-score all draft content plan items against the current strategy profile. */
export function useReanalyzeContentPlan() {
  const qc = useQueryClient();
  return useMutation<{ updated: number }, Error>({
    mutationFn: () => customFetch<{ updated: number }>("/api/content/plan/reanalyze", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content", "plan"] }),
  });
}

export function useRunContentStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ profile: StrategyProfile }>("/api/strategy/strategy", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: STRATEGY_PROFILE_KEY }),
  });
}

// ── Course progress ───────────────────────────────────────────────────────────

const COURSE_PROGRESS_KEY = ["course", "progress"] as const;

export function useGetCourseProgress() {
  return useQuery<{ completedLessons: string[] }>({
    queryKey: COURSE_PROGRESS_KEY,
    queryFn: () => customFetch<{ completedLessons: string[] }>("/api/course/progress"),
  });
}

export function useMarkLessonComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) =>
      customFetch<{ ok: boolean }>("/api/course/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: COURSE_PROGRESS_KEY }),
  });
}

// ── Checkout ──────────────────────────────────────────────────────────────────

export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: (data: { email: string; fullName?: string }) =>
      customFetch<{ url: string }>("/api/checkout/create-session", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      }),
  });
}

export function useUnmarkLessonComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) =>
      customFetch<{ ok: boolean }>(`/api/course/progress/${encodeURIComponent(lessonId)}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: COURSE_PROGRESS_KEY }),
  });
}
