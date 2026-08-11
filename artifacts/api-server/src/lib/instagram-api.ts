import axios from "axios";
import { logger } from "./logger";

const IG_GRAPH_BASE = "https://graph.instagram.com";
const IG_API_BASE = "https://api.instagram.com";

export function getAuthUrl(redirectUri: string, state?: string): string {
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) throw new Error("INSTAGRAM_APP_ID is not set");
  const scope = [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
  ].join(",");
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope,
    response_type: "code",
  });
  if (state) params.set("state", state);
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for a long-lived Instagram token.
 * Returns the token and its expiry date.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Instagram credentials not set");

  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await axios.post(`${IG_API_BASE}/oauth/access_token`, form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const shortToken: string = res.data?.access_token;
  if (!shortToken) throw new Error("Failed to get access token from Instagram");

  // Exchange short-lived token for long-lived (~60 days)
  const longRes = await axios.get(`${IG_GRAPH_BASE}/access_token`, {
    params: {
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: shortToken,
    },
  });

  const longToken: string = longRes.data?.access_token;
  if (!longToken) throw new Error("Failed to get long-lived token");

  // Meta returns expires_in in seconds; fall back to a conservative 60-day estimate
  const expiresInSec: number | undefined = longRes.data?.expires_in;
  const expiresAt = expiresInSec
    ? new Date(Date.now() + expiresInSec * 1000)
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  return { accessToken: longToken, expiresAt };
}

/**
 * Refresh a long-lived Instagram token using grant_type=ig_refresh_token.
 * Instagram allows refreshing tokens that have at least 1 day remaining.
 * Call when token_expires_at is within 30 days.
 * Throws if the token is already expired or Meta rejects the refresh.
 */
export async function refreshInstagramToken(
  accessToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await axios.get(`${IG_GRAPH_BASE}/refresh_access_token`, {
    params: {
      grant_type: "ig_refresh_token",
      access_token: accessToken,
    },
  });

  const newToken: string = res.data?.access_token;
  if (!newToken) throw new Error("Instagram refresh_access_token returned no token");

  const expiresInSec: number | undefined = res.data?.expires_in;
  const expiresAt = expiresInSec
    ? new Date(Date.now() + expiresInSec * 1000)
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  return { accessToken: newToken, expiresAt };
}

/**
 * Fetch basic account info.
 * account_type will be "BUSINESS", "MEDIA_CREATOR", or "PERSONAL".
 * Personal accounts cannot use instagram_business_* scopes.
 */
export async function getAccountInfo(accessToken: string) {
  const res = await axios.get(`${IG_GRAPH_BASE}/me`, {
    params: {
      fields: "id,username,name,profile_picture_url,followers_count,media_count,account_type",
      access_token: accessToken,
    },
  });
  return res.data;
}

export async function getMediaList(accessToken: string, userId: string, limit = 20) {
  const res = await axios.get(`${IG_GRAPH_BASE}/${userId}/media`, {
    params: {
      // thumbnail_url only exists for videos; media_url is the image itself for IMAGE/CAROUSEL_ALBUM
      fields: "id,media_type,media_url,thumbnail_url,permalink,caption,like_count,comments_count,timestamp",
      limit,
      access_token: accessToken,
    },
  });
  return res.data?.data ?? [];
}

// ── Typed insight result ────────────────────────────────────────────────────
export type InsightErrorType =
  | "token_expired"      // 401 / igCode 190 — token expired or revoked
  | "permission_denied"  // 403 / igCode 10,200 — missing instagram_business_manage_insights
  | "rate_limited"       // 429 — transient; will recover on next cycle
  | "not_found"          // 404 — media too old for insights
  | "unknown";           // any other error

export type InsightResult = {
  values: Record<string, number>;
  error?: InsightErrorType;
};

/**
 * Fetch per-post insights from the Instagram Business API.
 *
 * Returns a typed result instead of silently swallowing errors.
 * Callers should inspect `.error` to distinguish between empty data
 * and a real problem (expired token, missing permission, rate limit).
 */
