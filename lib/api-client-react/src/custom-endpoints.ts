/**
 * Custom hooks for endpoints not covered by Orval codegen.
 * These are hand-written and can be imported from @workspace/api-client-react.
 */
import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
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

/** Logout. Clears the entire React Query cache so no user's data leaks to the next session. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => qc.clear(),
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

// ── Credit wallet ─────────────────────────────────────────────────────────────

export interface CreditsBalance {
  availableCredits:    number | null;  // null for admin (unlimited)
  subscriptionCredits: number | null;
  purchasedCredits:    number | null;
  reservedCredits:     number;
  totalConsumed:       number;
  isAdmin:             boolean;
  costTable:           { reelPer30s: number };
}

export const CREDITS_BALANCE_KEY = ["credits", "balance"] as const;

/** Authenticated user's credit wallet. Accessible even when tool access is expired. */
export function useCreditsBalance() {
  return useQuery<CreditsBalance>({
    queryKey: CREDITS_BALANCE_KEY,
    queryFn:  () => customFetch<CreditsBalance>("/api/credits/balance"),
    staleTime: 1000 * 30,
  });
}

export interface AdminCreditsWallet {
  userId:           number;
  username:         string;
  fullName:         string | null;
  availableCredits: number;
  reservedCredits:  number;
  totalConsumed:    number;
  updatedAt:        string | null;
}

export const ADMIN_CREDITS_KEY = ["admin", "credits"] as const;

/** All user wallet states — for the admin credits panel. */
export function useAdminCredits() {
  return useQuery<{ wallets: AdminCreditsWallet[] }>({
    queryKey: ADMIN_CREDITS_KEY,
    queryFn:  () => customFetch<{ wallets: AdminCreditsWallet[] }>("/api/admin/credits"),
    staleTime: 1000 * 30,
  });
}

// ── Billing / subscription ────────────────────────────────────────────────────

export interface BillingPlan {
  slug:        string;
  amountCents: number;
  currency:    string;
  interval:    string | null;
  credits:     number;
  priceId:     string;
}

export interface BillingTopup {
  slug:        string;
  amountCents: number;
  currency:    string;
  credits:     number;
  priceId:     string;
}

export interface BillingData {
  subscription: {
    planSlug:             string;
    status:               string;
    currentPeriodStart:   string | null;
    currentPeriodEnd:     string | null;
    cancelAtPeriodEnd:    boolean;
    /**
     * When set, a downgrade to this plan is scheduled for the next renewal cycle.
     * The user keeps their current plan until currentPeriodEnd.
     */
    pendingPlanSlug:         string | null;
    founderMonthsGranted?:   number;
    founderMonthsRemaining?: number;
    /** ISO date of the next Founder credit grant, or null if already at max 12. */
    nextFounderGrantAt?:     string | null;
  } | null;
  credits: {
    available:     number;
    subscription:  number;
    purchased:     number;
    reserved:      number;
    totalConsumed: number;
  };
  plans:            BillingPlan[];
  topups:           BillingTopup[];
  founderSeatsLeft: number | null;
  planCreditsTable: Record<string, number>;
}

export const BILLING_QUERY_KEY = ["billing"] as const;

/** Full billing snapshot: subscription, credits, available plans & topup packs. */
export function useBilling() {
  return useQuery<BillingData>({
    queryKey: BILLING_QUERY_KEY,
    queryFn:  () => customFetch<BillingData>("/api/billing"),
    staleTime: 1000 * 60 * 5,
  });
}

export interface ChangePlanResult {
  success:     boolean;
  type:        "upgrade" | "downgrade";
  plan:        string;
  scheduled?:  boolean;
  effectiveDate?: string | null;
}

/** Upgrade (Basic→Pro immediate) or downgrade (Pro→Basic scheduled) for users with an active subscription. */
export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetPlan: "basic" | "pro") =>
      customFetch<ChangePlanResult>("/api/billing/change-plan", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ targetPlan }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
    },
  });
}

/** Opens a Stripe Billing Portal session for self-service plan/payment management. */
export function useOpenPortal() {
  return useMutation({
    mutationFn: () =>
      customFetch<{ url: string }>("/api/billing/portal", { method: "POST" }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
}

/** Cancel a pending Pro→Basic scheduled downgrade (releases the Stripe Subscription Schedule). */
export function useCancelPlanChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ success: boolean }>("/api/billing/cancel-plan-change", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
    },
  });
}

