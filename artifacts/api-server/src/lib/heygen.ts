import axios from "axios";
import { logger } from "./logger";

const HEYGEN_BASE_URL = "https://api.heygen.com";

function getClient() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY is not set");
  return axios.create({
    baseURL: HEYGEN_BASE_URL,
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
  });
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

export async function listAvatars(): Promise<HeyGenAvatar[]> {
  const client = getClient();
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

export async function listAvatarGroups(): Promise<HeyGenAvatarGroup[]> {
  const client = getClient();
  const res = await client.get("/v2/avatar_group.list", { params: { include_public: false } });
  return res.data?.data?.avatar_group_list ?? [];
}

export async function listGroupLooks(groupId: string): Promise<HeyGenGroupLook[]> {
  const client = getClient();
  const res = await client.get(`/v2/avatar_group/${groupId}/avatars`);
  return res.data?.data?.avatar_list ?? [];
}

// Map of look/avatar id (including tp: prefix) -> its group's default voice in HeyGen
let defaultVoiceMap: { map: Map<string, string>; at: number } | null = null;

export async function getAvatarDefaultVoiceId(avatarId: string): Promise<string | null> {
  if (!defaultVoiceMap || Date.now() - defaultVoiceMap.at > 10 * 60 * 1000) {
    const client = getClient();
    const res = await client.get("/v2/avatar_group.list", { params: { include_public: false } });
    const groups: any[] = res.data?.data?.avatar_group_list ?? [];
    const map = new Map<string, string>();
    const results = await Promise.allSettled(
      groups.map(async (g) => {
        if (!g.default_voice_id) return;
        const looks = await listGroupLooks(g.id);
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

export async function listVoices(): Promise<HeyGenVoice[]> {
  const client = getClient();
  const res = await client.get("/v2/voices");
  const voices: HeyGenVoice[] = res.data?.data?.voices ?? [];
  return voices;
}

// Cache look engine eligibility for 30 minutes to avoid hammering the API
const lookEngineCache = new Map<string, { engines: string[]; at: number }>();

/**
 * Fetch the engines a specific look supports.
 * Returns ["avatar_iv"] as a safe fallback on error.
 */
export async function getLookSupportedEngines(lookId: string): Promise<string[]> {
  const cached = lookEngineCache.get(lookId);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.engines;

  try {
    const client = getClient();
    const res = await client.get(`/v3/avatars/looks/${lookId}`);
    const engines: string[] = res.data?.data?.supported_api_engines ?? ["avatar_iv"];
    lookEngineCache.set(lookId, { engines, at: Date.now() });
    return engines;
  } catch (err) {
    logger.warn({ err, lookId }, "[HeyGen] Could not fetch look engines — defaulting to avatar_iv");
    return ["avatar_iv"];
  }
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
export async function generateVideo(params: GenerateVideoParams): Promise<string> {
  const client = getClient();

  // Strip our internal "tp:" marker — HeyGen v3 just wants the raw look ID
  const isPhotoAvatar = params.avatar_id.startsWith("tp:");
  const rawAvatarId = isPhotoAvatar ? params.avatar_id.slice(3) : params.avatar_id;

  // Dynamically check which engines this look supports.
  // Avatar V is available for both video avatars AND eligible digital_twin (photo) looks —
  // the tp: heuristic alone is not enough; we must check supported_api_engines per look.
  const supportedEngines = await getLookSupportedEngines(rawAvatarId);
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

  // v3 flat payload
  const payload: Record<string, unknown> = {
    type: "avatar",
    avatar_id: rawAvatarId,
    script: params.script,
    voice_id: params.voice_id,
    aspect_ratio: "9:16",
    title: params.title ?? "ContentPilot Video",
  };

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

  const res = await client.post("/v3/videos", payload);
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
export async function getVideoStatus(videoId: string): Promise<VideoStatus> {
  const client = getClient();
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
