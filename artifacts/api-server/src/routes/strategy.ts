/**
 * Strategic Audit routes — the 5-step content strategy flow.
 *
 * GET  /strategy/profile              → current StrategyProfile or null
 * POST /strategy/account              → run IG audit, save account_data, return profile
 * GET  /strategy/radar                → list niche radar accounts
 * GET  /strategy/radar/status         → { apify_available: bool }
 * GET  /strategy/radar/suggestions    → AI-suggested accounts for the niche
 * POST /strategy/radar                → add radar account
 * PATCH /strategy/radar/:id           → update use_as_reference / relevance_score
 * DELETE /strategy/radar/:id          → remove account
 * POST /strategy/market               → synthesize MarketInsights, save to profile
 * POST /strategy/strategy             → generate ContentStrategy, save to profile
 */
import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { requirePlanAccess } from "../middleware/requirePlanAccess";
import {
  instagramAccountsTable,
  nicheRadarAccountsTable,
  settingsTable,
  contentPlanItemsTable,
} from "@workspace/db";
import { getMediaList, getMediaInsights } from "../lib/instagram-api";
import { analyzeAuditAndRecommend, reanalyzeTopicsWithStrategy } from "../lib/ai-scripts";
import { saveAuditCache } from "../lib/audit-cache";
import {
  synthesizeMarketStudy,
  generateContentStrategy,
} from "../lib/ai-strategy";
import {
  getStrategyProfile,
  upsertStrategyProfile,
  toStrategyContext,
} from "../lib/strategy-profile";
import { syncAllStaleRadarAccounts } from "../lib/scheduler";
import type { AccountData } from "../lib/ai-strategy";
import { enrichProfileWithApify } from "../lib/apify";
import { makeOpenAIClient } from "../lib/openai-client";
import { logger } from "../lib/logger";

const router = Router();

// ── Serialization helper — Drizzle returns camelCase; frontend expects snake_case ──

function serializeAccount(a: typeof nicheRadarAccountsTable.$inferSelect) {
  return {
    id:               a.id,
    ig_username:      a.igUsername,
    profile_url:      a.profileUrl ?? null,
    bio:              a.bio ?? null,
    followers:        a.followers ?? null,
    relevance_score:  a.relevanceScore ?? null,
    use_as_reference: a.useAsReference,
    source:           a.source,
    top_posts_json:   a.topPostsJson ?? null,
    last_synced_at:   a.lastSyncedAt?.toISOString() ?? null,
    created_at:       a.createdAt.toISOString(),
  };
}

// ── Plan gate — all Radar/Market/Strategy write endpoints require Pro or Founder ─
const PRO_PLANS = ["pro", "founder"];

// ── GET /strategy/profile ─────────────────────────────────────────────────────

router.get("/strategy/profile", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  try {
    const profile = await getStrategyProfile(userId);
    res.json({ profile });
  } catch (err) {
    logger.error({ err }, "Failed to load strategy profile");
    res.status(500).json({ error: "Failed to load strategy profile" });
  }
});

// ── POST /strategy/account — run IG audit and save account_data ───────────────