// ── Invoice history ───────────────────────────────────────────────────────────

export interface InvoiceItem {
  id:          string;
  /** Unix timestamp in seconds (as returned by Stripe). */
  date:        number;
  description: string;
  amountCents: number;
  currency:    string;
  /** 'paid' | 'open' | 'void' | 'uncollectible' */
  status:      string;
  receiptUrl:  string | null;
}

export const INVOICES_QUERY_KEY = ["billing", "invoices"] as const;

/** Fetch Stripe payment history for the authenticated user. Empty array when no Stripe customer. */
export function useInvoices() {
  return useQuery<{ invoices: InvoiceItem[] }>({
    queryKey: INVOICES_QUERY_KEY,
    queryFn:  () => customFetch<{ invoices: InvoiceItem[] }>("/api/billing/invoices"),
    staleTime: 1000 * 60 * 5,
  });
}

/** Cancel the active subscription at period end (cancel_at_period_end). Does NOT cancel immediately. */
export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      customFetch<{ success: boolean; cancelAt: string | null }>("/api/billing/cancel-subscription", {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
    },
  });
}

/** Admin: assign (or remove) a subscription plan for any user without payment. Provisions plan credits immediately. */
export function useAdminSetUserPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, planSlug }: { userId: number; planSlug: string }) =>
      customFetch<{ ok: boolean; planSlug: string; creditsGranted: number }>(
        `/api/admin/users/${userId}/set-plan`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ planSlug }),
        }
      ),
    onSuccess: () => {
      // Refresh entitlements so the admin can see the updated tool-access status
      qc.invalidateQueries({ queryKey: ["admin", "entitlements"] });
    },
  });
}

/** Manually adjust a user's credit balance (admin only). */
export function useAdjustUserCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, amount, reason }: { userId: number; amount: number; reason?: string }) =>
      customFetch<{ ok: boolean }>(`/api/admin/credits/${userId}/adjust`, {
        method:  "POST",
        body:    JSON.stringify({ amount, reason }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_CREDITS_KEY });
      qc.invalidateQueries({ queryKey: CREDITS_BALANCE_KEY });
      qc.invalidateQueries({ queryKey: ADMIN_ENTITLEMENTS_KEY });
    },
  });
}

/** Toggle the suspended state of any user account. */
export function useToggleSuspendUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId }: { userId: number }) =>
      customFetch<{ ok: boolean; isSuspended: boolean }>(
        `/api/admin/users/${userId}/toggle-suspend`,
        { method: "POST" },
      ),
    onSuccess: (_data, { userId }) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ADMIN_ENTITLEMENTS_KEY });
      qc.removeQueries({ queryKey: ["admin", "user-detail", userId] });
    },
  });
}

/** Admin sets a new password for any user directly. */
export function useAdminSetPassword() {
  return useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) =>
      customFetch<{ ok: boolean }>(`/api/admin/users/${userId}/set-password`, {
        method:  "POST",
        body:    JSON.stringify({ password }),
        headers: { "Content-Type": "application/json" },
      }),
  });
}

/** Admin triggers a password-reset email for any user. */
export function useAdminSendResetEmail() {
  return useMutation({
    mutationFn: ({ userId }: { userId: number }) =>
      customFetch<{ ok: boolean; email: string }>(
        `/api/admin/users/${userId}/send-reset-email`,
        { method: "POST" },
      ),
  });
}

// ── Admin student provisioning ────────────────────────────────────────────────

export interface AdminEntitlement {
  userId:                   number;
  username:                 string;
  fullName:                 string | null;
  isActive:                 boolean;
  isSuspended:              boolean;
  courseAccess:             boolean;
  toolAccessStatus:         string;
  toolAccessEndsAt:         string | null;
  source:                   string | null;
  createdAt:                string;
  /** Expiry date of the pending activation link — present when user hasn't activated yet. */
  activationTokenExpiresAt: string | null;
  /** Credit wallet fields — null if the user has no wallet yet. */
  availableCredits:         number | null;
  reservedCredits:          number | null;
  totalConsumed:            number | null;
}

export interface ProvisionStudentInput {
  email:          string;
  fullName:       string;
  toolAccessDays: number;
  courseAccess?:  boolean;
  source?:        string;
  planSlug?:      string;
}

