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

/**
 * Clone a voice from an audio buffer.
 * Returns the new voice_id assigned by HeyGen.
 * Cloning is typically async — poll listVoices until the ID appears.
 */
/**
 * Clone a voice using HeyGen v3 API.
 * @param audioUrl  Publicly accessible URL of the audio file (WAV/MP3/FLAC)
 * @param voiceName Display name for the cloned voice
 * @param apiKey    Optional HeyGen API key (falls back to env var)
 * @returns voice_clone_id — poll GET /v3/voices/{id} until status === "complete"
 */
export async function cloneVoice(
  audioUrl: string,
  voiceName: string,
  apiKey?: string,
): Promise<string> {
  const client = getClient(apiKey);
  try {
    const res = await client.post(
      "/v3/voices/clone",
      {
        audio: { type: "url", url: audioUrl },
        voice_name: voiceName,
        remove_background_noise: true,
      },
      { headers: { "Content-Type": "application/json" } },
    );
    const voiceCloneId: string =
      res.data?.data?.voice_clone_id ?? res.data?.voice_clone_id;
    if (!voiceCloneId)
      throw new Error("HeyGen no devolvió un voice_clone_id después de clonar");
    return voiceCloneId;
  } catch (err: any) {
    const heygenMsg =
      err?.response?.data?.error?.message ??
      err?.response?.data?.message ??
      err?.response?.data?.error ??
      err?.message;
    const status = err?.response?.status ?? "?";
    throw new Error(`HeyGen error ${status}: ${heygenMsg}`);
  }
}

/**
 * Delete a cloned voice by its voice_id.
 * Only works for voices created via clone — HeyGen rejects deletion of built-in voices.
 */
export async function deleteVoice(voiceId: string, apiKey?: string): Promise<void> {
  const client = getClient(apiKey);
  await client.delete(`/v2/voice/${encodeURIComponent(voiceId)}`);
}

/**
 * Rename a cloned voice (updates the display name in HeyGen).
 * If HeyGen does not support server-side rename, this is a no-op and
 * the caller should rely on the local display_name in heygen_cloned_voices.
 */
export async function renameVoice(
  voiceId: string,
  newName: string,
  apiKey?: string,
): Promise<void> {
  try {
    const client = getClient(apiKey);
    await client.patch(`/v2/voice/${encodeURIComponent(voiceId)}`, { name: newName });
  } catch {
    // HeyGen may not support rename — silently ignore; caller persists name in DB
  }
}

// ── Available avatar IDs cache ────────────────────────────────────────────────
// Rebuilt from HeyGen every 5 min.  Keyed with tp: prefix for photo looks so
// callers can compare directly against selectedAvatarIds stored in the DB.
//
// IMPORTANT: keyed by API key so that different users (with different HeyGen
// accounts) never share a cache entry — a shared global cache would cause
// User B's avatars to be pruned against User A's account.
const AVATAR_IDS_SENTINEL = "__default__";
const availableAvatarIdsCache = new Map<string, { ids: Set<string>; at: number }>();
const AVAILABLE_IDS_TTL = 5 * 60 * 1000;

/**
 * Return the full set of avatar/look IDs that currently exist in the user's
 * HeyGen account.  IDs follow the same convention as selectedAvatarIds in the
 * DB: photo-avatar looks are prefixed with "tp:", video-avatar looks are not.
 *
 * Result is cached for 5 minutes per API key to avoid spamming HeyGen on every cycle.
 * Pass forceRefresh=true to bypass the cache (e.g. after a confirmed deletion).
 */
export interface AvatarIdResult {
  /** All avatar IDs collected from the HeyGen account. */
  ids: Set<string>;
  /**
   * true  — every API call succeeded; the set is authoritative.
   * false — at least one call failed; the set may be missing IDs.
   *         Callers must NOT use this for destructive operations (e.g. pruning).
   */
  complete: boolean;
}

