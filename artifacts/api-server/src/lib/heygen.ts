import axios from "axios";
import { createHash } from "crypto";
import { logger } from "./logger";
import { db } from "@workspace/db";
import { avatarLookMetadataTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const HEYGEN_BASE_URL = "https://api.heygen.com";

/**
 * Return an 8-char SHA-256 prefix of the API key so we can namespace per-account
 * in-memory caches without exposing the raw key anywhere in memory beyond getClient.
 */
function apiKeyPrefix(apiKey?: string): string {
  if (!apiKey) return "__default__";
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
}


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
 * Fetch remaining API credits from GET /v3/user/remaining_quota.
 * Response: { data: { remaining_quota, details: { api, generative_credit, plan_credit, instant_avatars } } }
 */
export async function getHeyGenQuota(apiKey: string): Promise<HeyGenQuota> {
  try {
    const client = getClient(apiKey);
    const res = await client.get("/v3/user/remaining_quota");
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
 * Uses GET /v3/user/remaining_quota — returns HTTP 200 for valid keys, 401 for invalid ones.
 */
export async function validateHeyGenKey(apiKey: string): Promise<boolean> {
  try {
    const client = getClient(apiKey);
    const res = await client.get("/v3/user/remaining_quota");
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

/**
 * List all avatars across all groups via the v3 API.
 * In v3 there are no "standalone" avatars — all are organized as looks within groups.
 * Returns a flattened list using the HeyGenAvatar shape for backward compat.
 */
export async function listAvatars(apiKey?: string): Promise<HeyGenAvatar[]> {
  try {
    const client = getClient(apiKey);
    const groupsRes = await client.get("/v3/avatars", { params: { limit: 50 } });
    const groups: any[] = Array.isArray(groupsRes.data?.data) ? groupsRes.data.data : [];
    const results = await Promise.allSettled(
      groups.map(async (g: any) => {
        const looksRes = await client.get("/v3/avatars/looks", { params: { group_id: g.id, limit: 50 } });
        const looks: any[] = Array.isArray(looksRes.data?.data) ? looksRes.data.data : [];
        return looks.map((l: any): HeyGenAvatar => ({
          avatar_id: l.avatar_type === "photo_avatar" ? `tp:${l.id}` : (l.id ?? ""),
          avatar_name: l.name ?? "",
          preview_image_url: l.preview_image_url ?? null,
          preview_video_url: l.preview_video_url ?? null,
          gender: l.gender ?? null,
        }));
      })
    );
    const avatars: HeyGenAvatar[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") avatars.push(...r.value);
    }
    return avatars;
  } catch (err) {
    logger.warn({ err }, "[HeyGen] listAvatars (v3) failed");
    return [];
  }
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

/** @deprecated Use listV3AvatarGroups() directly for new code. Kept for backward compat. */
export async function listAvatarGroups(apiKey?: string): Promise<HeyGenAvatarGroup[]> {
  const { groups } = await listV3AvatarGroups("private", undefined, 50, apiKey);
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    group_type: "UNKNOWN",
    num_looks: g.looks_count,
    preview_image: g.preview_image_url,
  }));
}

/** @deprecated Use listV3GroupLooks() directly for new code. Kept for backward compat. */
export async function listGroupLooks(groupId: string, apiKey?: string): Promise<HeyGenGroupLook[]> {
  const { looks } = await listV3GroupLooks(groupId, undefined, apiKey);
  return looks.map((l) => ({
    id: l.id,
    name: l.name,
    image_url: l.preview_image_url,
    motion_preview_url: l.preview_video_url ?? null,
  }));
}

// ── Avatar preview image lookup ───────────────────────────────────────────────
// Cache: "${apiKeyPrefix}:${avatarId}" → { url | null, fetched at }. TTL 10 min.
// Keyed by API-key prefix so different HeyGen accounts never share cached metadata.
const avatarImageCache = new Map<string, { url: string | null; at: number }>();
const AVATAR_IMAGE_TTL = 10 * 60 * 1000;

/**
 * Resolve the clean preview photo for a given HeyGen avatar / look ID.
 *
 * Search order:
 *   1. In-memory cache (10 min TTL)
 *   2. listAvatars() — v3-backed: fetches all groups + their looks via /v3/avatars
 *
 * Returns null on any error or when the ID is not found, so callers can fall
 * back gracefully (e.g. to the video thumbnail frame).
 */
export async function fetchAvatarPreviewImage(
  avatarId: string,
  apiKey?: string,
): Promise<string | null> {
  const ck = `${apiKeyPrefix(apiKey)}:${avatarId}`;
  // 1. Cache hit
  const cached = avatarImageCache.get(ck);
  if (cached && Date.now() - cached.at < AVATAR_IMAGE_TTL) return cached.url;

  try {
    // Search all avatars (v3-backed) for the matching ID and return its preview image.
    const avatars = await listAvatars(apiKey);
    const match = avatars.find((a) => a.avatar_id === avatarId);
    const url = match?.preview_image_url ?? null;
    avatarImageCache.set(ck, { url, at: Date.now() });
    return url;
  } catch (err) {
    logger.warn({ avatarId, err }, "[HeyGen] fetchAvatarPreviewImage failed");
    return null;
  }
}


// Per-API-key cache: avatarId → its group's default voice in HeyGen.
// Keyed by apiKeyPrefix so different accounts never share cached voice data.
const defaultVoiceMapByKey = new Map<string, { map: Map<string, string>; at: number }>();

export async function getAvatarDefaultVoiceId(avatarId: string, apiKey?: string): Promise<string | null> {
  const prefix = apiKeyPrefix(apiKey);
  const existing = defaultVoiceMapByKey.get(prefix);
  if (!existing || Date.now() - existing.at > 10 * 60 * 1000) {
    try {
      const client = getClient(apiKey);
      // v3: GET /v3/avatars — groups may optionally include default_voice_id
      const res = await client.get("/v3/avatars", { params: { limit: 50 } });
      const groups: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
      const map = new Map<string, string>();
      const results = await Promise.allSettled(
        groups.map(async (g: any) => {
          if (!g.default_voice_id) return;
          const looks = await listGroupLooks(g.id, apiKey);
          for (const l of looks) {
            // listGroupLooks() now returns normalized IDs (tp: prefix for photo avatars)
            if (l.id) map.set(l.id, g.default_voice_id);
          }
        })
      );
      if (results.some((r) => r.status === "rejected") && existing) {
        // Partial refresh: keep the previous complete map for this API key
      } else {
        defaultVoiceMapByKey.set(prefix, { map, at: Date.now() });
      }
    } catch (err) {
      logger.warn({ err }, "[HeyGen] getAvatarDefaultVoiceId v3 failed — defaulting to null");
    }
  }
  return defaultVoiceMapByKey.get(prefix)?.map.get(avatarId) ?? null;
}

/** Invalidate the per-account default-voice cache (e.g. after deleting a group). */
export function invalidateDefaultVoiceCache(apiKey?: string): void {
  defaultVoiceMapByKey.delete(apiKeyPrefix(apiKey));
}

export async function listVoices(apiKey?: string): Promise<HeyGenVoice[]> {
  const client = getClient(apiKey);
  const res = await client.get("/v3/voices");
  // v3 may return { data: { voices: [...] } } or { data: [...] }
  const voices: HeyGenVoice[] =
    res.data?.data?.voices ??
    (Array.isArray(res.data?.data) ? res.data.data : []);
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

export interface VoiceCloneStatus {
  /** HeyGen processing status for the clone job */
  status: "processing" | "complete" | "failed" | string;
  /**
   * The final usable voice_id once status === "complete".
   * May be identical to the voice_clone_id or a different ID assigned on completion.
   * Undefined while still processing.
   */
  voice_id?: string | null;
  /** Human-readable failure reason from HeyGen when status === "failed" */
  error?: string | null;
}

/**
 * Poll the status of a pending voice clone job.
 * Call with the `voice_clone_id` returned by `cloneVoice()`.
 * Returns `{ status, voice_id?, error? }`.
 *
 * Terminal statuses: "complete" (voice_id is usable) and "failed" (error is set).
 */
export async function getVoiceCloneStatus(
  voiceCloneId: string,
  apiKey?: string,
): Promise<VoiceCloneStatus> {
  const client = getClient(apiKey);
  try {
    const res = await client.get(`/v3/voices/${encodeURIComponent(voiceCloneId)}`);
    const data = res.data?.data ?? res.data ?? {};
    return {
      status: data.status ?? "processing",
      voice_id: data.voice_id ?? null,
      error: data.error ?? null,
    };
  } catch (err: any) {
    if (err?.response?.status === 404) {
      // Clone not found — mark as failed so the pipeline doesn't wait for it forever.
      // A 404 after cloning means HeyGen deleted or never persisted the job.
      logger.warn({ voiceCloneId }, "[VoiceCloneStatus] 404 from HeyGen — voice clone not found, marking as failed");
      return { status: "failed", error: "Voice clone not found in HeyGen account (404) — it may have been deleted" };
    }
    throw err;
  }
}


/**
 * Delete a cloned voice by its voice_id.
 * Only works for voices created via clone — HeyGen rejects deletion of built-in voices.
 */
export async function deleteVoice(voiceId: string, apiKey?: string): Promise<void> {
  const client = getClient(apiKey);
  await client.delete(`/v3/voices/${encodeURIComponent(voiceId)}`);
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
    await client.patch(`/v3/voices/${encodeURIComponent(voiceId)}`, { name: newName });
  } catch (err) {
    // HeyGen may not support server-side rename — log as warn so we can track drift.
    logger.warn({ err, voiceId, newName }, "[HeyGen] renameVoice failed — DB display_name and HeyGen name may diverge");
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

    // v3: GET /v3/avatars returns all avatar groups (both private and public).
    // Omitting ownership param returns all groups so photo avatar (talking photo)
    // groups are included — this prevents tp: IDs being missing and wrongly pruned.
    const groupsRes = await client.get("/v3/avatars", { params: { limit: 50 } });
    const groups: any[] = Array.isArray(groupsRes.data?.data) ? groupsRes.data.data : [];

    const lookResults = await Promise.allSettled(
      groups.map(async (group: any) => {
        // v3: GET /v3/avatars/looks?group_id=<id>
        const looksRes = await client.get("/v3/avatars/looks", {
          params: { group_id: group.id, limit: 50 },
        });
        const looks: any[] = Array.isArray(looksRes.data?.data) ? looksRes.data.data : [];
        for (const look of looks) {
          // v3 avatar_type identifies photo vs video avatars
          const isPhoto = look.avatar_type === "photo_avatar";
          if (isPhoto) {
            if (look.id) ids.add(`tp:${look.id}`);
          } else {
            if (look.id) ids.add(look.id);
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
    if (availableAvatarIdsCache.has(cacheKey)) {
      return { ids: availableAvatarIdsCache.get(cacheKey)!.ids, complete: false };
    }
    return { ids, complete: false };
  }
}

/** Invalidate the available-avatar-IDs cache for a given API key (call after a confirmed deletion). */
export function invalidateAvatarIdsCache(apiKey?: string): void {
  const cacheKey = apiKey ?? AVATAR_IDS_SENTINEL;
  availableAvatarIdsCache.delete(cacheKey);
}

// Cache look engine eligibility for 30 minutes to avoid hammering the API.
// Keyed by "${apiKeyPrefix}:${lookId}" so different HeyGen accounts never share cached engines.
const lookEngineCache = new Map<string, { engines: string[]; at: number }>();

/**
 * Fetch the engines a specific look supports.
 *
 * Error handling:
 *   - 404: throws — the look was deleted; sending it to /v3/videos would produce a misleading error.
 *   - 429: throws — HeyGen is rate-limiting us; generating at Avatar IV would waste a credit on a
 *           lower-quality video when a retry will succeed. Let the scheduler mark the item as failed
 *           so it retries next cycle.
 *   - 5xx / network: logs a warning with full context (status, body) and falls back to ["avatar_iv"].
 *           A transient HeyGen server error shouldn't block generation entirely, but the degradation
 *           is logged explicitly so operators can spot systematic issues.
 */
export async function getLookSupportedEngines(lookId: string, apiKey?: string): Promise<string[]> {
  const ck = `${apiKeyPrefix(apiKey)}:${lookId}`;
  const cached = lookEngineCache.get(ck);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.engines;

  try {
    const client = getClient(apiKey);
    const res = await client.get(`/v3/avatars/looks/${lookId}`);
    const engines: string[] = res.data?.data?.supported_api_engines ?? ["avatar_iv"];
    lookEngineCache.set(ck, { engines, at: Date.now() });
    return engines;
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
    const status = axiosErr.response?.status;
    const body   = axiosErr.response?.data;

    // 404 — look deleted; throw so the caller surfaces a clear error instead of
    // sending an invalid avatar_id to /v3/videos.
    if (status === 404) {
      logger.error({ lookId, status }, "[HeyGen] Look not found (404) — avatar may have been deleted from HeyGen account");
      throw new Error(`HeyGen avatar not found (${lookId}) — it may have been deleted from your HeyGen account`);
    }

    // 429 — rate limit; throw so the scheduler retries next cycle rather than spending
    // a credit on a lower-quality Avatar IV video.
    if (status === 429) {
      logger.warn({ lookId, status, body }, "[HeyGen] Rate limited while fetching look engines (429) — aborting generation to preserve credit quality; will retry next cycle");
      throw new Error(`HeyGen rate limit hit while checking engine support for look ${lookId} — generation deferred to next cycle`);
    }

    // 5xx or network error — transient; fall back to Avatar IV but log enough context
    // for operators to detect systematic problems.
    const isNetworkError = !status; // no response object = network-level failure
    logger.warn(
      { lookId, status: status ?? "no-response", body, message: axiosErr.message, isNetworkError },
      "[HeyGen] ⚠️  Could not fetch look engines — video will be generated with Avatar IV instead of Avatar V. " +
      "If this happens repeatedly, check HeyGen API availability or the API key quota."
    );
    return ["avatar_iv"];
  }
}


/** Clear engine + image caches for a single look. */
export function invalidateLookCacheEntries(lookId: string, apiKey?: string): void {
  const prefix = apiKeyPrefix(apiKey);
  const rawId = lookId.startsWith("tp:") ? lookId.slice(3) : lookId;
  lookEngineCache.delete(`${prefix}:${rawId}`);
  lookEngineCache.delete(`${prefix}:${lookId}`);
  avatarImageCache.delete(`${prefix}:${lookId}`);
  avatarImageCache.delete(`${prefix}:${rawId}`);
  defaultVoiceMapByKey.delete(prefix);
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
  /** When true, instructs HeyGen to return a sidecar SRT subtitle file. */

  captionsEnabled?: boolean;
  /**
   * Override the automatic Avatar V motion prompt.
   * Leave unset to use DEFAULT_AVATAR_V_MOTION_PROMPT.
   */

  motionPrompt?: string;
  /**
   * Voice speed multiplier applied via SSML <prosody rate>.
   * HeyGen v3 rejects voice_speed as a top-level param; SSML is the only way.
   * Range 0.5–1.5. null/undefined → omit (HeyGen default 1.0).
   */

  voiceSpeed?: number | null;
  /**
   * Voice pitch adjustment as a percentage offset applied via SSML <prosody pitch>.
   * Range -50 to +50 (%). null/0/undefined → omit (HeyGen default).
   */

  voicePitch?: number | null;
  /**
   * BCP-47 language code or plain name ("es", "en", "español", etc.).
   * Used by normalizeScriptForTTS to expand abbreviations correctly.
   */

  language?: string;
  /**
   * The requesting user's ID.  When provided, generateVideo queries
   * avatar_look_metadata to pass reference_look_id for Avatar V, which
   * stabilises identity and motion consistency across looks in the same group.
   */


  userId?: number;
}

/**
 * Wrap a TTS script in SSML <prosody> to apply speed and/or pitch adjustments.
 * HeyGen v3 rejects voice_speed / voice / voice_setting as payload params —
 * SSML <prosody rate pitch> is the correct mechanism for both.
 *
 * Speed mapping : multiplier 0.5–1.5  →  rate="-50%" … "+50%"
 * Pitch mapping : percentage -50…+50  →  pitch="-50%" … "+50%"
 */
function wrapWithProsody(script: string, speed?: number | null, pitch?: number | null): string {
  const hasSpeed = speed != null && Math.abs(speed - 1.0) > 0.01;
  const hasPitch = pitch != null && Math.abs(pitch) > 0.5;
  if (!hasSpeed && !hasPitch) return script;

  const attrs: string[] = [];
  if (hasSpeed) {
    const pct = Math.round((speed! - 1) * 100);
    attrs.push(`rate="${pct >= 0 ? "+" : ""}${pct}%"`);
  }
  if (hasPitch) {
    const p = Math.round(pitch!);
    attrs.push(`pitch="${p >= 0 ? "+" : ""}${p}%"`);
  }
  // Escape XML special chars in the script body
  const safe = script.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<speak><prosody ${attrs.join(" ")}>${safe}</prosody></speak>`;
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
 * Default motion prompt injected for all Avatar V videos when the caller
 * does not supply one. Promotes conversational body language with no extra
 * configuration required from the user.
 */
export const DEFAULT_AVATAR_V_MOTION_PROMPT =
  "Gestos de manos moderados y naturales al hablar, postura relajada y segura, " +
  "contacto visual directo con la cámara, movimientos de cabeza sutiles y naturales, " +
  "evitar gestos repetitivos o exagerados, expresión facial animada y cálida";


/**
 * Generate a video via HeyGen API v3.
 *
 * v3 unifies all avatar types under a single "avatar" type — no more
 * talking_photo vs avatar split at the API level. The look ID is passed
 * directly as avatar_id (strip the "tp:" prefix we use internally to
 * track photo-avatar looks).
 *
 * Engine selection:
 *   Avatar V if the look's supported_api_engines includes "avatar_v" (checked live via
 *   getLookSupportedEngines). Photo avatars (tp: prefix) now support avatar_v as of mid-2026 —
 *   HeyGen fixed an earlier silent-failure bug. Avatar IV + expressiveness: high is the fallback.
 */
export async function generateVideo(params: GenerateVideoParams, apiKey?: string): Promise<string> {
  const client = getClient(apiKey);

  // Strip our internal "tp:" marker — HeyGen v3 just wants the raw look ID
  const isPhotoAvatar = params.avatar_id.startsWith("tp:");
  const rawAvatarId = isPhotoAvatar ? params.avatar_id.slice(3) : params.avatar_id;

  // Dynamically check which engines this look supports.
  // HeyGen now supports avatar_v for photo_avatar looks — confirmed via API:
  //   GET /v3/avatars/looks/{id} returns supported_api_engines: ["avatar_v","avatar_iv","avatar_iii"]
  //   for photo avatar looks, and sending avatar_v in the payload is accepted (progresses past
  //   avatar validation to voice validation).  An earlier restriction blocked tp: avatars from
  //   avatar_v due to past silent failures, but HeyGen has since fixed this.
  // Trust getLookSupportedEngines exclusively to determine engine eligibility.
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

  // Normalize script before sending: expands abbreviations (IA→inteligencia
  // artificial, ROI→retorno de inversión, etc.) and removes punctuation that
  // causes unnatural pauses in cloned voices (em-dashes, ellipsis, semicolons).
  const normalizedScript = normalizeScriptForTTS(params.script, params.language);

  // Apply speed and pitch via SSML prosody (HeyGen v3 rejects voice_speed as a
  // top-level payload param — "Extra inputs are not permitted").
  const finalScript = wrapWithProsody(normalizedScript, params.voiceSpeed, params.voicePitch);

  // v3 flat payload — HeyGen v3 only accepts aspect_ratio for orientation;
  // width/height are rejected with "Extra inputs are not permitted".
  const payload: Record<string, unknown> = {
    type: "avatar",
    avatar_id: rawAvatarId,
    script: finalScript,
    voice_id: params.voice_id,
    aspect_ratio: "9:16",
    title: params.title ?? "Reelsona Video",
  };

  // Natural-motion prompt injected automatically for Avatar V; callers may override.
  const effectiveMotionPrompt = params.motionPrompt ?? DEFAULT_AVATAR_V_MOTION_PROMPT;

  if (supportsAvatarV) {
    // Avatar V: highest-fidelity lipsync + cross-reference animation.
    // Query avatar_look_metadata to pass reference_look_id when a master look exists for
    // this group — this stabilises identity and motion across looks in the same group.
    let enginePayload: Record<string, unknown> = { type: "avatar_v" };
    if (params.userId) {
      try {
        const [currentMeta] = await db
          .select({ groupId: avatarLookMetadataTable.groupId })
          .from(avatarLookMetadataTable)
          .where(
            and(
              eq(avatarLookMetadataTable.userId, params.userId),
              eq(avatarLookMetadataTable.lookId, rawAvatarId),
            )
          )
          .limit(1);
        const groupId = currentMeta?.groupId;
        if (groupId) {
          const [masterLook] = await db
            .select({ lookId: avatarLookMetadataTable.lookId })
            .from(avatarLookMetadataTable)
            .where(
              and(
                eq(avatarLookMetadataTable.userId, params.userId),
                eq(avatarLookMetadataTable.groupId, groupId),
                eq(avatarLookMetadataTable.isMasterLook, true),
              )
            )
            .limit(1);
          if (masterLook && masterLook.lookId !== rawAvatarId) {
            enginePayload = { type: "avatar_v", reference_look_id: masterLook.lookId };
            logger.info(
              { avatarId: rawAvatarId, referenceLookId: masterLook.lookId, groupId },
              "[HeyGen v3] Avatar V: using reference_look_id from master look"
            );
          }
        }
      } catch (metaErr) {
        logger.warn({ metaErr, avatarId: rawAvatarId }, "[HeyGen v3] Could not query avatar_look_metadata — sending Avatar V without reference_look_id");
      }
    }
    payload["engine"] = enginePayload;
    // motion_prompt is only valid when reference_look_id is present — HeyGen v3 rejects it
    // with "invalid_parameter" when the group has no digital twin / reference look.
    if ("reference_look_id" in enginePayload) {
      payload["motion_prompt"] = effectiveMotionPrompt;
    } else {
      logger.info(
        { avatarId: rawAvatarId },
        "[HeyGen v3] Avatar V: omitting motion_prompt — no reference_look_id available for this group",
      );
    }
  } else {
    // Avatar IV (default): broad coverage — digital_twin, Photo Avatar, Studio Avatar.
    // expressiveness: high gives the most natural result for photo-based looks.
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
 * Create a Digital Twin avatar from an uploaded video asset.
 * Returns { look_id, group_id } — poll getAvatarLookStatus() until status = "completed".
 * Processing typically takes 10–20 minutes for a Digital Twin vs 1–5 min for photo.
 */
export async function createDigitalTwinFromVideo(
  name: string,
  assetId: string,
  apiKey?: string,
): Promise<{ look_id: string; group_id: string }> {
  const client = getClient(apiKey);
  const res = await client.post(
    "/v3/avatars",
    { type: "digital_twin", name, file: { type: "asset_id", asset_id: assetId } },
    { timeout: 30000 },
  );
  const data = res.data?.data;
  const look_id: string = data?.avatar_item?.id ?? data?.look_id;
  const group_id: string = data?.avatar_group?.id ?? data?.group_id;
  if (!look_id || !group_id) {
    logger.error({ data }, "[HeyGen] createDigitalTwinFromVideo: unexpected response shape");
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

/** Clear all engine + image cache entries for every look belonging to a given API key. */
export function invalidateAllLookCachesForKey(apiKey?: string): void {
  const prefix = apiKeyPrefix(apiKey);
  for (const key of [...lookEngineCache.keys()]) {
    if (key.startsWith(`${prefix}:`)) lookEngineCache.delete(key);
  }
  for (const key of [...avatarImageCache.keys()]) {
    if (key.startsWith(`${prefix}:`)) avatarImageCache.delete(key);
  }
  defaultVoiceMapByKey.delete(prefix);
}
