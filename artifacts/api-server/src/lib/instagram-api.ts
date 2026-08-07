import axios from "axios";

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

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
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

  // Exchange for long-lived token
  const longRes = await axios.get(`${IG_GRAPH_BASE}/access_token`, {
    params: {
      grant_type: "ig_exchange_token",
      client_secret: appSecret,
      access_token: shortToken,
    },
  });

  const longToken: string = longRes.data?.access_token;
  if (!longToken) throw new Error("Failed to get long-lived token");
  return longToken;
}

export async function getAccountInfo(accessToken: string) {
  const res = await axios.get(`${IG_GRAPH_BASE}/me`, {
    params: {
      fields: "id,username,name,profile_picture_url,followers_count,media_count",
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

export async function getMediaInsights(accessToken: string, mediaId: string, mediaType: string) {
  // Note: "plays" and (for reels) "impressions" were removed from the IG API.
  // "views" replaces plays; "saved" counts saves.
  const metrics =
    mediaType === "VIDEO" || mediaType === "REELS"
      ? "reach,views,likes,comments,saved"
      : "reach,views,likes,comments,saved";
  try {
    const res = await axios.get(`${IG_GRAPH_BASE}/${mediaId}/insights`, {
      params: { metric: metrics, access_token: accessToken },
    });
    const values: Record<string, number> = {};
    for (const item of res.data?.data ?? []) {
      values[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
    }
    return values;
  } catch {
    return {};
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
  caption: string
): Promise<string> {
  try {
    const res = await axios.post(`${IG_GRAPH_BASE}/${userId}/media`, null, {
      params: {
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        access_token: accessToken,
      },
    });
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