router.post("/strategy/account", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const [account] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, userId)).limit(1);
  if (!account) {
    res.status(400).json({ error: "No Instagram account connected" });
    return;
  }
  const [settingsRow] = await db.select().from(settingsTable)
    .where(eq(settingsTable.userId, userId)).limit(1);

  try {
    const media = await getMediaList(account.accessToken, account.igUserId, 20);
    const postsWithInsights = await Promise.all(
      media.map(async (m: any) => {
        const insightResult = await getMediaInsights(account.accessToken, m.id, m.media_type);
        const insights = insightResult.values;
        const reach = insights.reach ?? 0;
        const engagements = (m.like_count ?? 0) + (m.comments_count ?? 0) + (insights.saved ?? 0);
        const engagementRate = reach > 0 ? (engagements / reach) * 100 : 0;
        return {
          id:             m.id,
          media_type:     m.media_type,
          thumbnail_url:  m.thumbnail_url ?? m.media_url ?? null,
          permalink:      m.permalink ?? null,
          caption:        m.caption ?? null,
          like_count:     m.like_count ?? 0,
          comments_count: m.comments_count ?? 0,
          reach:          reach || null,
          plays:          insights.views ?? null,
          engagement_rate: engagementRate || null,
          timestamp:      m.timestamp,
        };
      })
    );

    const sorted = [...postsWithInsights].sort(
      (a, b) => (b.engagement_rate ?? 0) - (a.engagement_rate ?? 0)
    );
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
      settingsRow?.language ?? "es",
    );

    const top5Captions = sorted.slice(0, 5).map((p) => p.caption ?? "").filter(Boolean);

    // Backward-compat: keep saving the audit cache
    saveAuditCache({
      topCaptions:        top5Captions,
      recommendedTopics:  aiAnalysis.recommended_topics,
      avgEngagement,
      bestPostingTimes:   aiAnalysis.best_posting_times,
      contentInsights:    aiAnalysis.content_insights,
    }).catch(() => {});

    const accountData: AccountData = {
      avg_engagement:       avgEngagement,
      avg_reach:            avgReach,
      best_posting_times:   aiAnalysis.best_posting_times,
      top_posts:            sorted.slice(0, 6) as AccountData["top_posts"],
      top_captions:         top5Captions,
      follower_count:       account.followersCount ?? 0,
      media_count:          account.mediaCount ?? 0,
      fetched_at:           new Date().toISOString(),
    };

    const profile = await upsertStrategyProfile(userId, {
      account_data: accountData,
      step: "account",
    });

    res.json({ profile });
  } catch (err: any) {
    logger.error({ err }, "Strategy account audit failed");
    res.status(500).json({ error: err?.message ?? "Audit failed" });
  }
});

// ── GET /strategy/radar/status ────────────────────────────────────────────────
// Note: status check is plan-free — just reports whether Apify env var is set.

router.get("/strategy/radar/status", (_req, res) => {
  res.json({ apify_available: !!process.env.APIFY_TOKEN });
});

// ── GET /strategy/radar/suggestions ──────────────────────────────────────────

router.get("/strategy/radar/suggestions", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const [settingsRow] = await db.select().from(settingsTable)
    .where(eq(settingsTable.userId, userId)).limit(1);
  if (!settingsRow?.niche) {
    res.json({ suggestions: [] });
    return;
  }
  try {
    // Fetch already-saved accounts so the AI never repeats them
    const existing = await db.select({ igUsername: nicheRadarAccountsTable.igUsername })
      .from(nicheRadarAccountsTable)
      .where(eq(nicheRadarAccountsTable.userId, userId));
    const excludeList = existing.map((r) => r.igUsername);

    const client = makeOpenAIClient();
    const language = settingsRow.language ?? "es";
    const langInstruction = language === "en" ? "Respond in English." : "Responde en español.";
    const excludeBlock = excludeList.length > 0
      ? `\nCuentas que el creador YA tiene en su radar — NO las sugieras: ${excludeList.map((u) => `@${u}`).join(", ")}`
      : "";

    const prompt = `${langInstruction}

Eres un experto en Instagram y nichos de contenido. El creador tiene el siguiente perfil:
- Nicho: ${settingsRow.niche}
${settingsRow.nicheDescription ? `- Descripción: ${settingsRow.nicheDescription}` : ""}
${(settingsRow.topicKeywords as string[] | null)?.length ? `- Keywords: ${(settingsRow.topicKeywords as string[]).join(", ")}` : ""}
${excludeBlock}

Sugiere 10 cuentas de Instagram reales y relevantes que este creador debería monitorear como referentes del nicho. Pueden ser cuentas grandes, medianas o micro-influencers. Enfócate en cuentas que realmente existan y sean relevantes. NUNCA repitas las cuentas excluidas arriba.

Devuelve SOLO un JSON:
{
  "suggestions": [
    {
      "ig_username": "username_sin_arroba",
      "reason": "por qué es relevante para este nicho (1 frase)",
      "approximate_followers": "100K",
      "content_type": "tipo de contenido que hace"
    }
  ]
}`;

    const result = await client.chat.completions.create({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(result.choices[0]?.message?.content ?? "{}");
    // Extra safety: strip any that sneak through matching existing accounts
    const filtered = (parsed.suggestions ?? []).filter(
      (s: { ig_username: string }) => !excludeList.includes(s.ig_username?.toLowerCase())
    );
    res.json({ suggestions: filtered });
  } catch (err) {
    logger.error({ err }, "Failed to get radar suggestions");
    res.json({ suggestions: [] });
  }
});

// ── GET /strategy/radar ───────────────────────────────────────────────────────

router.get("/strategy/radar", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const accounts = await db.select().from(nicheRadarAccountsTable)
    .where(eq(nicheRadarAccountsTable.userId, userId))
    .orderBy(nicheRadarAccountsTable.createdAt);
  res.json({ accounts: accounts.map(serializeAccount) });
});