export async function getAllAvailableAvatarIds(
  apiKey?: string,
  forceRefresh = false,
): Promise<AvatarIdResult> {
  const cacheKey = apiKey ?? AVATAR_IDS_SENTINEL;
  const cached = availableAvatarIdsCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.at < AVAILABLE_IDS_TTL) {
    // Cached entries were only stored after a fully-successful fetch, so they
    // are always authoritative.
    return { ids: cached.ids, complete: true };
  }

  const ids = new Set<string>();
  try {
    const client = getClient(apiKey);

    // Standalone avatars (video avatars not part of a group)
    const avatarsRes = await client.get("/v2/avatars");
    for (const a of (avatarsRes.data?.data?.avatars ?? []) as HeyGenAvatar[]) {
      if (a.avatar_id) ids.add(a.avatar_id);
    }

    // Avatar groups + their looks (covers both video and photo avatar groups).
    // include_public: true is required — user's photo avatar (talking photo) groups
    // may be stored as public groups. Omitting public groups causes all tp: IDs to
    // be missing from the set, which makes pruneDeletedAvatars remove them all.
    const groupsRes = await client.get("/v2/avatar_group.list", { params: { include_public: true } });
    const groups: HeyGenAvatarGroup[] = groupsRes.data?.data?.avatar_group_list ?? [];

    const lookResults = await Promise.allSettled(
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

    const failedLooks = lookResults.filter((r) => r.status === "rejected");
    if (failedLooks.length > 0) {
      // One or more group-look fetches failed — the set is partial.
      // Do NOT cache it (next cycle will retry) and signal incompleteness so
      // callers skip any destructive operations.
      logger.warn(
        { failedGroups: failedLooks.length, totalGroups: groups.length, partialCount: ids.size },
        "[HeyGen] getAllAvailableAvatarIds: partial result — skipping cache update",
      );
      return { ids, complete: false };
    }

    // All fetches succeeded — cache and report as authoritative.
    availableAvatarIdsCache.set(cacheKey, { ids, at: Date.now() });
    logger.info({ count: ids.size }, "[HeyGen] Available avatar IDs refreshed");
    return { ids, complete: true };
  } catch (err) {
    logger.warn({ err }, "[HeyGen] getAllAvailableAvatarIds failed — keeping previous cache");
    // Network / auth error before we could collect anything useful.
    return { ids, complete: false };
  }
}

