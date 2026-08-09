/**
 * Audit cache helpers — persist and retrieve the latest Instagram audit result
 * so it can feed topic generation and script writing without re-running the IG API.
 *
 * Strategy: we keep only ONE row in instagram_audit_cache (truncate + insert).
 * The cache is considered fresh for 7 days.
 */
import { db } from "@workspace/db";
import { instagramAuditCacheTable } from "@workspace/db";
import { desc } from "drizzle-orm";
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
 * Persist a fresh audit result. Replaces the previous cache entry.
 */
export async function saveAuditCache(data: AuditInsights): Promise<void> {
  try {
    // Delete all existing rows (we only need the most recent)
    await db.delete(instagramAuditCacheTable);
    await db.insert(instagramAuditCacheTable).values({
      recommendedTopics: data.recommendedTopics,
      contentInsights: data.contentInsights ?? null,
      topCaptionsJson: JSON.stringify(data.topCaptions),
      avgEngagement: data.avgEngagement,
      bestPostingTimes: data.bestPostingTimes,
      fetchedAt: new Date(),
    });
    logger.info("Instagram audit cache saved");
  } catch (err) {
    logger.warn({ err }, "Failed to save audit cache — non-fatal, generation will proceed without it");
  }
}

/**
 * Read the latest audit cache entry if it exists and is still fresh (< 7 days).
 * Returns null if no cache exists or if it is stale.
 */
export async function getLatestAuditCache(): Promise<AuditInsights | null> {
  try {
    const [row] = await db
      .select()
      .from(instagramAuditCacheTable)
      .orderBy(desc(instagramAuditCacheTable.fetchedAt))
      .limit(1);

    if (!row) return null;

    const ageMs = Date.now() - new Date(row.fetchedAt).getTime();
    if (ageMs > CACHE_TTL_MS) {
      logger.debug({ ageMs }, "Audit cache is stale — ignoring");
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
    logger.warn({ err }, "Failed to read audit cache — non-fatal");
    return null;
  }
}