export async function getMediaInsights(
  accessToken: string,
  mediaId: string,
  _mediaType: string,
): Promise<InsightResult> {
  // Both video and image types use the same available metrics in the current IG API
  const metrics = "reach,views,likes,comments,saved";
  try {
    const res = await axios.get(`${IG_GRAPH_BASE}/${mediaId}/insights`, {
      params: { metric: metrics, access_token: accessToken },
    });
    const values: Record<string, number> = {};
    for (const item of res.data?.data ?? []) {
      values[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
    }
    return { values };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const igCode: number | undefined = err.response?.data?.error?.code;
      const igMessage: string = err.response?.data?.error?.message ?? "unknown";

      if (status === 401 || igCode === 190 || igCode === 102) {
        logger.warn({ mediaId, status, igCode, igMessage }, "[IG/Insights] Token expired or invalid — account needs reconnection");
        return { values: {}, error: "token_expired" };
      }
      if (status === 403 || igCode === 10 || igCode === 200 || igCode === 230) {
        logger.warn({ mediaId, status, igCode, igMessage }, "[IG/Insights] Permission denied — verify instagram_business_manage_insights scope");
        return { values: {}, error: "permission_denied" };
      }
      if (status === 429) {
        logger.warn({ mediaId, status }, "[IG/Insights] Rate limited by Instagram — will recover on next cycle");
        return { values: {}, error: "rate_limited" };
      }
      if (status === 404) {
        logger.info({ mediaId }, "[IG/Insights] Media not found — may be too old for insights (>2 years)");
        return { values: {}, error: "not_found" };
      }
      logger.warn({ mediaId, status, igCode, igMessage }, "[IG/Insights] Unexpected error from Instagram API");
      return { values: {}, error: "unknown" };
    }
    logger.warn({ mediaId, err }, "[IG/Insights] Network or unexpected error fetching insights");
    return { values: {}, error: "unknown" };
  }
}

/** Extract a human-readable message from an Instagram Graph API axios error */
function igError(err: unknown, fallback: string): Error {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    // Instagram wraps errors as { error: { message, code, type } }
    const igMsg: string | undefined = data?.error?.message;
    if (igMsg) return new Error(`Instagram: ${igMsg}`);
    // Fallback: raw status
    const status = err.response?.status;
    if (status) return new Error(`${fallback} (HTTP ${status})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function createReelContainer(
  accessToken: string,
  userId: string,
  videoUrl: string,
  caption: string,
  coverUrl?: string | null
): Promise<string> {
  try {
    const params: Record<string, string> = {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      access_token: accessToken,
    };
    if (coverUrl) params.cover_url = coverUrl;
    const res = await axios.post(`${IG_GRAPH_BASE}/${userId}/media`, null, { params });
    const creationId: string = res.data?.id;
    if (!creationId) throw new Error("Failed to create media container");
    return creationId;
  } catch (err) {
    throw igError(err, "Error al crear el contenedor de video en Instagram");
  }
}

export async function checkContainerStatus(accessToken: string, containerId: string): Promise<string> {
  try {
    const res = await axios.get(`${IG_GRAPH_BASE}/${containerId}`, {
      params: { fields: "status_code,status", access_token: accessToken },
    });
    return res.data?.status_code ?? "IN_PROGRESS";
  } catch (err) {
    throw igError(err, "Error al verificar el estado del contenedor");
  }
}

export async function publishContainer(
  accessToken: string,
  userId: string,
  creationId: string
): Promise<string> {
  try {
    const res = await axios.post(`${IG_GRAPH_BASE}/${userId}/media_publish`, null, {
      params: { creation_id: creationId, access_token: accessToken },
    });
    const mediaId: string = res.data?.id;
    if (!mediaId) throw new Error("Failed to publish container");
    return mediaId;
  } catch (err) {
    throw igError(err, "Error al publicar en Instagram");
  }
}

export async function getPermalink(accessToken: string, mediaId: string): Promise<string | null> {
  try {
    const res = await axios.get(`${IG_GRAPH_BASE}/${mediaId}`, {
      params: { fields: "permalink", access_token: accessToken },
    });
    return res.data?.permalink ?? null;
  } catch {
    return null;
  }
}
