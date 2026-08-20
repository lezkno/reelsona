/**
 * Audit cache helpers — persist and retrieve the latest Instagram audit result
 * per Reelsona user so strategy data can never bleed across tenants.
 */
import { db } from "@workspace/db";
import { instagramAuditCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuditInsights {
  topCaptions: string[];
  recommendedTopics: string[];
  avgEngagement: number;
  bestPostingTimes: string[];
  contentInsights?: string;
}

/**
 * Persist a fresh audit result for one user.
 *
 * Backward-safety: callers that omit userId are ignored rather than writing a
 * global row. This intentionally fails closed until every caller is explicitly
 * tenant-scoped.
 */
export async function saveAuditCache(
  userId: number | AuditInsights,
  maybeData?: AuditInsights,
): Promise<void> {
  if (typeof userId !== "number" || !maybeData) {
    logger.warn("saveAuditCache called without userId — skipping unsafe global cache write");
    return;
  }

  const data = maybeData;
  try {
    await db
      .insert(instagramAuditCacheTable)
      .values({
        userId,
        recommendedTopics: data.recommendedTopics,
        contentInsights: data.contentInsights ?? null,
        topCaptionsJson: JSON.stringify(data.topCaptions),
        avgEngagement: data.avgEngagement,
        bestPostingTimes: data.bestPostingTimes,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: instagramAuditCacheTable.userId,
        set: {
          recommendedTopics: data.recommendedTopics,
          contentInsights: data.contentInsights ?? null,
          topCaptionsJson: JSON.stringify(data.topCaptions),
          avgEngagement: data.avgEngagement,
          bestPostingTimes: data.bestPostingTimes,
          fetchedAt: new Date(),
        },
      });
    logger.info({ userId }, "Instagram audit cache saved");
  } catch (err) {
    logger.warn({ err, userId }, "Failed to save audit cache — non-fatal, generation will proceed without it");
  }
}

/**
 * Read one user's latest audit cache entry if it is fresh (< 7 days).
 * Calls without userId deliberately return null to prevent cross-user data use.
 */
export async function getLatestAuditCache(userId?: number): Promise<AuditInsights | null> {
  if (!userId) {
    logger.debug("getLatestAuditCache called without userId — returning null for tenant safety");
    return null;
  }

  try {
    const [row] = await db
      .select()
      .from(instagramAuditCacheTable)
      .where(eq(instagramAuditCacheTable.userId, userId))
      .limit(1);

    if (!row) return null;

    const ageMs = Date.now() - new Date(row.fetchedAt).getTime();
    if (ageMs > CACHE_TTL_MS) {
      logger.debug({ userId, ageMs }, "Audit cache is stale — ignoring");
      return null;
    }

    let topCaptions: string[] = [];
    try {
      topCaptions = JSON.parse(row.topCaptionsJson) as string[];
    } catch {
      topCaptions = [];
    }

    return {
      topCaptions,
      recommendedTopics: row.recommendedTopics ?? [],
      avgEngagement: row.avgEngagement ?? 0,
      bestPostingTimes: row.bestPostingTimes ?? [],
      contentInsights: row.contentInsights ?? undefined,
    };
  } catch (err) {
    logger.warn({ err, userId }, "Failed to read audit cache — non-fatal");
    return null;
  }
}
