import { Router } from "express";
import { db } from "@workspace/db";
import { instagramAccountsTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import {
  GetInstagramAuthUrlResponse,
  HandleInstagramCallbackBody,
  HandleInstagramCallbackResponse,
  GetInstagramAccountResponse,
  DisconnectInstagramResponse,
  GetInstagramAuditResponse,
  GetInstagramPostsQueryParams,
  GetInstagramPostsResponse,
} from "@workspace/api-zod";
import {
  getAuthUrl,
  exchangeCodeForToken,
  refreshInstagramToken,
  getAccountInfo,
  getMediaList,
  getMediaInsights,
} from "../lib/instagram-api";
import { analyzeAuditAndRecommend } from "../lib/ai-scripts";
import { saveAuditCache } from "../lib/audit-cache";
import { logger } from "../lib/logger";

const router = Router();

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return false;
    if (u.pathname !== "/connect") return false;
    return (
      u.hostname === "localhost" ||
      u.hostname.endsWith(".replit.dev") ||
      u.hostname.endsWith(".replit.app") ||
      u.hostname === "reelsona.com" ||
      u.hostname.endsWith(".reelsona.com")
    );
  } catch {
    return false;
  }
}

router.get("/instagram/auth-url", async (req, res): Promise<void> => {
  // The frontend passes its own origin so the redirect_uri is always the real
  // domain the user sees in their browser — not localhost or an internal host.
  const redirectUri = req.query["redirect_uri"] as string | undefined;
  const state = req.query["state"] as string | undefined;
  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    res.status(400).json({ error: "redirect_uri query param is required and must be an allowed origin" });
    return;
  }
  // Store the state in the server session so we can validate it on callback
  // (CSRF protection — prevents an attacker from injecting a forged code).
  if (state) {
    req.session.igOauthState = state;
  }
  const url = getAuthUrl(redirectUri, state);
  res.json(GetInstagramAuthUrlResponse.parse({ url }));
});

router.post("/instagram/callback", async (req, res): Promise<void> => {
  const parsed = HandleInstagramCallbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { code, redirect_uri, state } = parsed.data;

  // ── Server-side CSRF state validation ────────────────────────────────────
  // If this session previously initiated an OAuth flow (igOauthState is set),
  // the returned state MUST match.  If no session state exists we allow the
  // request through with a warning (handles legacy flows without state support).
  const expectedState = req.session.igOauthState;
  if (expectedState) {
    if (!state || state !== expectedState) {
      logger.warn({ userId: req.session.user?.userId, hasState: !!state }, "[IG/Callback] State mismatch — possible CSRF attempt, rejecting");
      res.status(400).json({ error: "El parámetro state no es válido. Intenta conectar de nuevo." });
      return;
    }
  } else if (state) {
    // State returned but no session record — log but proceed (graceful for existing sessions)
    logger.warn({ state }, "[IG/Callback] state returned but no igOauthState in session — stale or cross-tab session");
  }
  // Clear the nonce from the session regardless of outcome
  delete req.session.igOauthState;
  // ─────────────────────────────────────────────────────────────────────────

  let accessToken: string;
  let expiresAt: Date;
  let accountInfo: Awaited<ReturnType<typeof getAccountInfo>>;
  try {
    ({ accessToken, expiresAt } = await exchangeCodeForToken(code, redirect_uri));
    accountInfo = await getAccountInfo(accessToken);
  } catch (err: any) {
    const igMessage =
      err?.response?.data?.error_message ??
      err?.response?.data?.error?.message ??
      err?.message ??
      "Error desconocido";
    res.status(400).json({ error: `Instagram: ${igMessage}` });
    return;
  }

  // ── Account type guard ─────────────────────────────────────────────────────
  // instagram_business_* scopes only work for Business and Creator accounts.
  // Personal accounts cannot publish or access insights.
  const accountType: string | undefined = accountInfo.account_type;
  if (accountType === "PERSONAL") {
    logger.warn({ username: accountInfo.username, accountType }, "[IG/Connect] Rejected: personal account tried to connect");
    res.status(400).json({
      error: "Reelsona requiere una cuenta de Instagram de tipo Business o Creator. Las cuentas personales no pueden publicar Reels ni acceder a métricas mediante la API de Instagram Business.",
    });
    return;
  }

  const userId = req.session.user!.userId;

  // Release any stale ownership of this IG account by another user.
  // This prevents a UNIQUE (ig_user_id) violation when the same Instagram
  // account was previously connected under a different Reelsona user_id
  // (e.g. a seed/admin row created during onboarding).
  await db.delete(instagramAccountsTable).where(
    and(
      eq(instagramAccountsTable.igUserId, accountInfo.id),
      ne(instagramAccountsTable.userId, userId),
    ),
  );

  // Upsert account — one Instagram account per app user
  const existing = await db
    .select()
    .from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(instagramAccountsTable)
      .set({
        igUserId: accountInfo.id,
        username: accountInfo.username,
        name: accountInfo.name ?? null,
        profilePictureUrl: accountInfo.profile_picture_url ?? null,
        followersCount: accountInfo.followers_count ?? 0,
        mediaCount: accountInfo.media_count ?? 0,
        accessToken,
        tokenExpiresAt: expiresAt,
        needsReconnection: false,
        updatedAt: new Date(),
      })
      .where(eq(instagramAccountsTable.userId, userId));
  } else {
    await db.insert(instagramAccountsTable).values({
      userId,
      igUserId: accountInfo.id,
      username: accountInfo.username,
      name: accountInfo.name ?? null,
      profilePictureUrl: accountInfo.profile_picture_url ?? null,
      followersCount: accountInfo.followers_count ?? 0,
      mediaCount: accountInfo.media_count ?? 0,
      accessToken,
      tokenExpiresAt: expiresAt,
      needsReconnection: false,
    });
  }

  const [account] = await db
    .select()
    .from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, userId))
    .limit(1);

  res.json(
    HandleInstagramCallbackResponse.parse({
      id: account.igUserId,
      username: account.username,
      name: account.name ?? null,
      profile_picture_url: account.profilePictureUrl ?? null,
      followers_count: account.followersCount,
      media_count: account.mediaCount,
      connected_at: account.connectedAt.toISOString(),
      account_type: accountType ?? null,
    })
  );
});