// ── POST /strategy/radar ──────────────────────────────────────────────────────

router.post("/strategy/radar", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const { ig_username, bio, followers, profile_url, relevance_score, source } = req.body ?? {};
  if (!ig_username?.trim()) {
    res.status(400).json({ error: "ig_username is required" });
    return;
  }
  const username = ig_username.trim().toLowerCase();
  const userId = req.session.user!.userId;
  const [existing] = await db
    .select()
    .from(nicheRadarAccountsTable)
    .where(and(eq(nicheRadarAccountsTable.igUsername, username), eq(nicheRadarAccountsTable.userId, userId)))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Account already in radar", account: serializeAccount(existing) });
    return;
  }
  const [inserted] = await db
    .insert(nicheRadarAccountsTable)
    .values({
      userId,
      igUsername:     username,
      profileUrl:     profile_url ?? null,
      bio:            bio ?? null,
      followers:      followers ? Number(followers) : null,
      relevanceScore: relevance_score ? Number(relevance_score) : 5,
      source:         source ?? "manual",
    })
    .returning();

  // Fire-and-forget Apify enrichment if token is available
  if (process.env.APIFY_TOKEN) {
    enrichProfileWithApify(username).then(async (apifyData) => {
      if (!apifyData) return;
      await db
        .update(nicheRadarAccountsTable)
        .set({
          bio:          apifyData.biography ?? inserted.bio,
          followers:    apifyData.followersCount ?? inserted.followers,
          profileUrl:   apifyData.profilePicUrl ?? inserted.profileUrl,
          topPostsJson: apifyData.topPosts.length > 0 ? apifyData.topPosts : null,
          lastSyncedAt: new Date(),
        })
        .where(eq(nicheRadarAccountsTable.id, inserted.id));
      logger.info({ igUsername: username }, "Apify enrichment completed for new radar account");
    }).catch((err) => logger.error({ err, igUsername: username }, "Background Apify enrichment failed"));
  }

  res.status(201).json({ account: serializeAccount(inserted) });
});

// ── POST /strategy/radar/sync-all — sync all stale accounts ──────────────────

router.post("/strategy/radar/sync-all", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  if (!process.env.APIFY_TOKEN) {
    res.status(503).json({ error: "APIFY_TOKEN not configured" });
    return;
  }

  try {
    const result = await syncAllStaleRadarAccounts(userId);
    if (result.total === 0) {
      res.json({ synced: 0, failed: 0, total: 0, message: "All accounts are up to date" });
    } else {
      res.json(result);
    }
  } catch (err: any) {
    logger.error({ err }, "sync-all failed");
    res.status(500).json({ error: err?.message ?? "Sync failed" });
  }
});

// ── POST /strategy/radar/:id/sync — manually trigger Apify enrichment ─────────