/** Invalidate the available-avatar-IDs cache for a given API key (call after a confirmed deletion). */
export function invalidateAvatarIdsCache(apiKey?: string): void {
  const cacheKey = apiKey ?? AVATAR_IDS_SENTINEL;
  availableAvatarIdsCache.delete(cacheKey);
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
/**
 * Expand written abbreviations that TTS voices read letter-by-letter,
 * sounding unnatural. This is a deterministic safety net — the AI prompt
 * already instructs the model to avoid them, but this catches any that slip.
 */
function expandAbbreviations(script: string, language?: string): string {
  const lang = (language ?? "es").toLowerCase().trim();
  const isEs = lang.startsWith("es") || lang === "español";
  const isEn = lang.startsWith("en") || lang === "english" || lang === "inglés";

  const replacements: [RegExp, string][] = isEs
    ? [
        // Tech / marketing — read as individual letters in Spanish TTS
        [/\bIA\b/g,        "inteligencia artificial"],
        [/\bAI\b/g,        "inteligencia artificial"],
        [/\bROI\b/g,       "retorno de inversión"],
        [/\bKPIs?\b/gi,    "indicadores clave"],
        [/\bCEO\b/g,       "director ejecutivo"],
        [/\bCMO\b/g,       "director de marketing"],
        [/\bCFO\b/g,       "director financiero"],
        [/\bCTO\b/g,       "director de tecnología"],
        [/\bCRM\b/g,       "gestión de clientes"],
        [/\bSaaS\b/gi,     "software como servicio"],
        [/\bB2B\b/g,       "negocio a negocio"],
        [/\bB2C\b/g,       "negocio a consumidor"],
        [/\bCTR\b/g,       "tasa de clics"],
        [/\bSEO\b/g,       "posicionamiento en buscadores"],
        [/\bSEM\b/g,       "marketing en buscadores"],
        [/\bCTA\b/g,       "llamada a la acción"],
        [/\bROAS\b/g,      "retorno en publicidad"],
        [/\bCPC\b/g,       "costo por clic"],
        [/\bCPM\b/g,       "costo por mil impresiones"],
        [/\bURLs?\b/g,     "enlaces"],
        // Written-only abbreviations that break TTS flow
        [/\betc\.\s*/g,    "etcétera "],
        [/\bvs\.\s*/g,     "versus "],
        [/\bp\.ej\.\s*/g,  "por ejemplo "],
        [/\bej\.\s*/g,     "por ejemplo "],
        [/\baprox\.\s*/g,  "aproximadamente "],
        [/\bUSD\b/g,       "dólares"],
        [/\bEUR\b/g,       "euros"],
        // Titles
        [/\bDr\.\s+/g,     "Doctor "],
        [/\bDra\.\s+/g,    "Doctora "],
        [/\bLic\.\s+/g,    "Licenciado "],
        [/\bSr\.\s+/g,     "Señor "],
        [/\bSra\.\s+/g,    "Señora "],
      ]
    : isEn
    ? [
        [/\bAI\b/g,        "artificial intelligence"],
        [/\bROI\b/g,       "return on investment"],
        [/\bKPIs?\b/gi,    "key performance indicators"],
        [/\bCEO\b/g,       "chief executive officer"],
        [/\bCMO\b/g,       "chief marketing officer"],
        [/\bCTO\b/g,       "chief technology officer"],
        [/\bCRM\b/g,       "customer relationship management"],
        [/\bSaaS\b/gi,     "software as a service"],
        [/\bB2B\b/g,       "business to business"],
        [/\bB2C\b/g,       "business to consumer"],
        [/\bCTR\b/g,       "click-through rate"],
        [/\bSEO\b/g,       "search engine optimization"],
        [/\bCTA\b/g,       "call to action"],
        [/\betc\.\s*/g,    "etcetera "],
        [/\bvs\.\s*/g,     "versus "],
        [/\bURLs?\b/g,     "links"],
      ]
    : [];

  return replacements.reduce((s, [pat, rep]) => s.replace(pat, rep), script);
}

export function normalizeScriptForTTS(script: string, language?: string): string {
  return expandAbbreviations(script, language)
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
  /**
   * BCP-47 language code or plain name ("es", "en", "español", etc.).
   * Used by normalizeScriptForTTS to expand abbreviations correctly.
   */
  language?: string;
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
  // avatar_v only supports digital_twin / video avatars — photo avatars (tp: prefix)
  // fail silently: HeyGen accepts the POST (returns a videoId) but then marks the
  // video as "failed" with error: null within ~60 s.  getLookSupportedEngines
  // incorrectly reports avatar_v as supported for photo avatar looks, so we must
  // exclude photo avatars explicitly.  avatar_iv with expressiveness: high is the
  // correct engine for photo avatars and produces quality results.
  const supportsAvatarV = !isPhotoAvatar && supportedEngines.includes("avatar_v");

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

  // Normalize script before sending: expands abbreviations (IA→inteligencia
  // artificial, ROI→retorno de inversión, etc.) and removes punctuation that
  // causes unnatural pauses in cloned voices (em-dashes, ellipsis, semicolons).
  const normalizedScript = normalizeScriptForTTS(params.script, params.language);

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
  const mapped = mapStatus(data?.status);
  // Log the full raw HeyGen response whenever a video fails so we can diagnose
  // future failures even when HeyGen omits the error field.
  if (mapped === "failed") {
    logger.error({ videoId, rawHeyGenData: data }, "[HeyGen] Video status: failed — full raw response");
  }
  return {
    video_id: videoId,
    status: mapped,
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

// ── v3 Avatar Groups ──────────────────────────────────────────────────────────

export interface HeyGenV3AvatarGroup {
  id: string;
  name: string;
  gender: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  looks_count: number;
  status: string | null;
  created_at: number | null;
}

/**
 * List avatar groups via GET /v3/avatars.
 * ownership: "public" | "private" | "all" (omit for all)
 * Uses cursor-based pagination with `token` / `next_token`.
 */
export async function listV3AvatarGroups(
  ownership: "public" | "private" | "all",
  token?: string,
  limit = 24,
  apiKey?: string,
): Promise<{ groups: HeyGenV3AvatarGroup[]; has_more: boolean; next_token: string | null }> {
  const client = getClient(apiKey);
  const params: Record<string, unknown> = { limit };
  if (ownership !== "all") params.ownership = ownership;
  if (token) params.token = token;

  const res = await client.get("/v3/avatars", { params, timeout: 20000 });
  const raw: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
  const groups: HeyGenV3AvatarGroup[] = raw.map((g: any) => ({
    id: g.id,
    name: g.name,
    gender: g.gender ?? null,
    preview_image_url: g.preview_image_url ?? null,
    preview_video_url: g.preview_video_url ?? null,
    looks_count: g.looks_count ?? 0,
    status: g.status ?? null,
    created_at: g.created_at ?? null,
  }));
  return {
    groups,
    has_more: res.data?.has_more ?? false,
    next_token: res.data?.next_token ?? null,
  };
}

// ── v3 Looks ──────────────────────────────────────────────────────────────────

export interface HeyGenV3Look {
  /** Internal ID — photo_avatar looks are prefixed with "tp:" by the route layer */
  id: string;
  name: string;
  avatar_type: "studio_avatar" | "digital_twin" | "photo_avatar" | string;
  group_id: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  status: string | null;
  supported_api_engines: string[];
  is_talking_photo: boolean;
}

/**
 * List looks for a group via GET /v3/avatars/looks?group_id=<id>.
 * Automatically normalises photo_avatar look IDs with the "tp:" prefix.
 */
export async function listV3GroupLooks(
  groupId: string,
  token?: string,
  apiKey?: string,
): Promise<{ looks: HeyGenV3Look[]; has_more: boolean; next_token: string | null }> {
  const client = getClient(apiKey);
  const params: Record<string, unknown> = { group_id: groupId, limit: 50 };
  if (token) params.token = token;

  const res = await client.get("/v3/avatars/looks", { params, timeout: 20000 });
  const raw: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
  const looks: HeyGenV3Look[] = raw.map((l: any) => {
    const isPhoto = l.avatar_type === "photo_avatar";
    return {
      id: isPhoto ? `tp:${l.id}` : l.id,
      name: l.name,
      avatar_type: l.avatar_type,
      group_id: l.group_id ?? null,
      preview_image_url: l.preview_image_url ?? null,
      preview_video_url: l.preview_video_url ?? null,
      status: l.status ?? null,
      supported_api_engines: l.supported_api_engines ?? [],
      is_talking_photo: isPhoto,
    };
  });
  return {
    looks,
    has_more: res.data?.has_more ?? false,
    next_token: res.data?.next_token ?? null,
  };
}

// ── Avatar creation ───────────────────────────────────────────────────────────

/**
 * Upload a file to HeyGen /v3/assets.
 * Returns { asset_id, url } to use in createPhotoAvatar().
 */
export async function uploadAsset(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
  apiKey?: string,
): Promise<{ asset_id: string; url: string }> {
  const key = apiKey ?? process.env.HEYGEN_API_KEY;
  if (!key) throw new Error("HEYGEN_API_KEY is not set");

  // Use native fetch + FormData (Node ≥18)
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  formData.append("file", blob, filename);

  const res = await fetch(`${HEYGEN_BASE_URL}/v3/assets`, {
    method: "POST",
    headers: { "x-api-key": key },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyGen asset upload failed: ${res.status} ${text}`);
  }

  const json: any = await res.json();
  const data = json?.data;
  if (!data?.asset_id) throw new Error("HeyGen did not return asset_id");
  return { asset_id: data.asset_id, url: data.url ?? "" };
}

/**
 * Create a photo avatar from an uploaded asset.
 * Returns { look_id, group_id } — poll getAvatarLookStatus() until status = "completed".
 */
export async function createPhotoAvatar(
  name: string,
  assetId: string,
  apiKey?: string,
): Promise<{ look_id: string; group_id: string }> {
  const client = getClient(apiKey);
  const res = await client.post(
    "/v3/avatars",
    { type: "photo", name, file: { type: "asset_id", asset_id: assetId } },
    { timeout: 30000 },
  );
  const data = res.data?.data;
  const look_id: string = data?.avatar_item?.id ?? data?.look_id;
  const group_id: string = data?.avatar_group?.id ?? data?.group_id;
  if (!look_id || !group_id) {
    logger.error({ data }, "[HeyGen] createPhotoAvatar: unexpected response shape");
    throw new Error("HeyGen did not return avatar IDs — check HeyGen account permissions");
  }
  return { look_id, group_id };
}

/**
 * Delete a single avatar look. Only photo_avatar and digital_twin types are supported.
 * Studio avatar (prompt-created) looks cannot be deleted via API.
 * Deleting the last look in a group also deletes the parent group automatically.
 */
export async function deleteAvatarLook(lookId: string, apiKey?: string): Promise<void> {
  const rawLookId = lookId.startsWith("tp:") ? lookId.slice(3) : lookId;
  const client = getClient(apiKey);
  const res = await client.delete(`/v3/avatars/looks/${rawLookId}`, { timeout: 15000 });
  if (res.status !== 200 && res.status !== 204) {
    const msg = res.data?.error?.message ?? `HeyGen returned ${res.status}`;
    throw new Error(msg);
  }
}

/**
 * Delete an entire avatar group and all its looks.
 * Cannot delete public or community groups.
 */
export async function deleteAvatarGroup(groupId: string, apiKey?: string): Promise<void> {
  const client = getClient(apiKey);
  const res = await client.delete(`/v3/avatars/${groupId}`, { timeout: 15000 });
  if (res.status !== 200 && res.status !== 204) {
    const msg = res.data?.error?.message ?? `HeyGen returned ${res.status}`;
    throw new Error(msg);
  }
}

/**
 * Generate a new look for an existing avatar group, conditioned on a reference look.
 * Uses POST /v3/avatars type:"prompt" with avatar_id (reference) + avatar_group_id (same group).
 * Returns { look_id, group_id } — poll getAvatarLookStatus() until status = "completed".
 */
export async function createAvatarLook(
  refLookId: string,    // existing look to condition appearance on (raw HeyGen ID, no tp: prefix)
  groupId: string,
  name: string,
  prompt: string,
  options?: {
    pose?: "half_body" | "close_up" | "full_body";
  },
  apiKey?: string,
): Promise<{ look_id: string; group_id: string }> {
  const rawLookId = refLookId.startsWith("tp:") ? refLookId.slice(3) : refLookId;
  const client = getClient(apiKey);
  const body: Record<string, unknown> = {
    type: "prompt",
    name,
    prompt,
    avatar_id: rawLookId,
    avatar_group_id: groupId,
    orientation: "vertical",
  };
  if (options?.pose) body.pose = options.pose;

  const res = await client.post("/v3/avatars", body, { timeout: 30000 });
  const data = res.data?.data;
  const look_id: string = data?.avatar_item?.id ?? data?.look_id;
  const look_group_id: string = data?.avatar_group?.id ?? data?.group_id;
  if (!look_id || !look_group_id) {
    logger.error({ data }, "[HeyGen] createAvatarLook: unexpected response shape");
    throw new Error("HeyGen did not return look IDs");
  }
  return { look_id, group_id: look_group_id };
}

/**
 * Create a prompt-based (AI-generated) avatar from a text description.
 * Uses HeyGen's Tokyo pipeline — no photo or video needed.
 * Returns { look_id, group_id } — poll getAvatarLookStatus() until status = "completed".
 */
export async function createPromptAvatar(
  name: string,
  prompt: string,
  options?: {
    orientation?: "vertical" | "horizontal" | "square";
    pose?: "half_body" | "close_up" | "full_body";
  },
  apiKey?: string,
): Promise<{ look_id: string; group_id: string }> {
  const client = getClient(apiKey);
  const body: Record<string, unknown> = { type: "prompt", name, prompt };
  if (options?.orientation) body.orientation = options.orientation;
  if (options?.pose) body.pose = options.pose;

  const res = await client.post("/v3/avatars", body, { timeout: 30000 });
  const data = res.data?.data;
  const look_id: string = data?.avatar_item?.id ?? data?.look_id;
  const group_id: string = data?.avatar_group?.id ?? data?.group_id;
  if (!look_id || !group_id) {
    logger.error({ data }, "[HeyGen] createPromptAvatar: unexpected response shape");
    throw new Error("HeyGen did not return avatar IDs — check permissions or prompt validity");
  }
  return { look_id, group_id };
}

/** Poll training status for a look via GET /v3/avatars/looks/{look_id}. */
export async function getAvatarLookStatus(
  lookId: string,
  apiKey?: string,
): Promise<{
  id: string;
  name: string;
  status: "processing" | "pending_consent" | "completed" | "failed" | null;
  avatar_type: string | null;
  group_id: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
}> {
  const client = getClient(apiKey);
  const res = await client.get(`/v3/avatars/looks/${lookId}`, { timeout: 15000 });
  const d = res.data?.data;
  return {
    id: d?.id ?? lookId,
    name: d?.name ?? "",
    status: d?.status ?? null,
    avatar_type: d?.avatar_type ?? null,
    group_id: d?.group_id ?? null,
    preview_image_url: d?.preview_image_url ?? null,
    preview_video_url: d?.preview_video_url ?? null,
  };
}
