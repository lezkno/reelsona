import axios from "axios";
import { logger } from "./logger";

const HEYGEN_BASE_URL = "https://api.heygen.com";

function getClient(apiKey?: string) {
  const key = apiKey ?? process.env.HEYGEN_API_KEY;
  if (!key) throw new Error("HEYGEN_API_KEY is not set");
  return axios.create({
    baseURL: HEYGEN_BASE_URL,
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    timeout: 15000,
  });
}

export interface HeyGenQuota {
  remaining: number | null;
  total: number | null;
  /** Breakdown by credit type from /v2/user/remaining_quota details */
  details: {
    api: number | null;
    generative_credit: number | null;
    plan_credit: number | null;
    instant_avatars: number | null;
  } | null;
}

/**
 * Fetch remaining API credits from GET /v2/user/remaining_quota.
 * Response: { data: { remaining_quota, details: { api, generative_credit, plan_credit, instant_avatars } } }
 */
export async function getHeyGenQuota(apiKey: string): Promise<HeyGenQuota> {
  try {
    const client = getClient(apiKey);
    const res = await client.get("/v2/user/remaining_quota");
    const data = res.data?.data ?? {};
    const remaining = typeof data.remaining_quota === "number" ? data.remaining_quota : null;
    const d = data.details ?? {};
    return {
      remaining,
      total: null, // HeyGen doesn't expose plan total
      details: {
        api: typeof d.api === "number" ? d.api : null,
        generative_credit: typeof d.generative_credit === "number" ? d.generative_credit : null,
        plan_credit: typeof d.plan_credit === "number" ? d.plan_credit : null,
        instant_avatars: typeof d.instant_avatars === "number" ? d.instant_avatars : null,
      },
    };
  } catch (err: any) {
    logger.warn({ err: String(err) }, "Failed to fetch HeyGen quota");
    return { remaining: null, total: null, details: null };
  }
}

/**
 * Validate a HeyGen API key.
 * Uses GET /v2/avatars — returns HTTP 200 for valid keys, 401 for invalid ones.
 */
export async function validateHeyGenKey(apiKey: string): Promise<boolean> {
  try {
    const client = getClient(apiKey);
    const res = await client.get("/v2/avatars");
    // Valid key → 200; error field is null
    return res.status === 200 && !res.data?.error?.message?.toLowerCase().includes("unauthorized");
  } catch (err: any) {
    // axios throws on 4xx/5xx — 401 means invalid key
    if (err?.response?.status === 401) return false;
    logger.warn({ err: String(err) }, "HeyGen key validation request failed");
    return false;
  }
}

export interface HeyGenAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url?: string | null;
  preview_video_url?: string | null;
  gender?: string | null;
}

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  language: string;
  gender?: string | null;
  preview_audio_url?: string | null;
  is_clone?: boolean;
}

export async function listAvatars(apiKey?: string): Promise<HeyGenAvatar[]> {
  const client = getClient(apiKey);
  const res = await client.get("/v2/avatars");
  const avatars: HeyGenAvatar[] = res.data?.data?.avatars ?? [];
  return avatars;
}

export interface HeyGenAvatarGroup {
  id: string;
  name: string;
  group_type: string;
  num_looks: number;
  preview_image: string | null;
}

export interface HeyGenGroupLook {
  id: string;
  name: string;
  image_url: string | null;
  motion_preview_url?: string | null;
}

export async function listAvatarGroups(apiKey?: string): Promise<HeyGenAvatarGroup[]> {
  const client = getClient(apiKey);
  const res = await client.get("/v2/avatar_group.list", { params: { include_public: false } });
  return res.data?.data?.avatar_group_list ?? [];
}

export async function listGroupLooks(groupId: string, apiKey?: string): Promise<HeyGenGroupLook[]> {
  const client = getClient(apiKey);
  const res = await client.get(`/v2/avatar_group/${groupId}/avatars`);
  return res.data?.data?.avatar_list ?? [];
}

// ── Avatar preview image lookup ───────────────────────────────────────────────
// Cache: avatarId → { url | null, fetched at }. TTL 10 min.
const avatarImageCache = new Map<string, { url: string | null; at: number }>();
const AVATAR_IMAGE_TTL = 10 * 60 * 1000;

