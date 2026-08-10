import { Router } from "express";
import { db } from "@workspace/db";
import { instagramAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
  getAccountInfo,
  getMediaList,
  getMediaInsights,
} from "../lib/instagram-api";
import { analyzeAuditAndRecommend } from "../lib/ai-scripts";
import { saveAuditCache } from "../lib/audit-cache";

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
  const url = getAuthUrl(redirectUri, state);
  res.json(GetInstagramAuthUrlResponse.parse({ url }));
});

router.post("/instagram/callback", async (req, res): Promise<void> => {
  const parsed = HandleInstagramCallbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { code, redirect_uri } = parsed.data;

  let accessToken: string;
  let accountInfo: Awaited<ReturnType<typeof getAccountInfo>>;
  try {
    accessToken = await exchangeCodeForToken(code, redirect_uri);
    accountInfo = await getAccountInfo(accessToken);
  } catch (err: any) {
    // Surface the actual Instagram/Meta error so it reaches the client
    const igMessage =
      err?.response?.data?.error_message ??
      err?.response?.data?.error?.message ??
      err?.message ??
      "Error desconocido";
    res.status(400).json({ error: `Instagram: ${igMessage}` });
    return;
  }

  const userId = req.session.user!.userId;

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
      },
    })
  );
});

router.delete("/instagram/disconnect", async (req, res): Promise<void> => {
  await db.delete(instagramAccountsTable).where(eq(instagramAccountsTable.userId, req.session.user!.userId));
  res.json(DisconnectInstagramResponse.parse({ success: true, message: "Disconnected" }));
});

router.get("/instagram/audit", async (req, res): Promise<void> => {
  const [account] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, req.session.user!.userId)).limit(1);
  if (!account) {
    res.status(400).json({ error: "No Instagram account connected" });
    return;
  }

  const { settingsTable: stbl } = await import("@workspace/db");
  const [settingsRow] = await db
    .select()
    .from(stbl)
    .where(eq(stbl.userId, req.session.user!.userId))
    .limit(1);

  const media = await getMediaList(account.accessToken, account.igUserId, 20);

  const postsWithInsights = await Promise.all(
    media.map(async (m: { id: string; media_type: string; media_url?: string; thumbnail_url?: string; permalink?: string; caption?: string; like_count: number; comments_count: number; timestamp: string }) => {
      const insights = await getMediaInsights(account.accessToken, m.id, m.media_type);
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

  const sorted = [...postsWithInsights].sort((a, b) => (b.engagement_rate ?? 0) - (a.engagement_rate ?? 0));
  const avgEngagement =
    postsWithInsights.length > 0
      ? postsWithInsights.reduce((s, p) => s + (p.engagement_rate ?? 0), 0) / postsWithInsights.length
      : 0;
  const avgReach =
    postsWithInsights.length > 0
      ? postsWithInsights.reduce((s, p) => s + (p.reach ?? 0), 0) / postsWithInsights.length
      : 0;

  // Use up to 10 captions for analysis but save top-5 full captions for future generation use
  const topCaptions = sorted.slice(0, 10).map((p) => p.caption ?? "");
  const aiAnalysis = await analyzeAuditAndRecommend(
    settingsRow?.niche ?? "general",
    topCaptions,
    avgEngagement,
    settingsRow?.language ?? "es"
  );

  // Persist audit to cache for future generation cycles (non-blocking)
  const top5Captions = sorted.slice(0, 5).map((p) => p.caption ?? "").filter(Boolean);
  saveAuditCache({
    topCaptions: top5Captions,
    recommendedTopics: aiAnalysis.recommended_topics,
    avgEngagement,
    bestPostingTimes: aiAnalysis.best_posting_times,
    contentInsights: aiAnalysis.content_insights,
  }).catch(() => { /* non-fatal — already logged inside saveAuditCache */ });

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

  const queryParsed = GetInstagramPostsQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 20) : 20;

  const media = await getMediaList(account.accessToken, account.igUserId, limit);
  const posts = media.map((m: { id: string; media_type: string; media_url?: string; thumbnail_url?: string; permalink?: string; caption?: string; like_count: number; comments_count: number; timestamp: string }) => ({
    id: m.id,
    media_type: m.media_type,
    thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
    permalink: m.permalink ?? null,
    caption: m.caption ?? null,
    like_count: m.like_count ?? 0,
    comments_count: m.comments_count ?? 0,
    reach: null,
    impressions: null,
    plays: null,
    engagement_rate: null,
    timestamp: m.timestamp,
  }));

  res.json(GetInstagramPostsResponse.parse(posts));
});

export default router;