export interface ProvisionResult {
  ok:             boolean;
  userId:         number;
  created:        boolean;
  emailSent:      boolean;
  warning?:       string;
  creditsGranted?: number;
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

/** Update tool-access days for an existing student entitlement. */
export function useUpdateEntitlementDays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, toolAccessDays }: { userId: number; toolAccessDays: number }) =>
      customFetch<{ ok: boolean }>(`/api/admin/entitlements/${userId}/access-days`, {
        method:  "PATCH",
        body:    JSON.stringify({ toolAccessDays }),
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
  isSuspended: boolean;
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
    onSuccess: (_data, { id }) => {
      // Invalidate both tables — the hook is used for both admin-role and student users
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "entitlements"] });
      qc.removeQueries({ queryKey: ["admin", "user-detail", id] });
    },
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
  /** Where the key came from: "user" = own stored key, "platform" = Reelsona's centralized key, "none" = not set */
  key_source: "user" | "platform" | "none";
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

// ── Avatar v3 ─────────────────────────────────────────────────────────────────

export interface V3AvatarGroup {
  id: string;
  name: string;
  gender: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  looks_count: number;
  status: string | null;
  created_at: number | null;
}

export interface V3AvatarGroupsResponse {
  groups: V3AvatarGroup[];
  has_more: boolean;
  next_token: string | null;
}

export interface V3Look {
  id: string;
  name: string;
  avatar_type: string;
  group_id: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  status: string | null;
  supported_api_engines: string[];
  is_talking_photo: boolean;
}

export interface V3GroupLooksResponse {
  looks: V3Look[];
  has_more: boolean;
  next_token: string | null;
}

export interface AvatarLookStatus {
  id: string;
  name: string;
  status: "processing" | "pending_consent" | "completed" | "failed" | null;
  avatar_type: string | null;
  group_id: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
}

/** User's own private avatar groups (v3). */
export function useMyHeyGenAvatarGroups(token?: string) {
  return useQuery<V3AvatarGroupsResponse>({
    queryKey: ["heygen", "my-avatar-groups", token],
    queryFn: () =>
      customFetch<V3AvatarGroupsResponse>(
        `/api/heygen/my-avatar-groups${token ? `?token=${encodeURIComponent(token)}` : ""}`,
      ),
    staleTime: 1000 * 60 * 2,
  });
}

/** HeyGen public stock avatar groups (v3, infinite scroll). */
export function usePublicHeyGenAvatarGroups() {
  return useInfiniteQuery<V3AvatarGroupsResponse, Error>({
    queryKey: ["heygen", "public-avatar-groups"],
    queryFn: ({ pageParam }) =>
      customFetch<V3AvatarGroupsResponse>(
        `/api/heygen/public-avatar-groups${pageParam ? `?token=${encodeURIComponent(pageParam as string)}` : ""}`,
      ),
    getNextPageParam: (lastPage) => lastPage.next_token ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 1000 * 60 * 5,
  });
}

/** Looks for a specific group via v3 API. */
export function useGetV3GroupLooks(groupId: string | null) {
  return useQuery<V3GroupLooksResponse>({
    queryKey: ["heygen", "v3-group-looks", groupId],
    queryFn: () =>
      customFetch<V3GroupLooksResponse>(`/api/heygen/v3-groups/${encodeURIComponent(groupId!)}/looks`),
    enabled: !!groupId,
    staleTime: 1000 * 60 * 5,
  });
}

/** Upload a file to HeyGen /v3/assets. Expects FormData with a "file" field. */
export function useUploadHeyGenAsset() {
  return useMutation<{ asset_id: string; url: string }, Error, FormData>({
    mutationFn: (formData) =>
      customFetch<{ asset_id: string; url: string }>("/api/heygen/assets", {
        method: "POST",
        body: formData,
        // No Content-Type header — browser sets it with boundary for multipart
      }),
  });
}