/**
 * Resolve the clean preview photo for a given HeyGen avatar / look ID.
 *
 * Search order:
 *   1. In-memory cache (10 min TTL)
 *   2. GET /v2/avatars — covers standalone avatars
 *   3. GET /v2/avatar_group.list + group avatars — covers looks inside groups
 *
 * Returns null on any error or when the ID is not found, so callers can fall
 * back gracefully (e.g. to the video thumbnail frame).
 */
export async function fetchAvatarPreviewImage(
  avatarId: string,
  apiKey?: string,
): Promise<string | null> {
  // 1. Cache hit
  const cached = avatarImageCache.get(avatarId);
  if (cached && Date.now() - cached.at < AVATAR_IMAGE_TTL) return cached.url;

  try {
    const client = getClient(apiKey);

    // 2. Standalone avatars
    const avatarsRes = await client.get("/v2/avatars");
    const avatars: HeyGenAvatar[] = avatarsRes.data?.data?.avatars ?? [];
    const match = avatars.find((a) => a.avatar_id === avatarId);
    if (match?.preview_image_url) {
      avatarImageCache.set(avatarId, { url: match.preview_image_url, at: Date.now() });
      return match.preview_image_url;
    }

    // 3. Avatar groups + their looks (includes both video avatars and talking photos)
    const groupsRes = await client.get("/v2/avatar_group.list", { params: { include_public: false } });
    const groups: HeyGenAvatarGroup[] = groupsRes.data?.data?.avatar_group_list ?? [];
    for (const group of groups) {
      const looksRes = await client.get(`/v2/avatar_group/${group.id}/avatars`);
      const looks: any[] = looksRes.data?.data?.avatar_list ?? [];
      // Video avatar looks: matched by l.avatar_id === avatarId
      // Talking photo looks: stored internally as "tp:<id>"; match by tp:${l.id} === avatarId
      const lookMatch = looks.find((l: any) =>
        l.avatar_id === avatarId || (l.id && `tp:${l.id}` === avatarId)
      );
      if (lookMatch) {
        // Video avatar looks: preview_image_url / preview_image
        // Talking photo looks: image_url
        const url: string | null =
          lookMatch.preview_image_url ?? lookMatch.preview_image ?? lookMatch.image_url ?? null;
        avatarImageCache.set(avatarId, { url, at: Date.now() });
        return url;
      }
    }

    // Not found anywhere
    avatarImageCache.set(avatarId, { url: null, at: Date.now() });
    return null;
  } catch (err) {
    logger.warn({ avatarId, err }, "[HeyGen] fetchAvatarPreviewImage failed");
    return null;
  }
}

// Map of look/avatar id (including tp: prefix) -> its group's default voice in HeyGen
let defaultVoiceMap: { map: Map<string, string>; at: number } | null = null;

export async function getAvatarDefaultVoiceId(avatarId: string, apiKey?: string): Promise<string | null> {
  if (!defaultVoiceMap || Date.now() - defaultVoiceMap.at > 10 * 60 * 1000) {
    const client = getClient(apiKey);
    const res = await client.get("/v2/avatar_group.list", { params: { include_public: false } });
    const groups: any[] = res.data?.data?.avatar_group_list ?? [];
    const map = new Map<string, string>();
    const results = await Promise.allSettled(
      groups.map(async (g) => {
        if (!g.default_voice_id) return;
        const looks = await listGroupLooks(g.id, apiKey);
        for (const l of looks as any[]) {
          if (l.avatar_id) map.set(l.avatar_id, g.default_voice_id);
          else if (l.id) map.set(`tp:${l.id}`, g.default_voice_id);
        }
      })
    );
    if (results.some((r) => r.status === "rejected") && defaultVoiceMap) {
      // Partial refresh: keep the previous complete map
    } else {
      defaultVoiceMap = { map, at: Date.now() };
    }
  }
  return defaultVoiceMap?.map.get(avatarId) ?? null;
}