router.get("/instagram/account", async (req, res): Promise<void> => {
  const [account] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, req.session.user!.userId)).limit(1);
  if (!account) {
    res.json(GetInstagramAccountResponse.parse({ connected: false }));
    return;
  }
  res.json(
    GetInstagramAccountResponse.parse({
      connected: true,
      account: {
        id: account.igUserId,
        username: account.username,
        name: account.name ?? null,
        profile_picture_url: account.profilePictureUrl ?? null,
        followers_count: account.followersCount,
        media_count: account.mediaCount,
        connected_at: account.connectedAt.toISOString(),
        token_expires_at: account.tokenExpiresAt?.toISOString() ?? null,
        needs_reconnection: account.needsReconnection ?? false,
        account_type: null,  // not stored in DB; only returned at connect time
      },
    })
  );
});

router.delete("/instagram/disconnect", async (req, res): Promise<void> => {
  await db.delete(instagramAccountsTable).where(eq(instagramAccountsTable.userId, req.session.user!.userId));
  res.json(DisconnectInstagramResponse.parse({ success: true, message: "Disconnected" }));
});

/**
 * POST /instagram/refresh-profile-picture
 * Re-fetches the profile picture URL from the Instagram Graph API and updates
 * the DB.  Instagram CDN URLs expire after a few hours, so this is called
 * automatically when the frontend detects a broken image.
 */
router.post("/instagram/refresh-profile-picture", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const [account] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, userId)).limit(1);
  if (!account) {
    res.status(404).json({ error: "No Instagram account connected" });
    return;
  }
  try {
    const fresh = await getAccountInfo(account.accessToken);
    const freshUrl = fresh.profile_picture_url ?? null;
    await db.update(instagramAccountsTable)
      .set({ profilePictureUrl: freshUrl, updatedAt: new Date() })
      .where(eq(instagramAccountsTable.userId, userId));
    logger.info({ userId, hasUrl: !!freshUrl }, "[IG] Profile picture URL refreshed");
    res.json({ profile_picture_url: freshUrl });
  } catch (err: any) {
    logger.warn({ err }, "[IG] Failed to refresh profile picture URL");
    res.status(500).json({ error: "Failed to refresh profile picture" });
  }
});