/** Create a photo avatar from an uploaded asset. */
export function useCreatePhotoAvatar() {
  return useMutation<{ look_id: string; group_id: string }, Error, { name: string; asset_id: string }>({
    mutationFn: (data) =>
      customFetch<{ look_id: string; group_id: string }>("/api/heygen/avatars/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  });
}

/**
 * Create a Digital Twin avatar from a video file in one request.
 * Send FormData with fields: file (video MP4/MOV/WebM), name (string).
 * Returns { look_id, group_id } — poll useHeyGenLookStatus() until completed.
 * HeyGen typically takes 10–20 min to process a Digital Twin.
 */
export function useCreateDigitalTwinAvatar() {
  return useMutation<{ look_id: string; group_id: string }, Error, FormData>({
    mutationFn: (formData) =>
      customFetch<{ look_id: string; group_id: string }>("/api/heygen/avatars/create-digital-twin", {
        method: "POST",
        body: formData,
        // No Content-Type — browser sets multipart/form-data with boundary automatically
      }),
  });
}

/** Delete a single avatar look (photo_avatar / digital_twin only). */
export function useDeleteAvatarLook() {
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (lookId) =>
      customFetch<{ ok: boolean }>(`/api/heygen/avatars/looks/${encodeURIComponent(lookId)}`, {
        method: "DELETE",
      }),
  });
}

/** Permanently delete an avatar group and all its looks. */
export function useDeleteAvatarGroup() {
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (groupId) =>
      customFetch<{ ok: boolean }>(`/api/heygen/avatars/groups/${encodeURIComponent(groupId)}`, {
        method: "DELETE",
      }),
  });
}

/**
 * Create a new look for an existing avatar group, conditioned on a reference look.
 * Uses HeyGen's prompt pipeline with avatar_id + avatar_group_id.
 */
export function useCreateAvatarLook() {
  return useMutation<
    { look_id: string; group_id: string },
    Error,
    { ref_look_id: string; group_id: string; name: string; prompt: string; pose?: string }
  >({
    mutationFn: (data) =>
      customFetch<{ look_id: string; group_id: string }>(
        `/api/heygen/avatars/looks/${encodeURIComponent(data.ref_look_id)}/new-look`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: data.name, prompt: data.prompt, group_id: data.group_id, pose: data.pose }),
        },
      ),
  });
}

/** Create a prompt-based AI-generated avatar from a text description. */
export function useCreatePromptAvatar() {
  return useMutation<
    { look_id: string; group_id: string },
    Error,
    { name: string; prompt: string; orientation?: string; pose?: string }
  >({
    mutationFn: (data) =>
      customFetch<{ look_id: string; group_id: string }>("/api/heygen/avatars/create-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  });
}

/** Poll avatar look training status. Auto-refetches every 5 s while processing. */
export function useHeyGenLookStatus(lookId: string | null) {
  return useQuery<AvatarLookStatus>({
    queryKey: ["heygen", "look-status", lookId],
    queryFn: () =>
      customFetch<AvatarLookStatus>(
        `/api/heygen/avatars/looks/${encodeURIComponent(lookId!)}/status`,
      ),
    enabled: !!lookId,
    refetchInterval: (query) => {
      const s = (query.state.data as AvatarLookStatus | undefined)?.status;
      return s === "processing" || s === "pending_consent" || s == null ? 5000 : false;
    },
    staleTime: 0,
  });
}

// ── Voice management ──────────────────────────────────────────────────────────

/**
 * Clone a voice by uploading an audio file.
 * Accepts FormData with fields: audio (File), name (string).
 */
export function useCloneVoice() {
  return useMutation<{ voice_id: string; display_name: string; status: string }, Error, FormData>({
    mutationFn: (formData) =>
      customFetch<{ voice_id: string; display_name: string; status: string }>(
        "/api/heygen/voices/clone",
        { method: "POST", body: formData },
      ),
  });
}

/** Delete a cloned voice the current user owns. */
export function useDeleteVoice() {
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: (voiceId) =>
      customFetch<{ ok: boolean }>(
        `/api/heygen/voices/${encodeURIComponent(voiceId)}`,
        { method: "DELETE" },
      ),
  });
}

/** Rename a cloned voice the current user owns. */
export function useRenameVoice() {
  return useMutation<{ ok: boolean; display_name: string }, Error, { voiceId: string; name: string }>({
    mutationFn: ({ voiceId, name }) =>
      customFetch<{ ok: boolean; display_name: string }>(
        `/api/heygen/voices/${encodeURIComponent(voiceId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      ),
  });
}

/** Update a cloned voice (name, speed, and/or pitch). At least one field must be provided. */
export function useUpdateVoice() {
  return useMutation<{ ok: boolean }, Error, { voiceId: string; name?: string; speed?: number | null; pitch?: number | null }>({
    mutationFn: ({ voiceId, name, speed, pitch }) =>
      customFetch<{ ok: boolean }>(
        `/api/heygen/voices/${encodeURIComponent(voiceId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, speed, pitch }),
        },
      ),
  });
}

