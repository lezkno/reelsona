/**
 * Apify integration for enriching niche radar accounts.
 * Uses the "apify/instagram-profile-scraper" Actor to fetch
 * real followers, bio, and top posts for a given IG username.
 */

import { logger } from "./logger";

export interface ApifyTopPost {
  url: string;
  caption: string | null;
  likesCount: number;
  commentsCount: number;
  timestamp: string | null;
  type: string | null;
}

export interface ApifyProfileData {
  username: string;
  fullName: string | null;
  biography: string | null;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  profilePicUrl: string | null;
  topPosts: ApifyTopPost[];
}

/**
 * Enrich an Instagram profile using the Apify instagram-profile-scraper Actor.
 * Returns null if APIFY_TOKEN is not configured or the run fails.
 */
export async function enrichProfileWithApify(
  igUsername: string
): Promise<ApifyProfileData | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    logger.warn("APIFY_TOKEN not set — skipping enrichment");
    return null;
  }

  const actorId = "apify~instagram-profile-scraper";
  const runUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=60`;

  try {
    logger.info({ igUsername }, "Starting Apify profile enrichment");

    const response = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [igUsername],
        resultsLimit: 6,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, "Apify run failed");
      return null;
    }

    const json: unknown = await response.json();
    if (!Array.isArray(json) || json.length === 0) {
      logger.warn({ igUsername }, "Apify returned no items");
      return null;
    }

    const items = json as any[];
    const item = items[0];

    const topPosts: ApifyTopPost[] = (item.latestPosts ?? [])
      .slice(0, 6)
      .map((p: any) => ({
        url: p.url ?? p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null,
        caption: p.caption?.substring(0, 300) ?? null,
        likesCount: p.likesCount ?? 0,
        commentsCount: p.commentsCount ?? 0,
        timestamp: p.timestamp ?? null,
        type: p.type ?? null,
      }));

    return {
      username: item.username ?? igUsername,
      fullName: item.fullName ?? null,
      biography: item.biography ?? null,
      followersCount: item.followersCount ?? null,
      followingCount: item.followingCount ?? null,
      postsCount: item.postsCount ?? null,
      profilePicUrl: item.profilePicUrl ?? null,
      topPosts,
    };
  } catch (err: any) {
    if (err?.name === "TimeoutError") {
      logger.warn({ igUsername }, "Apify run timed out");
    } else {
      logger.error({ err, igUsername }, "Apify enrichment error");
    }
    return null;
  }
}