export async function listVoices(apiKey?: string): Promise<HeyGenVoice[]> {
  const client = getClient(apiKey);
  const res = await client.get("/v2/voices");
  const voices: HeyGenVoice[] = res.data?.data?.voices ?? [];
  return voices;
}

// ── Available avatar IDs cache ────────────────────────────────────────────────
// Rebuilt from HeyGen every 5 min.  Keyed with tp: prefix for photo looks so
// callers can compare directly against selectedAvatarIds stored in the DB.
let availableAvatarIdsCache: { ids: Set<string>; at: number } | null = null;
const AVAILABLE_IDS_TTL = 5 * 60 * 1000;

/**
 * Return the full set of avatar/look IDs that currently exist in the user's
 * HeyGen account.  IDs follow the same convention as selectedAvatarIds in the
 * DB: photo-avatar looks are prefixed with "tp:", video-avatar looks are not.
 *
 * Result is cached for 5 minutes to avoid spamming HeyGen on every cycle.
 * Pass forceRefresh=true to bypass the cache (e.g. after a confirmed deletion).
 */
export async function getAllAvailableAvatarIds(
  apiKey?: string,
  forceRefresh = false,
): Promise<Set<string>> {
  if (!forceRefresh && availableAvatarIdsCache && Date.now() - availableAvatarIdsCache.at < AVAILABLE_IDS_TTL) {
    return availableAvatarIdsCache.ids;
  }

  const ids = new Set<string>();
  try {
    const client = getClient(apiKey);

    // Standalone avatars (video avatars not part of a group)
    const avatarsRes = await client.get("/v2/avatars");
    for (const a of (avatarsRes.data?.data?.avatars ?? []) as HeyGenAvatar[]) {
      if (a.avatar_id) ids.add(a.avatar_id);
    }

    // Avatar groups + their looks (covers both video and photo avatar groups)
    const groupsRes = await client.get("/v2/avatar_group.list", { params: { include_public: false } });
    const groups: HeyGenAvatarGroup[] = groupsRes.data?.data?.avatar_group_list ?? [];

    await Promise.allSettled(
      groups.map(async (group) => {
        const looksRes = await client.get(`/v2/avatar_group/${group.id}/avatars`);
        const looks: Record<string, unknown>[] = looksRes.data?.data?.avatar_list ?? [];
        const isPhoto =
          group.group_type === "PHOTO" || group.group_type === "GENERATED_PHOTO";
        for (const look of looks) {
          if (isPhoto) {
            if (look["id"]) ids.add(`tp:${look["id"]}`);
          } else {
            // Video avatar looks: prefer avatar_id, fall back to id
            if (look["avatar_id"]) ids.add(look["avatar_id"] as string);
            else if (look["id"]) ids.add(look["id"] as string);
          }
        }
      })
    );

    availableAvatarIdsCache = { ids, at: Date.now() };
    logger.info({ count: ids.size }, "[HeyGen] Available avatar IDs refreshed");
  } catch (err) {
    logger.warn({ err }, "[HeyGen] getAllAvailableAvatarIds failed — keeping previous cache");
    // Return whatever we collected so far (partial set preferred over nothing)
  }
  return ids;
}

/** Invalidate the available-avatar-IDs cache (call after a confirmed deletion). */
export function invalidateAvatarIdsCache(): void {
  availableAvatarIdsCache = null;
}

// Cache look engine eligibility for 30 minutes to avoid hammering the API
const lookEngineCache = new Map<string, { engines: string[]; at: number }>();

/**
 * Fetch the engines a specific look supports.
 * Returns ["avatar_iv"] as a safe fallback on error.
 */
export async function getLookSupportedEngines(lookId: string, apiKey?: string): Promise<string[]> {
  const cached = lookEngineCache.get(lookId);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.engines;

  try {
    const client = getClient(apiKey);
    const res = await client.get(`/v3/avatars/looks/${lookId}`);
    const engines: string[] = res.data?.data?.supported_api_engines ?? ["avatar_iv"];
    lookEngineCache.set(lookId, { engines, at: Date.now() });
    return engines;
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: unknown } };
    const status = axiosErr.response?.status;
    // 404 means the look/avatar was deleted from the HeyGen account — fail fast
    // instead of silently falling back and sending an invalid avatar to /v3/videos.
    if (status === 404) {
      logger.error({ lookId, status }, "[HeyGen] Look not found (404) — avatar may have been deleted from HeyGen account");
      throw new Error(`HeyGen avatar not found (${lookId}) — it may have been deleted from your HeyGen account`);
    }
    logger.warn({ err, lookId }, "[HeyGen] Could not fetch look engines — defaulting to avatar_iv");
    return ["avatar_iv"];
  }
}