// ── WaveSpeed avatar pipeline ─────────────────────────────────────────────────

export interface WavespeedLookRow {
  id: number;
  userId: number;
  personaId: number | null;
  name: string;
  imageUrl: string | null;
  /** JSON string — {requestId, generationStatus, voiceId?, selected?} */
  config: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WavespeedPersonaWithLooks {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  referenceObjectPath: string | null;
  createdAt: string;
  updatedAt: string;
  looks: WavespeedLookRow[];
  /**
   * Whether this persona is enabled by the user's current plan.
   * Personas beyond the plan limit are false (blocked) after a downgrade.
   * Older personas (by createdAt) take priority; re-upgrading restores access.
   */
  planEnabled?: boolean;
}

export interface WavespeedVoiceRow {
  id: number;
  userId: number;
  personaId: number | null;
  displayName: string;
  wavespeedRequestId: string | null;
  wavespeedVoiceId: string | null;
  /** pending | ready | failed */
  status: string;
  errorMessage: string | null;
  /** GCS object name of the source WAV — present when the voice was recorded in-app */
  sourceAudioObjectName: string | null;
  /** Cached WaveSpeed CDN URL for a short TTS preview clip */
  previewAudioUrl: string | null;
  /** TTS speed multiplier passed to minimax. null = default (1.0). Range: 0.5–1.5 */
  speed: number | null;
  /** Voice pitch shift in semitones passed to minimax. null = default (0). Range: -12 to +12 */
  pitch: number | null;
  createdAt: string;
  updatedAt: string;
}

export const WAVESPEED_PERSONAS_KEY = ["wavespeed", "personas"] as const;

/** List the authenticated user's WaveSpeed personas with their looks, plus plan-limit metadata. */
export function useWavespeedPersonas() {
  return useQuery<{
    personas: WavespeedPersonaWithLooks[];
    /** Active plan slug (e.g. "basic", "pro", "founder") or null for no active plan. */
    planSlug: string | null;
    /** Maximum number of WaveSpeed personas allowed by the current plan. */
    planLimit: number;
  }>({
    queryKey: WAVESPEED_PERSONAS_KEY,
    queryFn: () =>
      customFetch<{
        personas: WavespeedPersonaWithLooks[];
        planSlug: string | null;
        planLimit: number;
      }>("/api/wavespeed/personas"),
    staleTime: 1000 * 60,
  });
}

/** Create a WaveSpeed persona + submit 5 look-generation jobs. */
export function useCreateWavespeedPersona() {
  const qc = useQueryClient();
  return useMutation<
    { persona: { id: number; name: string }; looks: WavespeedLookRow[] },
    Error,
    { name: string; referenceObjectPath: string }
  >({
    mutationFn: (data) =>
      customFetch<{ persona: { id: number; name: string }; looks: WavespeedLookRow[] }>(
        "/api/wavespeed/personas",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: WAVESPEED_PERSONAS_KEY }),
  });
}

/** Poll look generation status for a persona. Returns updated looks + allDone flag. */
export function useWavespeedPersonaLooksStatus(personaId: number | null, enabled = true) {
  return useQuery<{ looks: WavespeedLookRow[]; allDone: boolean }>({
    queryKey: ["wavespeed", "persona-looks-status", personaId],
    queryFn: () =>
      customFetch<{ looks: WavespeedLookRow[]; allDone: boolean }>(
        `/api/wavespeed/personas/${personaId}/looks/status`,
      ),
    enabled: !!personaId && enabled,
    refetchInterval: (query) => {
      const data = query.state.data as { allDone?: boolean } | undefined;
      return data?.allDone ? false : 4000;
    },
    staleTime: 0,
  });
}