router.post("/strategy/radar/:id/sync", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  if (!process.env.APIFY_TOKEN) {
    res.status(503).json({ error: "APIFY_TOKEN not configured" });
    return;
  }

  const userId = req.session.user!.userId;
  const [account] = await db
    .select()
    .from(nicheRadarAccountsTable)
    .where(and(eq(nicheRadarAccountsTable.id, id), eq(nicheRadarAccountsTable.userId, userId)))
    .limit(1);
  if (!account) { res.status(404).json({ error: "Not found" }); return; }

  try {
    const apifyData = await enrichProfileWithApify(account.igUsername);
    if (!apifyData) {
      res.status(502).json({ error: "Apify enrichment returned no data" });
      return;
    }

    const [updated] = await db
      .update(nicheRadarAccountsTable)
      .set({
        bio:          apifyData.biography ?? account.bio,
        followers:    apifyData.followersCount ?? account.followers,
        profileUrl:   apifyData.profilePicUrl ?? account.profileUrl,
        topPostsJson: apifyData.topPosts.length > 0 ? apifyData.topPosts : account.topPostsJson,
        lastSyncedAt: new Date(),
      })
      .where(eq(nicheRadarAccountsTable.id, id))
      .returning();

    res.json({ account: serializeAccount(updated) });
  } catch (err: any) {
    logger.error({ err, id }, "Apify sync failed");
    res.status(500).json({ error: err?.message ?? "Sync failed" });
  }
});


// ── PATCH /strategy/radar/:id ─────────────────────────────────────────────────

router.patch("/strategy/radar/:id", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.user!.userId;
  const { use_as_reference, relevance_score, bio, followers } = req.body ?? {};
  const patch: Partial<typeof nicheRadarAccountsTable.$inferInsert> = {};
  if (use_as_reference !== undefined) patch.useAsReference = Boolean(use_as_reference);
  if (relevance_score !== undefined)  patch.relevanceScore = Number(relevance_score);
  if (bio !== undefined)              patch.bio = bio;
  if (followers !== undefined)        patch.followers = Number(followers);
  const [updated] = await db
    .update(nicheRadarAccountsTable)
    .set(patch)
    .where(and(eq(nicheRadarAccountsTable.id, id), eq(nicheRadarAccountsTable.userId, userId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ account: serializeAccount(updated) });
});

// ── DELETE /strategy/radar/:id ────────────────────────────────────────────────

router.delete("/strategy/radar/:id", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.user!.userId;
  await db.delete(nicheRadarAccountsTable).where(
    and(eq(nicheRadarAccountsTable.id, id), eq(nicheRadarAccountsTable.userId, userId))
  );
  res.json({ success: true });
});

// ── POST /strategy/market — synthesize MarketInsights ────────────────────────

router.post("/strategy/market", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const profile = await getStrategyProfile(userId);
  if (!profile?.account_data) {
    res.status(400).json({ error: "Run the Account audit first (step 1)" });
    return;
  }
  const [settingsRow] = await db.select().from(settingsTable)
    .where(eq(settingsTable.userId, userId)).limit(1);
  const radarAccounts = await db
    .select()
    .from(nicheRadarAccountsTable)
    .where(and(eq(nicheRadarAccountsTable.userId, userId), eq(nicheRadarAccountsTable.useAsReference, true)));

  try {
    const marketInsights = await synthesizeMarketStudy({
      niche:             settingsRow?.niche ?? "general",
      nicheDescription:  settingsRow?.nicheDescription ?? null,
      topicKeywords:     (settingsRow?.topicKeywords as string[] | null) ?? [],
      tone:              settingsRow?.tone ?? "casual",
      language:          settingsRow?.language ?? "es",
      accountData:       profile.account_data,
      radarAccounts:     radarAccounts.map((r) => ({
        ig_username:      r.igUsername,
        bio:              r.bio,
        followers:        r.followers,
        use_as_reference: r.useAsReference,
        top_posts:        r.topPostsJson as any ?? null,
        last_synced_at:   r.lastSyncedAt,
      })),
    });

    const updated = await upsertStrategyProfile(userId, {
      market_insights: marketInsights,
      step: "market",
    });
    res.json({ profile: updated });
  } catch (err: any) {
    logger.error({ err }, "Market study synthesis failed");
    res.status(500).json({ error: err?.message ?? "Market study failed" });
  }
});

// ── POST /strategy/strategy — generate ContentStrategy ───────────────────────