/**
 * POST /instagram/refresh-token
 * Manually trigger a token refresh for the connected account.
 * Called by the frontend when the token is close to expiry or when auto-refresh fails.
 */
router.post("/instagram/refresh-token", async (req, res): Promise<void> => {
  const [account] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, req.session.user!.userId)).limit(1);
  if (!account) {
    res.status(404).json({ error: "No Instagram account connected" });
    return;
  }
  try {
    const { accessToken, expiresAt } = await refreshInstagramToken(account.accessToken);
    await db.update(instagramAccountsTable).set({
      accessToken,
      tokenExpiresAt: expiresAt,
      needsReconnection: false,
      updatedAt: new Date(),
    }).where(eq(instagramAccountsTable.userId, req.session.user!.userId));
    logger.info({ userId: req.session.user!.userId }, "[IG/Refresh] Token refreshed manually");
    res.json({ success: true, token_expires_at: expiresAt.toISOString() });
  } catch (err: any) {
    const message = err?.response?.data?.error?.message ?? err?.message ?? "Unknown error";
    logger.error({ userId: req.session.user!.userId, message }, "[IG/Refresh] Manual token refresh failed — marking account as needs reconnection");
    await db.update(instagramAccountsTable)
      .set({ needsReconnection: true, updatedAt: new Date() })
      .where(eq(instagramAccountsTable.userId, req.session.user!.userId));
    res.status(400).json({ error: "El token de Instagram ha expirado. Por favor reconecta tu cuenta." });
  }
});

router.get("/instagram/audit", async (req, res): Promise<void> => {
  const [account] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, req.session.user!.userId)).limit(1);
  if (!account) {
    res.status(400).json({ error: "No Instagram account connected" });
    return;
  }

  // Guard: token has failed to refresh — prompt reconnection before doing any API calls
  if (account.needsReconnection) {
    res.status(401).json({ error: "TOKEN_EXPIRED", message: "Tu token de Instagram ha expirado. Reconecta tu cuenta para continuar." });
    return;
  }

  const { settingsTable: stbl } = await import("@workspace/db");
  const [settingsRow] = await db
    .select()
    .from(stbl)
    .where(eq(stbl.userId, req.session.user!.userId))
    .limit(1);

  const media = await getMediaList(account.accessToken, account.igUserId, 20);

  // Fetch insights — detect account-level errors (expired token, wrong permissions)
  // early and return a proper HTTP error instead of silently showing zeros.
  let accountLevelError: string | null = null;
  const postsWithInsights = await Promise.all(
    media.map(async (m: { id: string; media_type: string; media_url?: string; thumbnail_url?: string; permalink?: string; caption?: string; like_count: number; comments_count: number; timestamp: string }) => {
      const result = await getMediaInsights(account.accessToken, m.id, m.media_type);

      // Bubble up account-level errors so we can return a proper status code
      if (result.error === "token_expired" && !accountLevelError) {
        accountLevelError = "TOKEN_EXPIRED";
      } else if (result.error === "permission_denied" && !accountLevelError) {
        accountLevelError = "PERMISSION_DENIED";
      }

      const insights = result.values;
      const reach = insights.reach ?? 0;
      const engagements = (m.like_count ?? 0) + (m.comments_count ?? 0) + (insights.saved ?? 0);
      const engagementRate = reach > 0 ? (engagements / reach) * 100 : 0;
      return {
        id: m.id,
        media_type: m.media_type,
        thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
        permalink: m.permalink ?? null,
        caption: m.caption ?? null,
        like_count: m.like_count ?? 0,
        comments_count: m.comments_count ?? 0,
        reach: reach || null,
        impressions: insights.views ?? null,
        plays: insights.views ?? null,
        engagement_rate: engagementRate || null,
        timestamp: m.timestamp,
      };
    })
  );

  // If every post returned a token/permission error, abort with a clear status code
  if (accountLevelError === "TOKEN_EXPIRED") {
    // Mark account as needing reconnection so the UI and scheduler know
    await db.update(instagramAccountsTable)
      .set({ needsReconnection: true, updatedAt: new Date() })
      .where(eq(instagramAccountsTable.userId, req.session.user!.userId));
    res.status(401).json({ error: "TOKEN_EXPIRED", message: "Tu token de Instagram expiró. Reconecta tu cuenta." });
    return;
  }
  if (accountLevelError === "PERMISSION_DENIED") {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Faltan permisos de Instagram. Desconecta tu cuenta y vuelve a conectarla." });
    return;
  }

  const sorted = [...postsWithInsights].sort((a, b) => (b.engagement_rate ?? 0) - (a.engagement_rate ?? 0));
  const avgEngagement =
    postsWithInsights.length > 0
      ? postsWithInsights.reduce((s, p) => s + (p.engagement_rate ?? 0), 0) / postsWithInsights.length
      : 0;
  const avgReach =
    postsWithInsights.length > 0
      ? postsWithInsights.reduce((s, p) => s + (p.reach ?? 0), 0) / postsWithInsights.length
      : 0;

  const topCaptions = sorted.slice(0, 10).map((p) => p.caption ?? "");
  const aiAnalysis = await analyzeAuditAndRecommend(
    settingsRow?.niche ?? "general",
    topCaptions,
    avgEngagement,
    settingsRow?.language ?? "es"
  );

  const top5Captions = sorted.slice(0, 5).map((p) => p.caption ?? "").filter(Boolean);
  saveAuditCache({
    topCaptions: top5Captions,
    recommendedTopics: aiAnalysis.recommended_topics,
    avgEngagement,
    bestPostingTimes: aiAnalysis.best_posting_times,
    contentInsights: aiAnalysis.content_insights,
  }).catch(() => { /* non-fatal */ });

  const result = {
    account: {
      id: account.igUserId,
      username: account.username,
      name: account.name ?? null,
      profile_picture_url: account.profilePictureUrl ?? null,
      followers_count: account.followersCount,
      media_count: account.mediaCount,
      connected_at: account.connectedAt.toISOString(),
    },
    top_posts: sorted.slice(0, 6),
    avg_engagement_rate: avgEngagement,
    avg_reach: avgReach,
    best_posting_times: aiAnalysis.best_posting_times,
    recommended_topics: aiAnalysis.recommended_topics,
    content_insights: aiAnalysis.content_insights,
    generated_at: new Date().toISOString(),
  };

  res.json(GetInstagramAuditResponse.parse(result));
});

