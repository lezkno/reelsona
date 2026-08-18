import axios from "axios";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { decryptInstagramToken, encryptInstagramToken } from "./instagram-token-crypto";

const IG_GRAPH_BASE = "https://graph.instagram.com";
const IG_API_BASE = "https://api.instagram.com";
const IG_HTTP_TIMEOUT_MS = 30_000;

// Instagram API with Instagram Login officially uses graph.instagram.com.
// Keep the host unversioned for this API family, but never allow a network call
// to hang the worker indefinitely.
const igHttp = axios.create({ timeout: IG_HTTP_TIMEOUT_MS });

// DB callers pass the token exactly as stored. New tokens are encrypted at rest,
// while legacy plaintext remains readable during the transition. Only the HTTP
// boundary ever receives plaintext.
igHttp.interceptors.request.use((config) => {
  const params = config.params as Record<string, unknown> | undefined;
  const storedToken = params?.access_token;
  if (typeof storedToken === "string" && storedToken) {
    config.params = { ...params, access_token: decryptInstagramToken(storedToken) };
  }
  return config;
});

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
 * Returns the encrypted-at-rest token and its expiry date. All API helpers in
 * this module transparently decrypt it only when making the outbound request.
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

  const res = await igHttp.post(`${IG_API_BASE}/oauth/access_token`, form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const shortToken: string = res.data?.access_token;
  if (!shortToken) throw new Error("Failed to get access token from Instagram");

  // Exchange short-lived token for long-lived (~60 days)
  const longRes = await igHttp.get(`${IG_GRAPH_BASE}/access_token`, {
    params: {
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: shortToken,
    },
  });

  const longToken: string = longRes.data?.access_token;
  if (!longToken) throw new Error("Failed to get long-lived token");

  const expiresInSec: number | undefined = longRes.data?.expires_in;
  const expiresAt = expiresInSec
    ? new Date(Date.now() + expiresInSec * 1000)
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  return { accessToken: encryptInstagramToken(longToken), expiresAt };
}