router.post("/strategy/strategy", requirePlanAccess(PRO_PLANS), async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const profile = await getStrategyProfile(userId);
  if (!profile?.account_data) {
    res.status(400).json({ error: "Run the Account audit first (step 1)" });
    return;
  }
  if (!profile?.market_insights) {
    res.status(400).json({ error: "Run the Market study first (step 3)" });
    return;
  }
  const [settingsRow] = await db.select().from(settingsTable)
    .where(eq(settingsTable.userId, userId)).limit(1);
  const radarAccounts = await db
    .select()
    .from(nicheRadarAccountsTable)
    .where(and(eq(nicheRadarAccountsTable.userId, userId), eq(nicheRadarAccountsTable.useAsReference, true)));

  try {
    const contentStrategy = await generateContentStrategy({
      niche:             settingsRow?.niche ?? "general",
      nicheDescription:  settingsRow?.nicheDescription ?? null,
      topicKeywords:     (settingsRow?.topicKeywords as string[] | null) ?? [],
      tone:              settingsRow?.tone ?? "casual",
      language:          settingsRow?.language ?? "es",
      accountData:       profile.account_data,
      marketInsights:    profile.market_insights,
      radarAccounts:     radarAccounts.map((r) => ({
        ig_username:      r.igUsername,
        bio:              r.bio,
        followers:        r.followers,
        use_as_reference: r.useAsReference,
      })),
    });

    const updated = await upsertStrategyProfile(userId, {
      content_strategy: contentStrategy,
      step: "strategy",
    });
    res.json({ profile: updated });

    // Fire-and-forget: re-score draft plan items against the new strategy.
    // - strategyVersion pins the exact save so a later concurrent strategy save
    //   that completes sooner cannot be overwritten by this (older) job.
    // - draftIdSet ensures we only update the rows we originally queried as draft,
    //   guarding against hallucinated IDs and items that transitioned out of draft
    //   while the AI call was in flight.
    const strategyContext = toStrategyContext(updated);
    const strategyVersion = updated.updated_at; // ISO string set by upsertStrategyProfile
    if (strategyContext) {
      setImmediate(async () => {
        try {
          const drafts = await db
            .select({ id: contentPlanItemsTable.id, topic: contentPlanItemsTable.topic })
            .from(contentPlanItemsTable)
            .where(and(eq(contentPlanItemsTable.userId, userId), eq(contentPlanItemsTable.status, "draft")));

          if (drafts.length === 0) return;

          const draftIdSet = new Set(drafts.map((d) => d.id));
          logger.info({ count: drafts.length }, "Auto-reanalyzing draft topics after strategy save");

          const scores = await reanalyzeTopicsWithStrategy(
            drafts.map((d) => ({ id: d.id, topic: d.topic ?? "" })),
            strategyContext,
          );

          // Stale-job check: abort if a newer strategy has been saved while the
          // AI call was in flight, so that older results never overwrite fresher ones.
          const current = await getStrategyProfile(userId);
          if (current?.updated_at !== strategyVersion) {
            logger.info(
              { strategyVersion, currentVersion: current?.updated_at },
              "Stale reanalysis job discarded — strategy updated by a newer save",
            );
            return;
          }

          for (const score of scores) {
            // Skip any ID not in the original draft snapshot (hallucinated / changed status)
            if (!draftIdSet.has(score.id)) continue;

            await db
              .update(contentPlanItemsTable)
              .set({
                viralScore:             score.viral_score,
                editorialAngle:         score.editorial_angle,
                visualDependency:       score.visual_dependency,
                formatFitScore:         score.format_fit_score,
                avatarFitReason:        score.avatar_fit_reason,
                suggestedVisualSupport: score.suggested_visual_support.length > 0
                  ? JSON.stringify(score.suggested_visual_support)
                  : null,
                audiencePain:           score.audience_pain,
                shareReason:            score.share_reason,
              })
              // Double-guard: only touch rows still in draft status
              .where(and(
                eq(contentPlanItemsTable.id, score.id),
                eq(contentPlanItemsTable.status, "draft"),
              ));
          }

          logger.info({ updated: scores.length }, "Auto-reanalysis complete");
        } catch (bgErr) {
          logger.error({ err: bgErr }, "Background reanalysis after strategy save failed");
        }
      });
    }
  } catch (err: any) {
    logger.error({ err }, "Content strategy generation failed");
    res.status(500).json({ error: err?.message ?? "Strategy generation failed" });
  }
});

export default router;