/** Delete a WaveSpeed persona and all its looks. */
export function useDeleteWavespeedPersona() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, number>({
    mutationFn: (personaId) =>
      customFetch<{ ok: boolean }>(`/api/wavespeed/personas/${personaId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WAVESPEED_PERSONAS_KEY }),
  });
}

/** Upload audio and submit a WaveSpeed voice clone job. */
export function useCloneWavespeedVoice() {
  return useMutation<{ voiceId: number; displayName: string; status: string }, Error, FormData>({
    mutationFn: (formData) =>
      customFetch<{ voiceId: number; displayName: string; status: string }>(
        "/api/wavespeed/voices/clone",
        { method: "POST", body: formData },
      ),
  });
}

/** Fetch a fresh 1-hour signed URL for playing back the source audio of a cloned voice. */
export async function fetchVoicePlayUrl(voiceId: number): Promise<string> {
  const data = await customFetch<{ url: string }>(`/api/wavespeed/voices/${voiceId}/play-url`);
  return data.url;
}

/**
 * Get a playable audio URL for any ready WaveSpeed cloned voice.
 * Returns immediately if a preview is cached; otherwise waits while WaveSpeed
 * generates a short TTS clip (~5-15 s on first call for old voices).
 */
export async function fetchVoicePreview(
  voiceId: number,
  opts?: { speed?: number; pitch?: number },
): Promise<string> {
  const params = new URLSearchParams();
  if (opts?.speed !== undefined) params.set("speed", String(opts.speed));
  if (opts?.pitch !== undefined) params.set("pitch", String(opts.pitch));
  const qs = params.toString();
  const data = await customFetch<{ url: string }>(
    `/api/wavespeed/voices/${voiceId}/preview${qs ? `?${qs}` : ""}`,
  );
  return data.url;
}

/** List authenticated user's WaveSpeed voices. */
export function useWavespeedVoices() {
  return useQuery<{ voices: WavespeedVoiceRow[] }>({
    queryKey: ["wavespeed", "voices"],
    queryFn: () => customFetch<{ voices: WavespeedVoiceRow[] }>("/api/wavespeed/voices"),
    staleTime: 1000 * 30,
  });
}

/** Poll WaveSpeed voice clone status. Auto-refetches until ready/failed. */
export function useWavespeedVoiceStatus(voiceId: number | null, enabled = true) {
  return useQuery<WavespeedVoiceRow>({
    queryKey: ["wavespeed", "voice-status", voiceId],
    queryFn: () =>
      customFetch<WavespeedVoiceRow>(`/api/wavespeed/voices/${voiceId}/status`),
    enabled: !!voiceId && enabled,
    refetchInterval: (query) => {
      const s = (query.state.data as WavespeedVoiceRow | undefined)?.status;
      return s === "pending" || s == null ? 5000 : false;
    },
    staleTime: 0,
  });
}

/** Rename a WaveSpeed persona (avatar). */
export function usePatchWavespeedPersona() {
  const qc = useQueryClient();
  return useMutation<{ persona: { id: number; name: string } }, Error, { id: number; name: string }>({
    mutationFn: ({ id, name }) =>
      customFetch<{ persona: { id: number; name: string } }>(`/api/wavespeed/personas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: ({ persona: updated }) => {
      qc.setQueryData<{ personas: WavespeedPersonaWithLooks[] }>(
        WAVESPEED_PERSONAS_KEY,
        (old) => {
          if (!old) return old;
          return {
            personas: old.personas.map((p) =>
              p.id === updated.id ? { ...p, name: updated.name } : p,
            ),
          };
        },
      );
    },
  });
}