/** Refresh a long-lived Instagram token. Returned token remains encrypted at rest. */
export async function refreshInstagramToken(
  accessToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await igHttp.get(`${IG_GRAPH_BASE}/refresh_access_token`, {
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

  return { accessToken: encryptInstagramToken(newToken), expiresAt };
}

export async function getAccountInfo(accessToken: string) {
  const res = await igHttp.get(`${IG_GRAPH_BASE}/me`, {
    params: {
      fields: "id,username,name,profile_picture_url,followers_count,media_count,account_type",
      access_token: accessToken,
    },
  });
  return res.data;
}

export async function getMediaList(accessToken: string, userId: string, limit = 20) {
  const res = await igHttp.get(`${IG_GRAPH_BASE}/${userId}/media`, {
    params: {
      fields: "id,media_type,media_url,thumbnail_url,permalink,caption,like_count,comments_count,timestamp",
      limit,
      access_token: accessToken,
    },
  });
  return res.data?.data ?? [];
}

export type InsightErrorType =
  | "token_expired"
  | "permission_denied"
  | "rate_limited"
  | "not_found"
  | "unknown";

export type InsightResult = {
  values: Record<string, number>;
  error?: InsightErrorType;
};

export async function getMediaInsights(
  accessToken: string,
  mediaId: string,
  _mediaType: string,
): Promise<InsightResult> {
  const metrics = "reach,views,likes,comments,saved";
  try {
    const res = await igHttp.get(`${IG_GRAPH_BASE}/${mediaId}/insights`, {
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

function igError(err: unknown, fallback: string): Error {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    const igMsg: string | undefined = data?.error?.message;
    if (igMsg) return new Error(`Instagram: ${igMsg}`);
    const status = err.response?.status;
    if (status) return new Error(`${fallback} (HTTP ${status})`);
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      return new Error(`${fallback} (timeout)`);
    }
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
    const res = await igHttp.post(`${IG_GRAPH_BASE}/${userId}/media`, null, { params });
    const creationId: string = res.data?.id;
    if (!creationId) throw new Error("Failed to create media container");
    return creationId;
  } catch (err) {
    throw igError(err, "Error al crear el contenedor de video en Instagram");
  }
}

export async function checkContainerStatus(accessToken: string, containerId: string): Promise<string> {
  try {
    const res = await igHttp.get(`${IG_GRAPH_BASE}/${containerId}`, {
      params: { fields: "status_code,status", access_token: accessToken },
    });
    return res.data?.status_code ?? "IN_PROGRESS";
  } catch (err) {
    throw igError(err, "Error al verificar el estado del contenedor");
  }
}

type PublishAttemptRow = {
  creation_id: string;
  status: "attempting" | "confirmed" | "uncertain";
  media_id: string | null;
};

async function getPublishAttempt(creationId: string): Promise<PublishAttemptRow | null> {
  const result = await pool.query<PublishAttemptRow>(
    `SELECT creation_id, status, media_id
       FROM instagram_publish_attempts
      WHERE creation_id = $1`,
    [creationId],
  );
  return result.rows[0] ?? null;
}

export async function publishContainer(
  accessToken: string,
  userId: string,
  creationId: string
): Promise<string> {
  const existing = await getPublishAttempt(creationId);
  if (existing?.status === "confirmed" && existing.media_id) {
    logger.info({ creationId, mediaId: existing.media_id }, "[IG/Publish] Reusing confirmed publish result");
    return existing.media_id;
  }
  if (existing) {
    throw new Error(
      "Instagram: el resultado de una publicación anterior es incierto. " +
        "Reelsona bloqueó el reintento automático para evitar publicar el mismo Reel dos veces.",
    );
  }

  const claimed = await pool.query<{ creation_id: string }>(
    `INSERT INTO instagram_publish_attempts
       (creation_id, ig_user_id, status, attempted_at, updated_at)
     VALUES ($1, $2, 'attempting', NOW(), NOW())
     ON CONFLICT (creation_id) DO NOTHING
     RETURNING creation_id`,
    [creationId, userId],
  );

  if (!claimed.rowCount) {
    const raced = await getPublishAttempt(creationId);
    if (raced?.status === "confirmed" && raced.media_id) return raced.media_id;
    throw new Error(
      "Instagram: esta publicación ya está siendo procesada o su resultado es incierto; no se repetirá automáticamente.",
    );
  }

  try {
    const res = await igHttp.post(`${IG_GRAPH_BASE}/${userId}/media_publish`, null, {
      params: { creation_id: creationId, access_token: accessToken },
    });
    const mediaId: string = res.data?.id;
    if (!mediaId) throw new Error("Instagram media_publish returned no media id");

    await pool.query(
      `UPDATE instagram_publish_attempts
          SET status = 'confirmed', media_id = $2, last_error = NULL, updated_at = NOW()
        WHERE creation_id = $1`,
      [creationId, mediaId],
    );

    return mediaId;
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const deterministicClientError = status !== undefined && status >= 400 && status < 500;

    if (deterministicClientError) {
      await pool.query(
        "DELETE FROM instagram_publish_attempts WHERE creation_id = $1 AND status = 'attempting'",
        [creationId],
      ).catch((dbErr) => logger.error({ err: dbErr, creationId }, "[IG/Publish] Failed to release rejected publish claim"));
    } else {
      await pool.query(
        `UPDATE instagram_publish_attempts
            SET status = 'uncertain', last_error = $2, updated_at = NOW()
          WHERE creation_id = $1`,
        [creationId, err instanceof Error ? err.message : String(err)],
      ).catch((dbErr) => logger.error({ err: dbErr, creationId }, "[IG/Publish] Failed to persist uncertain publish outcome"));
    }

    throw igError(err, "Error al publicar en Instagram");
  }
}

export async function getPermalink(accessToken: string, mediaId: string): Promise<string | null> {
  try {
    const res = await igHttp.get(`${IG_GRAPH_BASE}/${mediaId}`, {
      params: { fields: "permalink", access_token: accessToken },
    });
    return res.data?.permalink ?? null;
  } catch {
    return null;
  }
}