/**
 * Normalize a script for HeyGen TTS to avoid common Spanish (and general)
 * pronunciation / pause artefacts caused by certain punctuation:
 *
 *  — em-dash  →  ", "   (prevents harsh abrupt stops)
 *  ...        →  ","    (prevents over-long pause)
 *  ;          →  ","    (semicolons cause odd rhythm breaks in cloned voices)
 *  \n         →  " "    (line-breaks create unintended pauses)
 *  multi-space → " "
 */
export function normalizeScriptForTTS(script: string): string {
  return script
    .replace(/ — /g, ", ")
    .replace(/—/g, ", ")
    .replace(/\.\.\./g, ",")
    .replace(/…/g, ",")
    .replace(/;/g, ",")
    .replace(/\n+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

export interface GenerateVideoParams {
  script: string;
  avatar_id: string;
  voice_id: string;
  title?: string;
  width?: number;
  height?: number;
  /** When true, instructs HeyGen to burn captions into the rendered video. */
  captionsEnabled?: boolean;
  /**
   * Natural-language prompt for Avatar V body motion / hand gestures.
   * Only sent when Avatar V is used.
   */
  motionPrompt?: string;
  /**
   * Voice speed multiplier. HeyGen default is 1.0.
   * Range 0.5–1.5. null/undefined → omit from payload (use HeyGen default).
   */
  voiceSpeed?: number | null;
}

export interface VideoStatus {
  video_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  video_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  error?: string | null;
  /** SRT subtitle file URL returned by HeyGen when caption was requested. */
  subtitle_url?: string | null;
}

/**
 * Generate a video via HeyGen API v3.
 *
 * v3 unifies all avatar types under a single "avatar" type — no more
 * talking_photo vs avatar split at the API level. The look ID is passed
 * directly as avatar_id (strip the "tp:" prefix we use internally to
 * track photo-avatar looks).
 *
 * Engine selection:
 *   - Video avatars (no tp: prefix, e.g. Yasser Lezcano looks): Avatar V engine
 *     → best possible lipsync, trained from recorded video footage.
 *   - Photo avatars (tp: prefix, digital twins / photo-based looks): Avatar IV
 *     engine (default) + expressiveness: "high" → most natural result for
 *     photo-based avatars without requiring video matting.
 */
export async function generateVideo(params: GenerateVideoParams, apiKey?: string): Promise<string> {
  const client = getClient(apiKey);

  // Strip our internal "tp:" marker — HeyGen v3 just wants the raw look ID
  const isPhotoAvatar = params.avatar_id.startsWith("tp:");
  const rawAvatarId = isPhotoAvatar ? params.avatar_id.slice(3) : params.avatar_id;

  // Dynamically check which engines this look supports.
  // Avatar V is available for both video avatars AND eligible digital_twin (photo) looks —
  // the tp: heuristic alone is not enough; we must check supported_api_engines per look.
  const supportedEngines = await getLookSupportedEngines(rawAvatarId, apiKey);
  const supportsAvatarV = supportedEngines.includes("avatar_v");

  logger.info(
    {
      avatarId: rawAvatarId,
      isPhotoAvatar,
      supportedEngines,
      engineChosen: supportsAvatarV ? "avatar_v" : "avatar_iv",
      voiceId: params.voice_id,
      scriptLength: params.script.length,
    },
    supportsAvatarV
      ? "[HeyGen v3] Avatar V eligible — using engine: avatar_v (highest fidelity lipsync + motion)"
      : "[HeyGen v3] Avatar IV — engine: avatar_iv, expressiveness: high"
  );

  // Normalize script punctuation before sending — removes em-dashes, ellipsis,
  // and semicolons that cause unnatural pauses in cloned Spanish voices.
  const normalizedScript = normalizeScriptForTTS(params.script);

  // v3 flat payload
  const payload: Record<string, unknown> = {
    type: "avatar",
    avatar_id: rawAvatarId,
    script: normalizedScript,
    voice_id: params.voice_id,
    aspect_ratio: "9:16",
    title: params.title ?? "ContentPilot Video",
  };

  // Only include voice_speed when explicitly set — avoids overriding HeyGen's
  // per-voice default for users who haven't configured it.
  if (params.voiceSpeed != null) {
    payload["voice_speed"] = params.voiceSpeed;
  }

  if (supportsAvatarV) {
    // Avatar V: highest-fidelity lipsync + cross-reference animation.
    // Supported avatar types: digital_twin only (NOT Photo Avatar).
    // Supports motion_prompt; does NOT support expressiveness.
    payload["engine"] = { type: "avatar_v" };
    if (params.motionPrompt) payload["motion_prompt"] = params.motionPrompt;
  } else {
    // Avatar IV (default): broad coverage — digital_twin, Photo Avatar, Studio Avatar.
    // expressiveness: high gives the most natural result for photo-based looks.
    // Also supports motion_prompt (natural-language body/gesture control).
    payload["expressiveness"] = "high";
    if (params.motionPrompt) payload["motion_prompt"] = params.motionPrompt;
  }

  if (params.captionsEnabled) {
    // Request a sidecar SRT file from HeyGen (NO style = captions are NOT burned
    // in by HeyGen — we download the SRT and burn styled captions ourselves via
    // Caption Studio + FFmpeg).
    payload["caption"] = { file_format: "srt" };
    logger.info("[HeyGen v3] Captions requested — HeyGen will return subtitle_url in status");
  }

  logger.info({ payload: { ...payload, script: `[${String(payload.script).length} chars]` } }, "[HeyGen v3] Sending POST /v3/videos");
  const res = await client.post("/v3/videos", payload).catch((err: unknown) => {
    // Axios throws on 4xx/5xx — extract HeyGen's error body for diagnosis
    const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    const heygenBody = axiosErr.response?.data;
    const heygenStatus = axiosErr.response?.status;
    logger.error(
      { heygenStatus, heygenBody, payload: { ...payload, script: `[${String(payload.script).length} chars]` } },
      "[HeyGen v3] POST /v3/videos failed"
    );
    const body = heygenBody as Record<string, unknown> | null | undefined;
    const heygenMsg =
      typeof body?.message === "string" ? body.message :
      typeof body?.error === "string"   ? body.error   :
      body != null                      ? JSON.stringify(body) :
      "unknown error";
    throw new Error(`HeyGen ${heygenStatus ?? "error"}: ${heygenMsg}`);
  });

  const videoId: string = res.data?.data?.id ?? res.data?.data?.video_id;
  if (!videoId) {
    logger.error({ response: res.data }, "HeyGen v3 did not return a video id");
    throw new Error("HeyGen did not return a video_id");
  }
  logger.info(
    { videoId, avatarType: isPhotoAvatar ? "photo_avatar" : "video_avatar" },
    "[HeyGen v3] Video generation started"
  );
  return videoId;
}

/**
 * Poll video status via HeyGen API v3 (GET /v3/videos/{video_id}).
 * Replaces the deprecated v1 video_status.get endpoint.
 */
export async function getVideoStatus(videoId: string, apiKey?: string): Promise<VideoStatus> {
  const client = getClient(apiKey);
  const res = await client.get(`/v3/videos/${videoId}`);
  const data = res.data?.data;
  return {
    video_id: videoId,
    status: mapStatus(data?.status),
    video_url: data?.video_url ?? null,
    thumbnail_url: data?.thumbnail_url ?? null,
    duration: data?.duration ?? null,
    error: data?.error?.message ?? data?.error ?? null,
    subtitle_url: data?.subtitle_url ?? null,
  };
}

function mapStatus(s: string): VideoStatus["status"] {
  if (s === "completed") return "completed";
  if (s === "failed") return "failed";
  if (s === "processing") return "processing";
  return "pending";
}