router.get("/instagram/posts", async (req, res): Promise<void> => {
  const [account] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, req.session.user!.userId)).limit(1);
  if (!account) {
    res.json([]);
    return;
  }

  // Guard: token known-bad — return posts without insights rather than hitting the API
  if (account.needsReconnection) {
    res.status(401).json({ error: "TOKEN_EXPIRED", message: "Tu token de Instagram expiró. Reconecta tu cuenta." });
    return;
  }

  const queryParsed = GetInstagramPostsQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 20) : 20;

  const media = await getMediaList(account.accessToken, account.igUserId, limit);

  const posts = await Promise.all(
    media.map(async (m: { id: string; media_type: string; media_url?: string; thumbnail_url?: string; permalink?: string; caption?: string; like_count: number; comments_count: number; timestamp: string }) => {
      const result = await getMediaInsights(account.accessToken, m.id, m.media_type);
      const insights = result.values;
      const reach = insights.reach ?? null;
      const views = insights.views ?? null;
      const engagements = (m.like_count ?? 0) + (m.comments_count ?? 0) + (insights.saved ?? 0);
      const engagementRate = reach ? (engagements / reach) * 100 : null;

      // Surface account-level insight errors so the frontend can warn the user
      const insightsError: string | null = (result.error && result.error !== "not_found") ? result.error : null;

      return {
        id: m.id,
        media_type: m.media_type,
        thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
        permalink: m.permalink ?? null,
        caption: m.caption ?? null,
        like_count: m.like_count ?? 0,
        comments_count: m.comments_count ?? 0,
        reach,
        impressions: views,
        plays: views,
        engagement_rate: engagementRate,
        timestamp: m.timestamp,
        insights_error: insightsError,
      };
    })
  );

  res.json(GetInstagramPostsResponse.parse(posts));
});

export default router;