/** Update a WaveSpeed look's name or config (e.g. voiceId, selected). */
export function usePatchWavespeedLook() {
  const qc = useQueryClient();
  return useMutation<WavespeedLookRow, Error, { id: number; name?: string; config?: Record<string, unknown> }>({
    mutationFn: ({ id, name, config }) =>
      customFetch<WavespeedLookRow>(`/api/wavespeed/looks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config }),
      }),
    onSuccess: (updatedLook) => {
      // Update the look in-place in the React Query cache so the UI reflects the
      // change immediately — without relying on a network round-trip that may
      // return a 304 (browser-cached response) and leave stale data on screen.
      qc.setQueryData<{ personas: WavespeedPersonaWithLooks[] }>(
        WAVESPEED_PERSONAS_KEY,
        (old) => {
          if (!old) return old;
          return {
            personas: old.personas.map((p) => ({
              ...p,
              looks: p.looks.map((l) => (l.id === updatedLook.id ? updatedLook : l)),
            })),
          };
        },
      );
    },
  });
}

/**
 * Save speed and/or pitch tuning for a WaveSpeed cloned voice.
 * Automatically busts the cached preview so the next play regenerates with new settings.
 */
export function useUpdateWavespeedVoice() {
  const qc = useQueryClient();
  return useMutation<
    { voice: WavespeedVoiceRow },
    Error,
    { id: number; speed?: number | null; pitch?: number | null }
  >({
    mutationFn: ({ id, speed, pitch }) =>
      customFetch<{ voice: WavespeedVoiceRow }>(`/api/wavespeed/voices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speed, pitch }),
      }),
    onSuccess: ({ voice: updated }) => {
      qc.setQueryData<{ voices: WavespeedVoiceRow[] }>(
        ["wavespeed", "voices"],
        (old) => {
          if (!old) return old;
          return { voices: old.voices.map((v) => (v.id === updated.id ? updated : v)) };
        },
      );
    },
  });
}

/** Delete a WaveSpeed cloned voice. */
export function useDeleteWavespeedVoice() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, number>({
    mutationFn: (voiceId) =>
      customFetch<{ ok: boolean }>(`/api/wavespeed/voices/${voiceId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wavespeed", "voices"] }),
  });
}

/** Generate one additional look for an existing persona. */
export function useGenerateWavespeedPersonaLooks() {
  const qc = useQueryClient();
  return useMutation<
    { look: { id: number; name: string; config: string | null } },
    Error,
    {
      personaId: number;
      name?: string;
      prompt?: string;
      baseLookId?: number;
      pose?: "half_body" | "close_up" | "full_body";
    }
  >({
    mutationFn: ({ personaId, name, prompt, baseLookId, pose }) =>
      customFetch<{ look: { id: number; name: string; config: string | null } }>(
        `/api/wavespeed/personas/${personaId}/looks/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, prompt, baseLookId, pose }),
        },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: WAVESPEED_PERSONAS_KEY }),
  });
}

// ── Admin user detail ─────────────────────────────────────────────────────────

export interface AdminUserDetail {
  account: {
    id:                number;
    username:          string;
    fullName:          string | null;
    email:             string | null;
    phone:             string | null;
    role:              string;
    isActive:          boolean;
    notes:             string | null;
    createdAt:         string;
    lastLoginAt:       string | null;
    activationPending: boolean;
  };
  subscription: {
    planSlug:             string;
    status:               string;
    currentPeriodStart:   string | null;
    currentPeriodEnd:     string | null;
    cancelAtPeriodEnd:    boolean;
    pendingPlanSlug:      string | null;
    founderMonthsGranted: number;
    founderAnchorAt:      string | null;
    hasStripeCustomer:    boolean;
  } | null;
  credits: {
    availableCredits:    number;
    subscriptionCredits: number;
    purchasedCredits:    number;
    reservedCredits:     number;
    totalConsumed:       number;
  } | null;
  entitlement: {
    toolAccessStatus:   string;
    toolAccessStartsAt: string | null;
    toolAccessEndsAt:   string | null;
    courseAccess:       boolean;
    source:             string | null;
    planSlug:           string | null;
  } | null;
  instagram: { connected: boolean; username: string | null; needsReconnection: boolean };
  production: {
    avatarCount:         number;
    lookCount:           number;
    videoCount:          number;
    publishedVideoCount: number;
    failedVideoCount:    number;
    inProgressCount:     number;
  };
}

const ADMIN_USER_DETAIL_KEY = (userId: number) => ["admin", "user-detail", userId] as const;

/** Fetch full user detail for the admin panel. */
export function useAdminUserDetail(userId: number | null) {
  return useQuery<AdminUserDetail>({
    queryKey:  userId ? ADMIN_USER_DETAIL_KEY(userId) : ["admin", "user-detail", null],
    queryFn:   () => customFetch<AdminUserDetail>(`/api/admin/users/${userId}/detail`),
    enabled:   !!userId,
    staleTime: 30_000,
  });
}

/** Delete a single WaveSpeed look. */
export function useDeleteWavespeedLook() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, number>({
    mutationFn: (lookId) =>
      customFetch<{ ok: boolean }>(`/api/wavespeed/looks/${lookId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WAVESPEED_PERSONAS_KEY }),
  });
}
