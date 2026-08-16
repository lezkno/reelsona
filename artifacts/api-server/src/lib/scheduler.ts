import cron from "node-cron";
import nodePath from "path";
import nodeFs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import { db } from "@workspace/db";
import {
  automationConfigTable,
  settingsTable,
  avatarConfigTable,
  contentPlanItemsTable,
  videosTable,
  instagramAccountsTable,
  captionConfigTable,
  nicheRadarAccountsTable,
  heygenClonedVoicesTable,
  avatarLookMetadataTable,
  users,
  purchases,
  subscriptionsTable,
  invoiceCreditGrantsTable,
  userCreditsTable,
  creditLedgerTable,
} from "@workspace/db";
import {
  VIDEO_CREDIT_COST,
  hasEnoughCredits,
  reserveCredits,
  consumeVideoCredits,
  releaseVideoCredits,
  computeReelCreditCost,
  estimateDurationFromScript,
  provisionSubscriptionCredits,
  PLAN_CREDITS,
  FOUNDER_MAX_MONTHS,
} from "./credits";
import { provisionUser } from "./provision";
import { provisionPurchase } from "./provision-purchase";
import { getStripe } from "./stripe";
import { enrichProfileWithApify } from "./apify";
import { sendEmail, videoFailedEmail } from "./email";
import { applyCaptions, CAPTION_DIR, type CaptionStyle, CAPTION_PRESETS } from "./caption-engine";
import { computeUpcomingSlots } from "./schedule";
import { applyCaptionsBrowser } from "./browser-caption-engine";
import { eq, and, lte, gte, lt, inArray, isNull, isNotNull, or, desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import { generateScript, regenerateCaption, generateContentTopics } from "./ai-scripts";
import { getLatestAuditCache } from "./audit-cache";
import { getStrategyProfile, toStrategyContext } from "./strategy-profile";
import { generateVideo, getVideoStatus, listVoices, getAvatarDefaultVoiceId, fetchAvatarPreviewImage, getAllAvailableAvatarIds, invalidateAvatarIdsCache, getVoiceCloneStatus } from "./heygen";
import { isWavespeedConfigured, submitSpeech, submitTalkingHead, getJobStatus as getWavespeedJobStatus, WAVESPEED_MODELS } from "./wavespeed";
import { wavespeedPersonasTable, wavespeedLooksTable, wavespeedVoicesTable, wavespeedJobsTable } from "@workspace/db";
import { createReelContainer, checkContainerStatus, publishContainer, getPermalink, refreshInstagramToken } from "./instagram-api";
import { getSignedCaptionedVideoUrl, objectStorageClient } from "./objectStorage";
import { makeOpenAIClient } from "./openai-client";
import { generateBrandCover } from "./brand-cover";

// ── Low-credit alert rate-limiter ─────────────────────────────────────────────
// Tracks the last time a low-credit alert was sent per userId so we never
// spam users. Reset on process restart (acceptable — alerts are advisory).
const lowCreditAlertsSent = new Map<number, number>(); // userId → timestamp ms
const LOW_CREDIT_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 h

// ── AutoFill in-flight guard ──────────────────────────────────────────────────
// Prevents a second AutoFill from starting while the previous one is still
// running for the same user. Cleared in .finally() — resets on process restart.
const autoFillInFlight = new Set<number>(); // userId

// ── Video failure alert rate-limiter ─────────────────────────────────────────
// Sends at most one "Reel failed" email per user per hour to avoid spam when
// multiple items fail in the same automation cycle. Resets on process restart.
const failureAlertsSent = new Map<number, number>(); // userId → timestamp ms
const FAILURE_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 h

// ── WaveSpeed context ─────────────────────────────────────────────────────────

interface WavespeedCtx {
  personaId: number;
  lookId: number;
  imageUrl: string;
  voiceId: string; // wavespeed_voice_id (resolved)
  /** TTS speed multiplier (0.5–1.5). null = minimax default. */
  speed: number | null;
  /** Voice pitch shift in semitones (-12 to +12). null = minimax default. */
  pitch: number | null;
}

/**
 * Returns the WaveSpeed context for the next video generation, or null when
 * WaveSpeed is not available for this user.
 *
 * Selection rules:
 *   1. Search all personas newest-first.
 *   2. Collect all looks that are selected (config.selected === true), have an
 *      imageUrl, and have a voiceId that maps to a ready wavespeed_voice.
 *   3. If `preferredLookId` is one of those looks, use it (the content item is
 *      already pinned to that look — e.g. on a retry).
 *   4. Otherwise rotate sequentially: pick the look after `persona.lastUsedLookId`
 *      (wraps around).  Update `persona.last_used_look_id` so the NEXT call picks
 *      a different one.
 *
 * @param preferredLookId  wavespeed_look_id stored on the content item (may be null).
 */
async function getWavespeedContext(
  userId: number,
  preferredLookId?: number | null,
): Promise<WavespeedCtx | null> {
  if (!isWavespeedConfigured()) return null;

  // Fetch all personas, newest first so the most recently configured one wins.
  const personas = await db
    .select({ id: wavespeedPersonasTable.id, lastUsedLookId: wavespeedPersonasTable.lastUsedLookId })
    .from(wavespeedPersonasTable)
    .where(eq(wavespeedPersonasTable.userId, userId))
    .orderBy(desc(wavespeedPersonasTable.createdAt));

  if (personas.length === 0) return null;

  for (const persona of personas) {
    // Load all looks for this persona that have a generated image
    const looks = await db
      .select({
        id: wavespeedLooksTable.id,
        imageUrl: wavespeedLooksTable.imageUrl,
        config: wavespeedLooksTable.config,
      })
      .from(wavespeedLooksTable)
      .where(
        and(
          eq(wavespeedLooksTable.userId, userId),
          eq(wavespeedLooksTable.personaId, persona.id),
          isNotNull(wavespeedLooksTable.imageUrl),
        ),
      );

    // Filter to looks that are selected and have a voiceId configured.
    type LookCfg = { selected?: boolean; voiceId?: number };
    const selectedLooks = looks.flatMap((look) => {
      try {
        const cfg = JSON.parse(look.config ?? "{}") as LookCfg;
        if (!cfg.selected || !cfg.voiceId || !look.imageUrl) return [];
        return [{ ...look, voiceId: cfg.voiceId }];
      } catch { return []; }
    });

    if (selectedLooks.length === 0) continue;

    // Determine which look to use.
    // Priority 1: the preferred look (content item is already pinned to it).
    // Priority 2: sequential rotation — pick the look after lastUsedLookId.
    const preferredIdx = selectedLooks.findIndex((l) => l.id === preferredLookId);
    const isPreferredValid = preferredIdx >= 0;

    let targetLook: typeof selectedLooks[number];
    if (isPreferredValid) {
      targetLook = selectedLooks[preferredIdx];
    } else {
      const lastIdx = selectedLooks.findIndex((l) => l.id === persona.lastUsedLookId);
      targetLook = selectedLooks[(lastIdx + 1) % selectedLooks.length];
    }

    // Validate that the target look's voice is still ready.
    const [voice] = await db
      .select({
        wavespeedVoiceId: wavespeedVoicesTable.wavespeedVoiceId,
        speed: wavespeedVoicesTable.speed,
        pitch: wavespeedVoicesTable.pitch,
      })
      .from(wavespeedVoicesTable)
      .where(
        and(
          eq(wavespeedVoicesTable.id, targetLook.voiceId),
          eq(wavespeedVoicesTable.userId, userId),
          eq(wavespeedVoicesTable.status, "ready"),
          isNotNull(wavespeedVoicesTable.wavespeedVoiceId),
        ),
      )
      .limit(1);

    if (!voice?.wavespeedVoiceId) continue;

    // Advance the rotation pointer only when we picked via rotation (not preferred).
    if (!isPreferredValid) {
      await db
        .update(wavespeedPersonasTable)
        .set({ lastUsedLookId: targetLook.id, updatedAt: new Date() })
        .where(eq(wavespeedPersonasTable.id, persona.id));
    }

    return {
      personaId: persona.id,
      lookId: targetLook.id,
      imageUrl: targetLook.imageUrl!,
      voiceId: voice.wavespeedVoiceId,
      speed: voice.speed ?? null,
      pitch: voice.pitch ?? null,
    };
  }

  return null;
}

// ── Unified avatar rotation pool ──────────────────────────────────────────────
//
// A "unified slot" is either a HeyGen avatar (identified by its string ID) or a
// WaveSpeed look (identified by "ws:{lookId}").  The rotation pointer stored in
// avatarConfig.lastUsedAvatarId uses the same string format for both types so a
// single field tracks the position across the whole pool.

type UnifiedSlot =
  | { type: "heygen"; id: string }
  | { type: "wavespeed"; id: string /* "ws:{lookId}" */; ctx: WavespeedCtx };

/**
 * Build the full rotation pool: HeyGen avatars from selectedAvatarIds first,
 * then WaveSpeed looks that are selected and have a ready voice.
 *
 * Pool order is stable (HeyGen → WaveSpeed, personas newest-first, looks in
 * DB order) so sequential rotation produces a predictable interleaved sequence.
 */
async function buildUnifiedPool(
  userId: number,
  selectedHeygenIds: string[],
): Promise<UnifiedSlot[]> {
  const slots: UnifiedSlot[] = selectedHeygenIds.map((id) => ({ type: "heygen", id }));

  if (!isWavespeedConfigured()) return slots;

  const personas = await db
    .select({ id: wavespeedPersonasTable.id })
    .from(wavespeedPersonasTable)
    .where(eq(wavespeedPersonasTable.userId, userId))
    .orderBy(desc(wavespeedPersonasTable.createdAt));

  for (const persona of personas) {
    const looks = await db
      .select({
        id: wavespeedLooksTable.id,
        imageUrl: wavespeedLooksTable.imageUrl,
        config: wavespeedLooksTable.config,
      })
      .from(wavespeedLooksTable)
      .where(
        and(
          eq(wavespeedLooksTable.userId, userId),
          eq(wavespeedLooksTable.personaId, persona.id),
          isNotNull(wavespeedLooksTable.imageUrl),
        ),
      );

    type LookCfg = { selected?: boolean; voiceId?: number };
    for (const look of looks) {
      let cfg: LookCfg;
      try { cfg = JSON.parse(look.config ?? "{}"); } catch { continue; }
      if (!cfg.selected || !cfg.voiceId || !look.imageUrl) continue;

      const [voice] = await db
        .select({ wavespeedVoiceId: wavespeedVoicesTable.wavespeedVoiceId })
        .from(wavespeedVoicesTable)
        .where(
          and(
            eq(wavespeedVoicesTable.id, cfg.voiceId),
            eq(wavespeedVoicesTable.userId, userId),
            eq(wavespeedVoicesTable.status, "ready"),
            isNotNull(wavespeedVoicesTable.wavespeedVoiceId),
          ),
        )
        .limit(1);

      if (!voice?.wavespeedVoiceId) continue;

      slots.push({
        type: "wavespeed",
        id: `ws:${look.id}`,
        ctx: { personaId: persona.id, lookId: look.id, imageUrl: look.imageUrl!, voiceId: voice.wavespeedVoiceId, speed: null, pitch: null },
      });
    }
  }

  return slots;
}

/**
 * Pick the next slot from a unified pool using the configured rotation strategy.
 * `lastUsedId` can be either a raw HeyGen avatar ID or "ws:{lookId}".
 */
function pickFromUnifiedPool(
  pool: UnifiedSlot[],
  lastUsedId: string | null,
  strategy: string,
  usageCount: Record<string, number>,
): UnifiedSlot | null {
  if (!pool.length) return null;
  const ids = pool.map((s) => s.id);
  let pickedId: string;

  if (strategy === "sequential") {
    const idx = lastUsedId ? ids.indexOf(lastUsedId) : -1;
    pickedId = ids[(idx + 1) % ids.length];
  } else if (strategy === "performance") {
    const sorted = [...ids].sort((a, b) => (usageCount[a] ?? 0) - (usageCount[b] ?? 0));
    pickedId = sorted[0];
  } else {
    // random — avoid immediate repeat when pool > 1
    const filtered = ids.filter((id) => id !== lastUsedId);
    const candidates = filtered.length > 0 ? filtered : ids;
    pickedId = candidates[Math.floor(Math.random() * candidates.length)];
  }

  return pool.find((s) => s.id === pickedId) ?? pool[0];
}

/** Sentinel stored in preferred_voice_id meaning "use the avatar's own HeyGen default voice" (legacy, kept for backwards compat). */
export const AVATAR_DEFAULT_VOICE = "avatar_default";

/** How many calendar days ahead the scheduler looks when auto-filling empty slots. */
const AUTO_FILL_CALENDAR_HORIZON = 14;

/**
 * How many hours before a scheduled item's time the scheduler will proactively
 * generate its script and video.  Without this window, the cycle only triggers
 * at the exact scheduled time, leaving no room for HeyGen's 3-10 min render.
 *
 * Example: item scheduled tomorrow at 09:00 → scheduler starts preparing it
 * today at 06:00 (09:00 − 3h) so the video is ready well before publication.
 */
const PROACTIVE_PREP_HORIZON_HOURS = 3;

/**
 * Auto-fill any empty slots in the upcoming automation schedule.
 * Called inside every runAutomationCycle tick so gaps are filled proactively.
 * Returns the number of draft items created (0 when all slots are occupied).
 */
async function fillEmptyScheduledSlots(
  userId: number,
  automation: typeof automationConfigTable.$inferSelect,
  settings: typeof settingsTable.$inferSelect
): Promise<number> {
  if (!automation.autoGenerateScript) return 0;

  const now = new Date();
  const horizon = new Date(now.getTime() + AUTO_FILL_CALENDAR_HORIZON * 24 * 60 * 60 * 1000);

  // Load all future scheduled items to know which slots are already taken
  const futureScheduled = await db
    .select({ scheduledAt: contentPlanItemsTable.scheduledAt })
    .from(contentPlanItemsTable)
    .where(and(eq(contentPlanItemsTable.userId, userId), isNotNull(contentPlanItemsTable.scheduledAt), gte(contentPlanItemsTable.scheduledAt, now)));

  const occupied = futureScheduled.map((r) => r.scheduledAt!).filter(Boolean);
  const occupiedKeys = new Set(occupied.map((d) => Math.floor(d.getTime() / 60000)));

  // Generate the full set of expected slots within the horizon (no occupancy filter yet)
  const postsPerDay = Math.max(1, (automation.postingTimes ?? ["09:00"]).length);
  const allExpected = computeUpcomingSlots({
    daysOfWeek:   automation.daysOfWeek   ?? [1, 2, 3, 4, 5],
    postingTimes: automation.postingTimes ?? ["09:00"],
    timezone:     automation.timezone     ?? "America/Buenos_Aires",
    scheduledDays: AUTO_FILL_CALENDAR_HORIZON * 2, // generous — bounded below by calendar horizon
    postsPerDay,
    occupied: [],
    from: now,
  });

  // Keep only slots within the calendar horizon that have no item yet
  const emptySlots = allExpected.filter(
    (s) => s <= horizon && !occupiedKeys.has(Math.floor(s.getTime() / 60000))
  );

  if (emptySlots.length === 0) return 0;

  logger.info({ count: emptySlots.length }, "[AutoFill] Empty scheduled slots found — generating topics");

  // Load recent topics so AI avoids repeating them
  const recentRows = await db
    .select({ topic: contentPlanItemsTable.topic })
    .from(contentPlanItemsTable)
    .where(eq(contentPlanItemsTable.userId, userId))
    .limit(20);
  const existingTopics = recentRows.map((r) => r.topic).filter(Boolean);

  // Load strategy profile (primary) + audit cache (fallback)
  const [auditInsights, strategyProfile] = await Promise.all([
    getLatestAuditCache().catch(() => null),
    getStrategyProfile(userId).catch(() => null),
  ]);
  const strategyContext = strategyProfile ? toStrategyContext(strategyProfile) : undefined;

  // Ask AI to generate one topic per empty slot
  const rawTopics = await generateContentTopics(
    settings.niche!,
    (settings.topicKeywords as string[] | null) ?? [],
    settings.tone   ?? "casual",
    settings.language ?? "es",
    emptySlots.length,
    1,
    existingTopics,
    auditInsights ?? undefined,
    strategyContext ?? undefined,
  );

  if (rawTopics.length === 0) return 0;

  const toInsert = emptySlots.slice(0, rawTopics.length).map((slot, i) => ({
    userId,
    topic:        rawTopics[i].topic,
    scheduledAt:  slot,
    status:       "draft" as const,
    viralScore:   rawTopics[i].viral_score ?? null,
    editorialAngle: rawTopics[i].editorial_angle ?? null,
    shareReason:  rawTopics[i].share_reason ?? null,
    audiencePain: rawTopics[i].audience_pain ?? null,
    noveltyLevel: rawTopics[i].novelty_level ?? null,
    visualDependency: rawTopics[i].visual_dependency ?? null,
    formatFitScore: rawTopics[i].format_fit_score ?? null,
    suggestedVisualSupport: rawTopics[i].suggested_visual_support?.length ? JSON.stringify(rawTopics[i].suggested_visual_support) : null,
    avatarFitReason: rawTopics[i].avatar_talking_head_fit_reason ?? null,
  }));

  await db.insert(contentPlanItemsTable).values(toInsert);
  logger.info({ created: toInsert.length }, "[AutoFill] Draft items created for empty scheduled slots");
  return toInsert.length;
}

/**
 * Fire-and-forget: fill any empty scheduled slots for a user immediately.
 * Called after a manual reschedule so the vacated slot is filled right away
 * instead of waiting up to 5 minutes for the next cron cycle.
 */
export async function triggerFillEmptySlots(userId: number): Promise<void> {
  try {
    const [[automation], [settings]] = await Promise.all([
      db.select().from(automationConfigTable).where(eq(automationConfigTable.userId, userId)).limit(1),
      db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1),
    ]);
    if (!automation || !settings?.niche) return;
    await fillEmptyScheduledSlots(userId, automation, settings);
  } catch (err) {
    logger.warn({ userId, err }, "[AutoFill] triggerFillEmptySlots failed — non-fatal");
  }
}

/**
 * Returns Reelsona's centralized HeyGen API key.
 * All users share the same platform key — no per-user lookup needed.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function resolveHeyGenApiKey(_userId: number): Promise<string | undefined> {
  return Promise.resolve(process.env.HEYGEN_API_KEY ?? undefined);
}

/**
 * In-process mutex: tracks video IDs actively being published in this process.
 * Prevents the recovery scheduler from re-entering publishVideoToInstagram for a
 * video that an ongoing request is still polling, which would cause duplicate posts.
 */
const activePublishes = new Set<number>();

/**
 * Resolve the effective voice for a given avatar.
 *
 * Resolution order:
 * 1. Per-avatar override from voiceOverrides map (avatarId → voiceId), if set
 * 2. HeyGen's own default voice for this avatar's group (getAvatarDefaultVoiceId)
 * 3. null — caller must handle missing voice explicitly; no auto-pick
 */
export async function resolveVoiceId(avatarId: string | null, apiKey?: string, userId?: number): Promise<string | null> {
  if (!userId) {
    logger.error({ avatarId }, "[resolveVoiceId] called without userId — voice resolution will be skipped to prevent cross-user contamination");
    return null;
  }
  const [avatarCfg] = await db.select().from(avatarConfigTable).where(eq(avatarConfigTable.userId, userId)).limit(1);

  // 1. Check per-avatar override first
  if (avatarId) {
    const overrides = (avatarCfg?.voiceOverrides ?? {}) as Record<string, string>;
    const override = overrides[avatarId];
    if (override && override !== AVATAR_DEFAULT_VOICE) {
      // Skip if the override points to a cloned voice that has failed — fall through to defaults.
      const [clonedVoice] = await db
        .select({ status: heygenClonedVoicesTable.status })
        .from(heygenClonedVoicesTable)
        .where(eq(heygenClonedVoicesTable.voiceId, override))
        .limit(1);
      if (clonedVoice?.status === "failed") {
        logger.warn({ avatarId, voiceId: override }, "[resolveVoiceId] Override voice is a failed clone — falling through to HeyGen default");
      } else {
        logger.debug({ avatarId, voiceId: override }, "Using per-avatar voice override");
        return override;
      }
    }
  }

  // 2. Use HeyGen's own default voice for this avatar
  if (avatarId) {
    try {
      const def = await getAvatarDefaultVoiceId(avatarId, apiKey);
      if (def) {
        logger.debug({ avatarId, voiceId: def }, "Using HeyGen default voice for avatar");
        return def;
      }
    } catch (err) {
      logger.error({ err, avatarId }, "Failed to resolve HeyGen default voice for avatar");
    }
  }

  // 3. Legacy fallback: if preferred_voice_id is set to a specific voice (not sentinel), use it
  const preferred = avatarCfg?.preferredVoiceId ?? null;
  if (preferred && preferred !== AVATAR_DEFAULT_VOICE) {
    logger.debug({ avatarId, voiceId: preferred }, "Using legacy preferred_voice_id as fallback");
    return preferred;
  }

  // No voice found — return null so the caller can surface an actionable error
  logger.warn({ avatarId }, "No voice resolved for avatar — no override, no HeyGen default, no legacy preferred");
  return null;
}

/**
 * @deprecated No longer used. Kept to avoid breaking any external callers.
 * Voice resolution now uses per-avatar overrides and HeyGen defaults, not auto-pick.
 */
export async function ensurePreferredVoiceId(): Promise<string | null> {
  const [avatarCfg] = await db.select().from(avatarConfigTable).limit(1);
  if (!avatarCfg) return null;
  if (avatarCfg.preferredVoiceId && avatarCfg.preferredVoiceId !== AVATAR_DEFAULT_VOICE) return avatarCfg.preferredVoiceId;
  return null;
}

/** Pick the next caption preset ID from the rotation pool — mirrors pickNextAvatar. */
export function pickNextPreset(
  selectedIds: string[],
  lastUsed: string | null,
  strategy: string,
  usageCount: Record<string, number>
): string {
  if (!selectedIds.length) throw new Error("No presets configured for rotation");
  if (strategy === "sequential") {
    const idx = lastUsed ? selectedIds.indexOf(lastUsed) : -1;
    return selectedIds[(idx + 1) % selectedIds.length];
  }
  if (strategy === "performance") {
    const sorted = [...selectedIds].sort((a, b) => (usageCount[a] ?? 0) - (usageCount[b] ?? 0));
    return sorted[0];
  }
  // random — avoid immediate repeat when pool > 1
  const filtered = selectedIds.filter((id) => id !== lastUsed);
  const pool = filtered.length > 0 ? filtered : selectedIds;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function pickNextAvatar(
  selectedIds: string[],
  lastUsed: string | null,
  strategy: string,
  usageCount: Record<string, number>
): string {
  if (!selectedIds.length) throw new Error("No avatars configured");
  if (strategy === "sequential") {
    const idx = lastUsed ? selectedIds.indexOf(lastUsed) : -1;
    return selectedIds[(idx + 1) % selectedIds.length];
  }
  if (strategy === "performance") {
    // Pick least-used
    const sorted = [...selectedIds].sort((a, b) => (usageCount[a] ?? 0) - (usageCount[b] ?? 0));
    return sorted[0];
  }
  // random
  const filtered = selectedIds.filter((id) => id !== lastUsed);
  const pool = filtered.length > 0 ? filtered : selectedIds;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Compare selectedAvatarIds against the live HeyGen account and remove any
 * IDs that no longer exist (deleted looks / avatars).  Writes to DB only when
 * something changed.  Returns the (possibly updated) avatarCfg row.
 */
async function pruneDeletedAvatars(
  avatarCfg: typeof avatarConfigTable.$inferSelect,
  heygenApiKey: string | undefined,
): Promise<typeof avatarConfigTable.$inferSelect> {
  const selected: string[] = avatarCfg.selectedAvatarIds ?? [];
  if (selected.length === 0) return avatarCfg;

  let available: Set<string>;
  try {
    const result = await getAllAvailableAvatarIds(heygenApiKey);
    if (!result.complete) {
      // At least one HeyGen call failed — the set may be missing IDs.
      // Skip pruning entirely to avoid removing avatars that are still valid.
      logger.warn(
        { partialCount: result.ids.size },
        "[AvatarSync] getAllAvailableAvatarIds returned incomplete result — skipping prune",
      );
      return avatarCfg;
    }
    available = result.ids;
  } catch {
    // If we can't reach HeyGen, don't prune — avoid false positives
    return avatarCfg;
  }

  // If the set came back empty it's likely a network/auth failure — don't prune
  if (available.size === 0) return avatarCfg;

  // Load look IDs registered in avatar_look_metadata for this user.
  // These are avatars the user deliberately configured in the Avatars page and
  // may include public / system HeyGen avatars that getAllAvailableAvatarIds()
  // does not enumerate (it only scans the user's own private groups).
  // Never prune a look that has explicit metadata — it is known and intentional.
  let knownMetadataIds = new Set<string>();
  try {
    const metaRows = await db
      .select({ lookId: avatarLookMetadataTable.lookId })
      .from(avatarLookMetadataTable)
      .where(eq(avatarLookMetadataTable.userId, avatarCfg.userId));
    knownMetadataIds = new Set(metaRows.map((r) => r.lookId));
  } catch {
    // Non-fatal — skip the metadata guard and fall back to pure HeyGen check
  }

  const valid = selected.filter((id) => available.has(id) || knownMetadataIds.has(id));
  const removed = selected.filter((id) => !available.has(id) && !knownMetadataIds.has(id));

  if (removed.length === 0) return avatarCfg;

  logger.warn(
    { removed, remaining: valid },
    "[AvatarSync] Avatars deleted from HeyGen account — removing from selection",
  );

  const [updated] = await db
    .update(avatarConfigTable)
    .set({
      selectedAvatarIds: valid,
      // If lastUsedAvatarId was removed, clear it so the next pick starts fresh
      lastUsedAvatarId:
        avatarCfg.lastUsedAvatarId && removed.includes(avatarCfg.lastUsedAvatarId)
          ? null
          : avatarCfg.lastUsedAvatarId,
      updatedAt: new Date(),
    })
    .where(eq(avatarConfigTable.id, avatarCfg.id))
    .returning();

  return updated;
}

export async function runAutomationCycle(userId: number, targetItemId?: number): Promise<{
  success: boolean;
  message: string;
  contentItemId?: number;
  videoId?: number;
}> {
  logger.info({ userId, targetItemId }, "Starting automation cycle");

  // Load automation config scoped to this user
  const [automation] = await db.select().from(automationConfigTable)
    .where(eq(automationConfigTable.userId, userId)).limit(1);
  if (!automation) {
    logger.warn({ userId }, "Automation cycle aborted: automation_config row missing");
    return { success: false, message: "Automation not configured" };
  }
  if (!automation.enabled && targetItemId === undefined) {
    logger.warn({ userId }, "Automation cycle aborted: automation is disabled");
    return { success: false, message: "Automation disabled" };
  }

  // Load settings scoped to this user
  const [settings] = await db.select().from(settingsTable)
    .where(eq(settingsTable.userId, userId)).limit(1);
  if (!settings?.niche) {
    logger.warn(
      { userId, hasSettingsRow: !!settings },
      "Automation cycle aborted: niche not configured in settings"
    );
    return { success: false, message: "Niche not configured" };
  }
  // All generation flows use the platform-level key exclusively.
  const heygenApiKey = process.env.HEYGEN_API_KEY ?? undefined;

  // Load avatar config scoped to this user
  let [avatarCfg] = await db.select().from(avatarConfigTable)
    .where(eq(avatarConfigTable.userId, userId)).limit(1);

  // Sync with HeyGen: auto-remove any selected avatar IDs that were deleted
  // from the user's HeyGen account since the last cycle.
  if (avatarCfg) {
    try {
      avatarCfg = await pruneDeletedAvatars(avatarCfg, heygenApiKey);
    } catch (syncErr) {
      logger.warn({ syncErr }, "[AvatarSync] pruneDeletedAvatars threw — skipping sync");
    }
  }

  // For targeted runs of WaveSpeed items the HeyGen avatar requirement does not
  // apply — WaveSpeed uses its own persona/look/voice system.  Check if the
  // target item is pinned to a WaveSpeed look before applying the guard so that
  // users who configured WaveSpeed but have no HeyGen avatars are not blocked.
  let targetItemIsWaveSpeed = false;
  if (targetItemId !== undefined) {
    const [targetRow] = await db
      .select({ wavespeedLookId: contentPlanItemsTable.wavespeedLookId })
      .from(contentPlanItemsTable)
      .where(eq(contentPlanItemsTable.id, targetItemId))
      .limit(1);
    targetItemIsWaveSpeed = !!targetRow?.wavespeedLookId;
  }

  // Allow the cycle through if WaveSpeed is configured — buildUnifiedPool will
  // include WaveSpeed looks even when selectedAvatarIds is empty.
  if (!targetItemIsWaveSpeed && !avatarCfg?.selectedAvatarIds?.length && !isWavespeedConfigured()) {
    logger.warn({ userId }, "Automation cycle aborted: no avatars configured");
    return { success: false, message: "No avatars configured" };
  }

  // Load IG account scoped to this user
  const [igAccount] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, userId)).limit(1);
  if (!igAccount && automation.autoPublish && targetItemId === undefined) {
    logger.warn("Automation cycle aborted: auto-publish is on but no Instagram account is connected");
    return { success: false, message: "Instagram account not connected" };
  }

  // ── Auto-fill empty upcoming slots ───────────────────────────────────────────
  // Runs on every scheduled tick (not on manual targetItemId runs) so the
  // calendar always has content for the next 14 days without the user needing
  // to click "Generar Ideas" manually.
  //
  // Fire-and-forget: AutoFill is a background convenience feature and must never
  // block the critical path (generate + publish). The in-flight guard prevents
  // duplicate fills when a slow OpenAI call spans two 5-minute cron cycles.
  if (targetItemId === undefined && !autoFillInFlight.has(userId)) {
    autoFillInFlight.add(userId);
    fillEmptyScheduledSlots(userId, automation, settings)
      .then((filled) => {
        if (filled > 0) {
          logger.info({ filled }, "[AutoFill] Slot fill complete — new drafts added to pipeline");
        }
      })
      .catch((fillErr) => {
        logger.warn({ fillErr }, "[AutoFill] Failed to fill slots — non-fatal");
      })
      .finally(() => {
        autoFillInFlight.delete(userId);
      });
  }

  // Check if we have a ready content item scheduled for now or overdue.
  // We also proactively pick up items scheduled within PROACTIVE_PREP_HORIZON_HOURS
  // so HeyGen has time to render the video before the publication time arrives.
  const now = new Date();
  const prepHorizon = new Date(now.getTime() + PROACTIVE_PREP_HORIZON_HOURS * 60 * 60 * 1000);

  // Items scheduled before this moment are considered "overdue" for auto-processing.
  // The auto cycle never processes them — the user must explicitly reschedule them via
  // the ContentPlan UI. Manual triggers (targetItemId set) bypass this guard.
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const readyItems = await db
    .select()
    .from(contentPlanItemsTable)
    .where(
      targetItemId !== undefined
        ? and(eq(contentPlanItemsTable.id, targetItemId), eq(contentPlanItemsTable.status, "scripted"), eq(contentPlanItemsTable.userId, userId))
        : and(
            eq(contentPlanItemsTable.userId, userId),
            eq(contentPlanItemsTable.status, "scripted"),
            lte(contentPlanItemsTable.scheduledAt, prepHorizon),
            gte(contentPlanItemsTable.scheduledAt, todayStart),
          )
    )
    .orderBy(contentPlanItemsTable.scheduledAt)
    .limit(1);

  let contentItem = readyItems[0];

  // If no scripted item, generate one from the next upcoming draft (within prep horizon).
  // This ensures scripts and videos are ready well before the scheduled publication time.
  if (!contentItem && (automation.autoGenerateScript || targetItemId !== undefined)) {
    const draftItems = await db
      .select()
      .from(contentPlanItemsTable)
      .where(
        targetItemId !== undefined
          ? and(eq(contentPlanItemsTable.id, targetItemId), eq(contentPlanItemsTable.status, "draft"), eq(contentPlanItemsTable.userId, userId))
          : and(
              eq(contentPlanItemsTable.userId, userId),
              eq(contentPlanItemsTable.status, "draft"),
              lte(contentPlanItemsTable.scheduledAt, prepHorizon),
              gte(contentPlanItemsTable.scheduledAt, todayStart),
            )
      )
      .orderBy(contentPlanItemsTable.scheduledAt)
      .limit(1);

    let draft = draftItems[0];
    if (!draft) {
      return { success: false, message: "No draft content items available" };
    }

    // ── Atomic claim: draft → scripting ──────────────────────────────────────
    // Reserve the item before any async work so a second concurrent cycle
    // (scheduled cron overlapping with a manual trigger, or two overlapping
    // cron ticks when AI generation takes longer than the cron interval) cannot
    // pick the same draft.  Without this, both cycles call generateScript in
    // parallel; the slower one always fails the updatedAt optimistic-lock check
    // and emits "Item was modified during script generation".
    const claimedDraft = await db
      .update(contentPlanItemsTable)
      .set({ status: "scripting", updatedAt: new Date() })
      .where(and(
        eq(contentPlanItemsTable.id, draft.id),
        eq(contentPlanItemsTable.status, "draft"),
      ))
      .returning();

    if (!claimedDraft[0]) {
      logger.info({ itemId: draft.id }, "Draft already claimed by another cycle — skipping");
      return { success: false, message: "Draft item already being processed by another cycle" };
    }

    // Refresh draft from the RETURNING row — the UPDATE reflects any avatarId /
    // wavespeedLookId the user wrote between our initial SELECT and this UPDATE,
    // closing the race window that caused manual avatar picks to be overwritten.
    draft = claimedDraft[0];

    // ── Avatar reservation (BEFORE AI call) ─────────────────────────────────
    // WaveSpeed items: the user already pinned a WaveSpeed look, so skip the
    // HeyGen avatar reservation entirely — picking a HeyGen avatar here would
    // overwrite the user's explicit choice and could cause the wrong pipeline
    // to fire if the WaveSpeed context is unavailable at generation time.
    let avatarId: string | null = null;
    let voiceId: string | null | undefined = null;
    if (!draft.wavespeedLookId) {
      // Honour any explicitly stored HeyGen avatar regardless of selectedAvatarIds.
      // The old selectedAvatarIds.includes() check caused valid manual picks to be
      // discarded whenever pruneDeletedAvatars removed the ID (e.g. public/system
      // avatars not enumerated by getAllAvailableAvatarIds).
      // Voice validation is deferred to generation time to avoid extra API calls
      // during the expensive script-generation AI step.
      if (draft.avatarId) {
        avatarId = draft.avatarId;
        if (!(avatarCfg?.selectedAvatarIds ?? []).includes(draft.avatarId)) {
          logger.info(
            { avatarId: draft.avatarId },
            "[scheduler draft] avatarId not in selectedAvatarIds — honouring stored value (voice validated at generation time)",
          );
        }
      } else {
        const pool = await buildUnifiedPool(userId, avatarCfg?.selectedAvatarIds ?? []);
        const usageCount = (avatarCfg?.avatarUsageCount as Record<string, number>) ?? {};
        const picked = pickFromUnifiedPool(
          pool,
          avatarCfg?.lastUsedAvatarId ?? null,
          avatarCfg?.rotationStrategy ?? "sequential",
          usageCount,
        );

        if (!picked) {
          // No avatars or WaveSpeed looks available — reset to draft for retry.
          logger.error({ itemId: draft.id }, "Unified rotation pool is empty — no avatars or WaveSpeed looks configured");
          await db
            .update(contentPlanItemsTable)
            .set({ status: "draft", updatedAt: new Date() })
            .where(eq(contentPlanItemsTable.id, draft.id));
          return { success: false, message: "No hay avatares ni looks de WaveSpeed disponibles. Configura al menos uno en la página de Avatares." };
        }

        // Advance rotation pointer (shared across both pipeline types)
        if (avatarCfg) {
          await db
            .update(avatarConfigTable)
            .set({ lastUsedAvatarId: picked.id, updatedAt: new Date() })
            .where(eq(avatarConfigTable.id, avatarCfg.id));
          avatarCfg.lastUsedAvatarId = picked.id;
        }

        if (picked.type === "wavespeed") {
          // WaveSpeed look picked via rotation — pin it to the draft so the pipeline
          // selection below uses the correct pipeline, and retries reuse the same look.
          draft.wavespeedLookId = picked.ctx.lookId;
          await db
            .update(contentPlanItemsTable)
            .set({ wavespeedLookId: picked.ctx.lookId, avatarId: null, updatedAt: new Date() })
            .where(eq(contentPlanItemsTable.id, draft.id));
          logger.info(
            { itemId: draft.id, lookId: picked.ctx.lookId },
            "Unified rotation picked WaveSpeed look for draft"
          );
        } else {
          avatarId = picked.id;
          logger.info(
            { itemId: draft.id, avatarId },
            "Unified rotation picked HeyGen avatar for draft"
          );
        }
      }
    } else {
      logger.info(
        { itemId: draft.id, wavespeedLookId: draft.wavespeedLookId },
        "WaveSpeed look pinned on draft — skipping avatar rotation"
      );
    }

    // ── AI script generation ──────────────────────────────────────────────────
    // Wrapped in try/catch: if the AI call throws, reset the item back to
    // "draft" so it isn't left stranded in "scripting" forever.
    let scriptResult: Awaited<ReturnType<typeof generateScript>>;
    try {
      const auditInsights = await getLatestAuditCache().catch(() => null);
      scriptResult = await generateScript(
        draft.topic,
        settings.niche,
        settings.tone,
        settings.language,
        settings.videoDurationSeconds,
        {
          auditInsights: auditInsights ?? undefined,
          nicheDescription: settings.nicheDescription,
          topicKeywords: (settings.topicKeywords as string[] | null) ?? undefined,
          offer: settings.offer,
          idealAudience: settings.idealAudience,
          uniqueValueProp: settings.uniqueValueProp,
          voiceStyle: settings.voiceStyle,
          commonObjections: settings.commonObjections,
          customCta: settings.customCta,
        },
      );
      // Resolve voice only for HeyGen items — WaveSpeed voice is in its own ctx.
      if (!draft.wavespeedLookId) {
        voiceId = (await resolveVoiceId(avatarId, heygenApiKey, userId)) ?? draft.voiceId;
      }
    } catch (err) {
      // Reset to draft so the next cycle can retry.
      await db
        .update(contentPlanItemsTable)
        .set({ status: "draft", updatedAt: new Date() })
        .where(and(
          eq(contentPlanItemsTable.id, draft.id),
          eq(contentPlanItemsTable.status, "scripting"),
        ))
        .catch((resetErr) => logger.error({ itemId: draft.id, resetErr }, "Failed to reset scripting item to draft"));
      throw err;
    }

    // ── Write script (no updatedAt race check needed) ─────────────────────────
    // The atomic claim above moved the item to "scripting", so no other cycle
    // can touch it.  We only guard against the item having been manually reset
    // or deleted while the AI was running (extremely rare).
    // For WaveSpeed items, do NOT overwrite avatarId/voiceId — the user's
    // wavespeedLookId is the authoritative pipeline selector and must be preserved.
    const scriptWritten = await db
      .update(contentPlanItemsTable)
      .set({
        hook: scriptResult.hook,
        script: scriptResult.script,
        cta: scriptResult.cta,
        caption: scriptResult.caption,
        hashtags: scriptResult.hashtags,
        ...(!draft.wavespeedLookId && { avatarId, voiceId }),
        status: "scripted",
        hookCandidates: scriptResult.hook_candidates.length > 0 ? JSON.stringify(scriptResult.hook_candidates) : null,
        hookSelectionReason: scriptResult.hook_selection_reason || null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(contentPlanItemsTable.id, draft.id),
        eq(contentPlanItemsTable.status, "scripting"),
      ))
      .returning({ id: contentPlanItemsTable.id });

    if (!scriptWritten[0]) {
      logger.warn({ itemId: draft.id }, "Script write skipped — item was manually modified while AI was running");
      return { success: false, message: "Item was manually modified while script was being generated" };
    }

    contentItem = {
      ...draft,
      status: "scripted",
      ...(!draft.wavespeedLookId && { avatarId, voiceId }),
      hook: scriptResult.hook,
      script: scriptResult.script,
      cta: scriptResult.cta,
      caption: scriptResult.caption,
      hashtags: scriptResult.hashtags,
    };
    logger.info({ itemId: draft.id, avatarId, wavespeedLookId: draft.wavespeedLookId }, "Script generated for draft item");
  }

  if (!contentItem) {
    return { success: false, message: "No content item ready for processing" };
  }

  // Generate video (a manual run always continues to video generation)
  if (!automation.autoGenerateVideo && targetItemId === undefined) {
    return { success: true, message: "Script ready, video generation disabled", contentItemId: contentItem.id };
  }

  // ── Pipeline selection ────────────────────────────────────────────────────
  // Respect the user's manual avatar choice:
  //   • wavespeedLookId set  → WaveSpeed pipeline; skip HeyGen backfill entirely.
  //   • avatarId set (no wavespeedLookId) → user explicitly chose HeyGen; skip WaveSpeed.
  //   • neither set → auto-rotation: WaveSpeed takes priority when configured.

  let wavespeedCtx: Awaited<ReturnType<typeof getWavespeedContext>> = null;

  if (contentItem.wavespeedLookId) {
    // User manually pinned a WaveSpeed look — force WaveSpeed, bypass HeyGen backfill.
    wavespeedCtx = await getWavespeedContext(userId, contentItem.wavespeedLookId);
    if (!wavespeedCtx) {
      // The pinned look is unavailable (no voice assigned, no image, or persona deleted).
      // Do NOT fall back to HeyGen silently — the user made an explicit choice.
      logger.error(
        { itemId: contentItem.id, wavespeedLookId: contentItem.wavespeedLookId },
        "WaveSpeed look pinned on item but getWavespeedContext returned null — aborting to avoid wrong pipeline"
      );
      return {
        success: false,
        message: "El look de WaveSpeed seleccionado no está disponible. Asegúrate de que tenga una voz asignada y una imagen generada.",
      };
    }
  } else {
    // No WaveSpeed look pinned on this item. Resolve which HeyGen avatar to use.
    //
    // Voice resolution is now the authoritative "is this avatar still usable?" check.
    // selectedAvatarIds.includes() alone was not sufficient — public/system HeyGen
    // avatars are pruned from selectedAvatarIds by pruneDeletedAvatars even when
    // perfectly valid (they don't appear in the user's private groups).
    //
    //  (a) avatarId set + voice resolves  → honour it (manual pick or valid rotation)
    //  (b) avatarId set + voice fails     → stale/deleted → unified rotation
    //  (c) avatarId null                  → unified rotation
    const resolvedVoiceForStored = contentItem.avatarId
      ? await resolveVoiceId(contentItem.avatarId, heygenApiKey, userId)
      : null;

    if (contentItem.avatarId) {
      // (a) User explicitly chose this avatar — ALWAYS honour it; never rotate.
      //
      // The previous approach used resolveVoiceId as a validity gate and rotated
      // when voice resolution failed. That silently swapped the avatar the user
      // picked (e.g. custom/cloned avatars with no global default voice in HeyGen).
      //
      // Now: if voice resolves, update it. If not, keep whatever voice was stored.
      // The generation step will produce a clear error rather than a silent swap.
      if (resolvedVoiceForStored) {
        contentItem.voiceId = resolvedVoiceForStored;
        await db
          .update(contentPlanItemsTable)
          .set({ voiceId: contentItem.voiceId, updatedAt: new Date() })
          .where(eq(contentPlanItemsTable.id, contentItem.id));
      } else if (!contentItem.voiceId) {
        logger.warn(
          { avatarId: contentItem.avatarId, itemId: contentItem.id },
          "[scheduler scripted] Voice not resolvable for stored avatar — proceeding anyway; generation step will surface the error",
        );
      }
      wavespeedCtx = null;
    } else {
      // (b)/(c) No avatar stored — unified rotation.

      const pool = await buildUnifiedPool(userId, avatarCfg?.selectedAvatarIds ?? []);
      const usageCount = (avatarCfg?.avatarUsageCount as Record<string, number>) ?? {};
      const picked = pickFromUnifiedPool(
        pool,
        avatarCfg?.lastUsedAvatarId ?? null,
        avatarCfg?.rotationStrategy ?? "sequential",
        usageCount,
      );

      if (!picked) {
        logger.error({ userId, itemId: contentItem.id }, "Unified rotation pool is empty — no avatars or WaveSpeed looks available");
        return {
          success: false,
          message: "No hay avatares ni looks de WaveSpeed disponibles. Configura al menos uno en la página de Avatares.",
        };
      }

      // Advance rotation pointer (shared across both pipeline types)
      if (avatarCfg) {
        await db
          .update(avatarConfigTable)
          .set({ lastUsedAvatarId: picked.id, updatedAt: new Date() })
          .where(eq(avatarConfigTable.id, avatarCfg.id));
        avatarCfg.lastUsedAvatarId = picked.id;
      }

      if (picked.type === "wavespeed") {
        // WaveSpeed look picked — pin it to the item so retries reuse the same look.
        contentItem.wavespeedLookId = picked.ctx.lookId;
        contentItem.avatarId = null;
        contentItem.voiceId = null;
        await db
          .update(contentPlanItemsTable)
          .set({ wavespeedLookId: picked.ctx.lookId, avatarId: null, voiceId: null, updatedAt: new Date() })
          .where(eq(contentPlanItemsTable.id, contentItem.id));
        wavespeedCtx = picked.ctx;
        logger.info(
          { itemId: contentItem.id, lookId: picked.ctx.lookId },
          "Unified rotation picked WaveSpeed look"
        );
      } else {
        // HeyGen avatar picked.
        contentItem.avatarId = picked.id;
        contentItem.voiceId = null;
        const freshVoiceId = await resolveVoiceId(contentItem.avatarId, heygenApiKey, userId);
        contentItem.voiceId = freshVoiceId;
        await db
          .update(contentPlanItemsTable)
          .set({ avatarId: contentItem.avatarId, voiceId: contentItem.voiceId, updatedAt: new Date() })
          .where(eq(contentPlanItemsTable.id, contentItem.id));
        wavespeedCtx = null;
        logger.info(
          { itemId: contentItem.id, avatarId: picked.id },
          "Unified rotation picked HeyGen avatar"
        );
      }
    }
  }

  // Pin the resolved look to this content item so retries reuse the same look
  // and we know which look produced each video.
  if (wavespeedCtx && wavespeedCtx.lookId !== contentItem.wavespeedLookId) {
    contentItem.wavespeedLookId = wavespeedCtx.lookId;
    await db
      .update(contentPlanItemsTable)
      .set({ wavespeedLookId: wavespeedCtx.lookId, updatedAt: new Date() })
      .where(eq(contentPlanItemsTable.id, contentItem.id));
  }

  if (!contentItem.script) {
    logger.error({ itemId: contentItem.id }, "Content item missing script");
    return { success: false, message: "Content item missing script" };
  }
  if (!wavespeedCtx && (!contentItem.avatarId || !contentItem.voiceId)) {
    logger.error({ itemId: contentItem.id, hasAvatar: !!contentItem.avatarId, hasVoice: !!contentItem.voiceId }, "Content item missing avatar or voice (no WaveSpeed context available)");
    return { success: false, message: "Content item missing avatar, voice, or script" };
  }

  // Atomically claim the item (scripted -> generating) so concurrent manual
  // runs / scheduler ticks can't both submit a HeyGen generation for it.
  const claimed = await db
    .update(contentPlanItemsTable)
    .set({ status: "generating", updatedAt: new Date() })
    .where(and(eq(contentPlanItemsTable.id, contentItem.id), eq(contentPlanItemsTable.status, "scripted")))
    .returning({ id: contentPlanItemsTable.id });
  if (claimed.length === 0) {
    return { success: false, message: "Content item is already being processed" };
  }

  // ── Dynamic credit cost estimate ──────────────────────────────────────────
  // Estimate the video cost from the script length + engine type before
  // reserving. WaveSpeed: 100 cr / 30 s; HeyGen: 150 cr / 30 s.
  const estimatedDurationSec = estimateDurationFromScript(contentItem.script);
  const estimatedCreditCost = computeReelCreditCost(estimatedDurationSec);

  // ── Credit check ──────────────────────────────────────────────────────────
  // Admin users bypass the credit check. Regular users must have enough credits
  // before we create the video row. If insufficient: reset item to 'scripted'
  // (not 'failed') so the automation retries it when credits are available.
  const [userForCredits] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const isAdmin = userForCredits?.role === "admin";
  if (!isAdmin) {
    const enough = await hasEnoughCredits(userId, estimatedCreditCost);
    if (!enough) {
      await db
        .update(contentPlanItemsTable)
        .set({ status: "scripted", updatedAt: new Date() })
        .where(eq(contentPlanItemsTable.id, contentItem.id));
      logger.warn(
        { userId, itemId: contentItem.id, required: estimatedCreditCost, estimatedDurationSec },
        "[Credits] Saldo insuficiente — item restablecido a 'scripted'",
      );

      // Fire-and-forget low-credit alert email (rate-limited to once per 24h per user)
      const lastAlert = lowCreditAlertsSent.get(userId) ?? 0;
      if (Date.now() - lastAlert > LOW_CREDIT_ALERT_COOLDOWN_MS) {
        lowCreditAlertsSent.set(userId, Date.now());
        db.select({ email: users.email, username: users.username, fullName: users.fullName })
          .from(users).where(eq(users.id, userId)).limit(1)
          .then(([user]) => {
            const to = user?.email ?? user?.username;
            if (!to) return;
            return sendEmail({
              to,
              subject: "⚠️ Tu saldo de créditos en Reelsona está por agotarse",
              html: `<p>Hola ${user?.fullName ?? ""},</p>
<p>Tu saldo de créditos en Reelsona es insuficiente para generar nuevos videos. La automatización está pausada hasta que tengas créditos disponibles.</p>
<p>Entra a la plataforma para ver tu saldo actual en <strong>Configuración</strong>.</p>
<p style="color:#888;font-size:12px">Este aviso se envía como máximo una vez cada 24 horas.</p>`,
              text: "Tu saldo de créditos en Reelsona está por agotarse. La automatización está pausada. Entra a la plataforma para ver tu saldo.",
            });
          })
          .catch((err) => logger.warn({ err, userId }, "[Credits] No se pudo enviar alerta de saldo bajo"));
      }

      return {
        success: false,
        message: `Saldo de créditos insuficiente (se requieren ~${estimatedCreditCost} créditos para ~${estimatedDurationSec}s de video). El item se reintentará cuando haya saldo.`,
      };
    }
  }

  const [videoRow] = await db
    .insert(videosTable)
    .values({
      userId,
      contentPlanId: contentItem.id,
      topic: contentItem.topic,
      avatarId: contentItem.avatarId,
      status: "generating",
      // null = caption pending (will be processed after HeyGen completes)
      // "disabled" = captions are off, skip the step entirely
      captionStatus: automation.captionsEnabled ? null : "disabled",
      // Carry the user's video effects config so the caption engine can apply zoom etc.
      videoEffects: (settings.videoEffects as object | null) ?? null,
      // Start the timeout clock at submission, not at first poll
      generatingStartedAt: new Date(),
    })
    .returning();

  // ── Reserve credits ───────────────────────────────────────────────────────
  // Reserve now (before HeyGen call) so a crash between submission and
  // completion doesn't leak credits. Released on any failure path;
  // consumed when HeyGen reports the video as completed.
  // If the reserve itself fails we abort immediately — sending a generation
  // request to HeyGen without an outstanding reservation would produce a video
  // whose credit cost can never be settled correctly.
  if (!isAdmin) {
    await reserveCredits(
      userId,
      estimatedCreditCost,
      videoRow.id,
      `Generación de video ${videoRow.id}: ~${estimatedDurationSec}s ${wavespeedCtx ? "WaveSpeed" : "HeyGen"} — ${contentItem.topic ?? "sin tema"}`,
    ).catch((creditErr) => {
      logger.error({ creditErr, videoId: videoRow.id }, "[Credits] Reserve falló — abortando generación (no se enviará a HeyGen)");
      throw creditErr;
    });
  }

  // Look up per-voice speed and pitch for SSML prosody wrapping
  let resolvedVoiceSpeed: number | undefined;
  let resolvedVoicePitch: number | undefined;
  if (contentItem.voiceId) {
    const [clonedVoiceRow] = await db
      .select({ speed: heygenClonedVoicesTable.speed, pitch: heygenClonedVoicesTable.pitch })
      .from(heygenClonedVoicesTable)
      .where(eq(heygenClonedVoicesTable.voiceId, contentItem.voiceId));
    resolvedVoiceSpeed = clonedVoiceRow?.speed ?? undefined;
    resolvedVoicePitch = clonedVoiceRow?.pitch ?? undefined;
  }

  try {
    if (wavespeedCtx) {
      // ── WaveSpeed path ────────────────────────────────────────────────────
      // Step 1: submit TTS job (minimax/speech-2.6-turbo).
      // Step 2 happens during polling: when TTS completes → submit talking-head.
      // The sentinel "wavespeed-tts:{id}" stored in heygenVideoId tells the
      // poller which stage we're in and which request id to poll.
      logger.info(
        { videoId: videoRow.id, voiceId: wavespeedCtx.voiceId, speed: wavespeedCtx.speed, pitch: wavespeedCtx.pitch },
        "[WaveSpeed] Submitting TTS job",
      );
      const { requestId: ttsRequestId } = await submitSpeech(
        contentItem.script!,
        wavespeedCtx.voiceId,
        undefined,
        { speed: wavespeedCtx.speed ?? undefined, pitch: wavespeedCtx.pitch ?? undefined },
      );
      const sentinel = `wavespeed-tts:${ttsRequestId}`;

      // Track the job in wavespeed_jobs so the poller can find imageUrl later.
      await db.insert(wavespeedJobsTable).values({
        userId,
        model: WAVESPEED_MODELS.SPEECH,
        status: "processing",
        wavespeedRequestId: ttsRequestId,
        // Store imageUrl in inputPayload so the talking-head step can read it without a separate query.
        inputPayload: JSON.stringify({
          text: contentItem.script,
          voice_id: wavespeedCtx.voiceId,
          imageUrl: wavespeedCtx.imageUrl,
        }),
        relatedVideoId: videoRow.id,
      });

      await db
        .update(videosTable)
        .set({ heygenVideoId: sentinel, updatedAt: new Date() })
        .where(eq(videosTable.id, videoRow.id));

      await db
        .update(contentPlanItemsTable)
        .set({ videoId: videoRow.id, updatedAt: new Date() })
        .where(eq(contentPlanItemsTable.id, contentItem.id));

      logger.info({ videoId: videoRow.id, ttsRequestId, sentinel }, "[WaveSpeed] TTS job submitted — polling will advance to talking-head step");
      return { success: true, message: "WaveSpeed video generation started (TTS submitted)", contentItemId: contentItem.id, videoId: videoRow.id };
    }

    // ── HeyGen path (unchanged) ───────────────────────────────────────────
    const heygenVideoId = await generateVideo({
      script:          contentItem.script,
      avatar_id:       contentItem.avatarId!,
      voice_id:        contentItem.voiceId!,
      title:           contentItem.topic,
      captionsEnabled: automation.captionsEnabled ?? false,
      voiceSpeed:      resolvedVoiceSpeed,
      voicePitch:      resolvedVoicePitch,
      language:        settings.language ?? "es",
      userId,
    }, heygenApiKey);

    await db
      .update(videosTable)
      .set({ heygenVideoId, updatedAt: new Date() })
      .where(eq(videosTable.id, videoRow.id));

    await db
      .update(contentPlanItemsTable)
      .set({ videoId: videoRow.id, updatedAt: new Date() })
      .where(eq(contentPlanItemsTable.id, contentItem.id));

    // Update avatar usage count
    const usageCount = (avatarCfg.avatarUsageCount as Record<string, number>) ?? {};
    usageCount[contentItem.avatarId!] = (usageCount[contentItem.avatarId!] ?? 0) + 1;
    await db
      .update(avatarConfigTable)
      .set({ lastUsedAvatarId: contentItem.avatarId, avatarUsageCount: usageCount, updatedAt: new Date() })
      .where(eq(avatarConfigTable.id, avatarCfg.id));

    logger.info({ videoId: videoRow.id, heygenVideoId }, "Video generation started");
    return { success: true, message: "Video generation started", contentItemId: contentItem.id, videoId: videoRow.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // HeyGen 429 rate-limit: transient — release credits and put the content item
    // back to 'scripted' so the scheduler picks it up again next cycle automatically.
    // The video row is marked failed (record of the attempt) but the item stays retryable.
    const isRateLimit = error.includes("generation deferred to next cycle") || error.includes("rate limit");

    // If HeyGen rejected because the avatar was deleted, auto-remove it from the
    // selection so the next cycle picks a valid avatar instead of looping forever.
    const isAvatarGone =
      error.includes("not found") ||
      (error.startsWith("HeyGen 404") || error.includes("avatar may have been deleted"));
    if (isAvatarGone && contentItem.avatarId) {
      const pruned = avatarCfg.selectedAvatarIds.filter((id) => id !== contentItem.avatarId);
      await db
        .update(avatarConfigTable)
        .set({ selectedAvatarIds: pruned, updatedAt: new Date() })
        .where(eq(avatarConfigTable.id, avatarCfg.id));
      invalidateAvatarIdsCache(heygenApiKey);
      logger.warn(
        { removedId: contentItem.avatarId, remaining: pruned },
        "[AvatarSync] Auto-removed deleted avatar from selection after generation failure",
      );
    }

    // Release reserved credits so the user can retry without losing their balance.
    if (!isAdmin) {
      await releaseVideoCredits(videoRow.id, `Generación fallida al enviar: ${error}`).catch((creditErr) =>
        logger.error({ creditErr, videoId: videoRow.id }, "[Credits] Release falló después de error en generación")
      );
    }

    await db.update(videosTable).set({ status: "failed", errorMessage: error, updatedAt: new Date() }).where(eq(videosTable.id, videoRow.id));

    // Rate-limit: item goes back to 'scripted' so the next automation cycle retries it.
    // All other errors: item goes to 'failed' and requires manual intervention.
    const nextItemStatus = isRateLimit ? "scripted" : "failed";
    await db.update(contentPlanItemsTable).set({ status: nextItemStatus, updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, contentItem.id));

    if (isRateLimit) {
      logger.warn(
        { userId, itemId: contentItem.id, videoId: videoRow.id },
        "[Credits/429] Item restablecido a 'scripted' — créditos liberados, se reintentará en el próximo ciclo del scheduler",
      );
    } else {
      // Permanent failure — alert the user so they can reschedule the slot
      sendVideoFailedAlert(userId, contentItem.id).catch(() => {});
    }

    return { success: false, message: `Video generation failed: ${error}` };
  }
}

/**
 * Apply Caption Studio processing to a single video row.
 * Uses the video's stored URL + the linked content-item script.
 * subtitleUrl is optional — if absent (e.g. recovery after restart) the engine
 * falls back to proportional SRT generated from the script text.
 */
export async function runCaptionProcessing(
  videoId: number,
  videoUrl: string,
  contentPlanId: number | null,
  subtitleUrl?: string | null,
  durationSeconds?: number | null
): Promise<void> {
  // Look up the video's stored effects AND the persisted HeyGen subtitle URL
  const [videoRow] = await db
    .select({ videoEffects: videosTable.videoEffects, heygenSubtitleUrl: videosTable.heygenSubtitleUrl, userId: videosTable.userId })
    .from(videosTable)
    .where(eq(videosTable.id, videoId))
    .limit(1);
  // If caller didn't supply a subtitle URL (e.g. recovery / reapply path), fall back to the
  // one saved in the DB at original completion time so captions keep real word timings.
  const resolvedSubtitleUrl = subtitleUrl ?? videoRow?.heygenSubtitleUrl ?? null;

  const userId = videoRow?.userId;
  const [captionSettings] = userId
    ? await db.select({ videoEffects: settingsTable.videoEffects })
        .from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1)
    : [];

  // Merge live account effects on top of the frozen video snapshot so users
  // don't need to re-create videos after toggling effects in Settings.
  // Live account settings win — per-item overrides were already baked into the
  // frozen snapshot at creation time and will be overridden here (acceptable trade-off).
  const frozenEffects = (videoRow?.videoEffects as { zoom?: boolean; ai_broll?: boolean; text_cards?: boolean } | null) ?? {};
  const liveEffects   = (captionSettings?.videoEffects as { zoom?: boolean; ai_broll?: boolean; text_cards?: boolean } | null) ?? {};
  // Live account settings win so toggling an effect in Studio de Efectos takes
  // effect immediately without re-creating the video.
  const videoEffects  = { ...frozenEffects, ...liveEffects };

  logger.info(
    { videoId, frozenEffects, liveEffects, videoEffects, contentPlanId },
    "[CaptionEngine] Starting caption processing — merged effects"
  );
  const [captionCfg] = userId
    ? await db.select().from(captionConfigTable).where(eq(captionConfigTable.userId, userId)).limit(1)
    : await db.select().from(captionConfigTable).limit(1);
  if (!captionCfg) {
    // Fix 2: no config → mark failed instead of silently leaving captionStatus=null
    await db.update(videosTable)
      .set({ captionStatus: "failed", updatedAt: new Date() })
      .where(eq(videosTable.id, videoId));
    logger.warn({ videoId }, "[CaptionEngine] No caption config found — marking as failed");
    return;
  }

  await db.update(videosTable)
    .set({ captionStatus: "processing", updatedAt: new Date() })
    .where(eq(videosTable.id, videoId));

  let script: string | null = null;
  let visualSuggestions: string | null = null;
  if (contentPlanId) {
    const [item] = await db.select().from(contentPlanItemsTable)
      .where(eq(contentPlanItemsTable.id, contentPlanId));
    script = item?.script ?? null;
    visualSuggestions = item?.suggestedVisualSupport ?? null;
    if (!script) {
      logger.warn({ videoId, contentPlanId }, "[CaptionEngine] Content plan item has no script — text cards will be skipped");
    }
  } else {
    if (videoEffects?.text_cards) {
      logger.warn({ videoId }, "[CaptionEngine] text_cards enabled but video has no contentPlanId — text cards will be skipped");
    }
  }

  // ── Caption preset rotation ───────────────────────────────────────────────
  // If the user has configured a rotation pool, pick the next preset and
  // update lastUsedPresetId + presetUsageCount in the DB before rendering.
  let effectiveTemplateId: string | null = captionCfg.templateId ?? null;
  let rotatedPreset: (typeof CAPTION_PRESETS)[number] | null = null;

  const rotationPool = captionCfg.selectedPresetIds ?? [];
  if (rotationPool.length > 0) {
    const pickedId = pickNextPreset(
      rotationPool,
      captionCfg.lastUsedPresetId ?? null,
      captionCfg.captionRotationStrategy ?? "sequential",
      (captionCfg.presetUsageCount ?? {}) as Record<string, number>
    );
    logger.info({ videoId, pickedId }, "[CaptionRotation] Rotating caption preset");

    const newUsageCount = { ...((captionCfg.presetUsageCount ?? {}) as Record<string, number>) };
    newUsageCount[pickedId] = (newUsageCount[pickedId] ?? 0) + 1;
    await db.update(captionConfigTable)
      .set({ lastUsedPresetId: pickedId, presetUsageCount: newUsageCount, updatedAt: new Date() })
      .where(eq(captionConfigTable.id, captionCfg.id));

    if (captionCfg.captionEngine === "browser_experimental") {
      effectiveTemplateId = pickedId;
    } else {
      rotatedPreset = CAPTION_PRESETS.find((p) => p.id === pickedId) ?? null;
    }
  }

  // ── Browser Caption Engine (experimental) ────────────────────────────────
  // When captionEngine = "browser_experimental" and a templateId is set,
  // attempt the canvas-based render first. On failure → fall through to ASS.
  if (captionCfg.captionEngine === "browser_experimental" && effectiveTemplateId) {
    logger.info(
      { videoId, templateId: effectiveTemplateId },
      "[Scheduler] Using Browser Caption Engine (experimental)",
    );

    // Parse stored template overrides JSON (set via Caption Studio advanced settings)
    let parsedTemplateOverrides: Partial<import("@workspace/caption-templates").CaptionTemplate> | undefined;
    if (captionCfg.templateOverrides) {
      try { parsedTemplateOverrides = JSON.parse(captionCfg.templateOverrides); } catch { /* ignore malformed */ }
    }
    const browserResult = await applyCaptionsBrowser(videoUrl, script, effectiveTemplateId, {
      subtitleUrl:          resolvedSubtitleUrl ?? undefined,
      videoDurationSeconds: durationSeconds ?? undefined,
      // Pass user drag overrides so position set in Caption Studio is honoured in the render
      yPositionPct: captionCfg.yPosition  ?? undefined,
      marginXPct:   captionCfg.marginX    != null
        ? (captionCfg.marginX / 1080) * 100  // px at 1080-width scale → % of VIDEO_WIDTH
        : undefined,
      // Pass style overrides from Caption Studio advanced settings
      templateOverrides: parsedTemplateOverrides,
      // Pass video effects so the browser engine can apply zoom, B-roll, etc.
      videoEffects: videoEffects,
      visualSuggestions,
      // Pass saved card template so the engine can skip AI generation when a fixed template is configured
      cardTemplate: captionCfg.cardTemplate ?? undefined,
    });

    if (browserResult.url) {
      await db
        .update(videosTable)
        .set({
          captionedVideoUrl: browserResult.url,
          captionStatus: "done",
          // Save generated thumbnail when available (e.g. WaveSpeed videos that
          // have no HeyGen-supplied thumbnail_url after generation)
          ...(browserResult.thumbnailUrl && { thumbnailUrl: browserResult.thumbnailUrl }),
          updatedAt: new Date(),
        })
        .where(eq(videosTable.id, videoId));
      logger.info({ videoId }, "[BrowserEngine] Captioned video ready ✓");
      // Trigger IG copy generation (fire-and-forget)
      if (contentPlanId) {
        runCopyGeneration(contentPlanId).catch((err) =>
          logger.error({ videoId, contentPlanId, err }, "[CopyEngine] Failed to start copy generation (browser engine path)")
        );
      }
      return;
    }

    // Browser engine failed — log warning, fall through to standard ASS engine as safety net
    // Include error text in the message itself so pino's pretty-printer doesn't truncate it.
    logger.warn(
      { videoId },
      `[BrowserEngine] Failed (${browserResult.error ?? "unknown error"}) — falling back to standard ASS/FFmpeg engine`,
    );
  }

  // ── Standard ASS/FFmpeg engine ────────────────────────────────────────────
  // If rotation picked a preset, its visual settings override the stored config.
  const style: CaptionStyle = rotatedPreset ? {
    presetId:        rotatedPreset.id,
    position:        captionCfg.position as CaptionStyle["position"],
    wordsPerLine:    rotatedPreset.wordsPerLine ?? captionCfg.wordsPerLine,
    primaryColor:    rotatedPreset.primaryColor,
    activeWordColor: rotatedPreset.activeWordColor,
    outlineColor:    rotatedPreset.outlineColor,
    backgroundColor: rotatedPreset.backgroundColor ?? null,
    fontFamily:      rotatedPreset.fontFamily,
    fontSize:        rotatedPreset.fontSize,
    lineSpacingFactor: captionCfg.lineSpacingFactor,
    yPosition:       captionCfg.yPosition,
    marginX:         captionCfg.marginX,
    activeWordScale: rotatedPreset.activeWordScale,
    highlightMode:   rotatedPreset.highlightMode as CaptionStyle["highlightMode"],
    autoScale:       captionCfg.autoScale,
    autoMovement:    rotatedPreset.autoMovement,
    subtleRotation:  rotatedPreset.subtleRotation,
  } : {
    presetId: captionCfg.presetId,
    position: captionCfg.position as CaptionStyle["position"],
    wordsPerLine: captionCfg.wordsPerLine,
    primaryColor: captionCfg.primaryColor,
    activeWordColor: captionCfg.activeWordColor,
    outlineColor: captionCfg.outlineColor,
    backgroundColor: captionCfg.backgroundColor ?? null,
    fontFamily: captionCfg.fontFamily,
    fontSize: captionCfg.fontSize,
    lineSpacingFactor: captionCfg.lineSpacingFactor,
    yPosition: captionCfg.yPosition,
    marginX: captionCfg.marginX,
    activeWordScale: captionCfg.activeWordScale,
    highlightMode: captionCfg.highlightMode as CaptionStyle["highlightMode"],
    autoScale: captionCfg.autoScale,
    autoMovement: captionCfg.autoMovement,
    subtleRotation: captionCfg.subtleRotation,
  };

  try {
    const captionResult = await applyCaptions(videoUrl, script, style, {
      subtitleUrl: resolvedSubtitleUrl ?? undefined,
      videoDurationSeconds: durationSeconds ?? undefined,
      videoEffects: videoEffects ?? undefined,
      visualSuggestions,
      cardTemplate: captionCfg.cardTemplate ?? undefined,
    });

    if (captionResult.url) {
      await db.update(videosTable)
        .set({ captionedVideoUrl: captionResult.url, captionStatus: "done", updatedAt: new Date() })
        .where(eq(videosTable.id, videoId));
      logger.info({ videoId }, "[CaptionEngine] Captioned video ready");
    } else {
      await db.update(videosTable)
        .set({ captionStatus: "failed", updatedAt: new Date() })
        .where(eq(videosTable.id, videoId));
      logger.warn({ videoId, error: captionResult.error }, "[CaptionEngine] Failed — using original video");
    }
  } catch (captionErr) {
    logger.error({ videoId, captionErr }, "[CaptionEngine] Unexpected error — using original video");
    await db.update(videosTable)
      .set({ captionStatus: "failed", updatedAt: new Date() })
      .where(eq(videosTable.id, videoId)).catch(() => {});
  }

  // ── Trigger IG copy generation after captions (success or fail) ──────────
  if (contentPlanId) {
    runCopyGeneration(contentPlanId).catch((err) =>
      logger.error({ videoId, contentPlanId, err }, "[CopyEngine] Failed to start copy generation after captions")
    );
  }
}

/**
 * Auto-generate the Instagram description (caption) and hashtags for a content
 * plan item after its video is ready.  Runs after Caption Studio completes (or
 * is disabled) so the copy is tightly related to the final rendered video.
 *
 * Uses an atomic claim (null → generating) so concurrent ticks / manual runs
 * cannot start a second generation for the same item.
 */
async function runCopyGeneration(contentItemId: number): Promise<void> {
  // Claim atomically: only run if copy_status is still null
  const claimed = await db
    .update(contentPlanItemsTable)
    .set({ copyStatus: "generating", updatedAt: new Date() })
    .where(and(eq(contentPlanItemsTable.id, contentItemId), isNull(contentPlanItemsTable.copyStatus)))
    .returning({ id: contentPlanItemsTable.id });

  if (claimed.length === 0) {
    logger.info({ contentItemId }, "[CopyEngine] Copy already started or done — skipping");
    return;
  }

  let item: typeof contentPlanItemsTable.$inferSelect | undefined;

  try {
    [item] = await db.select().from(contentPlanItemsTable).where(eq(contentPlanItemsTable.id, contentItemId));
    if (!item) throw new Error("Content item not found");

    const [settings] = await db.select().from(settingsTable)
      .where(eq(settingsTable.userId, item.userId)).limit(1);
    const niche    = settings?.niche    || "general";
    const tone     = settings?.tone     || "profesional";
    const language = settings?.language || "es";

    const result = await regenerateCaption(
      item.topic,
      item.script ?? item.topic,
      niche,
      tone,
      language,
      undefined,              // topCaptions — not available in automation context
    );

    await db
      .update(contentPlanItemsTable)
      .set({ caption: result.caption, hashtags: result.hashtags, copyStatus: "done", updatedAt: new Date() })
      .where(eq(contentPlanItemsTable.id, contentItemId));

    logger.info({ contentItemId }, "[CopyEngine] Description & hashtags generated ✓");
  } catch (err) {
    logger.error({ contentItemId, err }, "[CopyEngine] Failed to generate copy");
    await db
      .update(contentPlanItemsTable)
      .set({ copyStatus: "failed", updatedAt: new Date() })
      .where(eq(contentPlanItemsTable.id, contentItemId))
      .catch(() => {});
  }

  // ── Trigger auto-publish if configured ───────────────────────────────────
  // processGeneratingVideos skips direct auto-publish for plan-linked items so
  // copy can generate first. Fire it here once copy is terminal (done or failed).
  if (item?.videoId) {
    const [automation] = await db.select().from(automationConfigTable)
      .where(eq(automationConfigTable.userId, item.userId)).limit(1);
    if (automation?.enabled && automation?.autoPublish) {
      const [video] = await db.select().from(videosTable).where(eq(videosTable.id, item.videoId));
      const captionTerminal =
        video?.captionStatus === "done" ||
        video?.captionStatus === "failed" ||
        video?.captionStatus === "disabled";
      if (video?.status === "ready" && captionTerminal) {
        publishVideoToInstagram(item.videoId).catch((err) =>
          logger.error({ videoId: item.videoId, err }, "[CopyEngine] Auto-publish failed after copy generation")
        );
      }
    }
  }
}

/**
 * Auto-refresh Instagram long-lived tokens that expire in < 30 days.
 * Instagram allows refreshing any valid token (even with 1 day left) via ig_refresh_token.
 * On failure, marks the account as needs_reconnection so the user is warned before
 * the next publish attempt rather than seeing a cryptic "Container processing failed".
 */
async function refreshExpiringTokens(): Promise<void> {
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  try {
    const expiringAccounts = await db
      .select()
      .from(instagramAccountsTable)
      .where(
        and(
          isNotNull(instagramAccountsTable.tokenExpiresAt),
          lte(instagramAccountsTable.tokenExpiresAt as any, thirtyDaysFromNow),
          // Don't retry accounts already marked as broken — they need manual reconnection
          eq(instagramAccountsTable.needsReconnection, false),
        )
      );

    for (const account of expiringAccounts) {
      try {
        const { accessToken: newToken, expiresAt } = await refreshInstagramToken(account.accessToken);
        await db
          .update(instagramAccountsTable)
          .set({ accessToken: newToken, tokenExpiresAt: expiresAt, needsReconnection: false, updatedAt: new Date() })
          .where(eq(instagramAccountsTable.id, account.id));
        logger.info({ userId: account.userId, newExpiry: expiresAt.toISOString() }, "[IG/TokenRefresh] Token auto-refreshed successfully");
      } catch (err) {
        logger.error({ userId: account.userId, err }, "[IG/TokenRefresh] Auto-refresh failed — marking account as needs_reconnection");
        await db
          .update(instagramAccountsTable)
          .set({ needsReconnection: true, updatedAt: new Date() })
          .where(eq(instagramAccountsTable.id, account.id));
      }
    }
  } catch (err) {
    // Non-fatal: log and continue — the rest of the polling cycle must not be blocked
    logger.warn({ err }, "[IG/TokenRefresh] Error querying expiring tokens");
  }
}

/**
 * Transcribe a TTS audio file with OpenAI Whisper (word-level timestamps) and
 * store the result as a word-level SRT in Object Storage.
 *
 * Returns the public proxy URL of the SRT so it can be saved to
 * `videos.heygen_subtitle_url` and consumed by the browser caption engine
 * exactly like HeyGen-supplied subtitles — giving WaveSpeed videos accurate
 * per-word caption sync instead of the proportional fallback.
 *
 * Non-fatal: returns null on any error so video generation is never blocked.
 */
/**
 * Transcribe the audio track of a video file (MP4) to a word-level SRT and
 * upload it to Object Storage.
 *
 * WHY we accept the final talking-head MP4 (not the original TTS MP3):
 *   InfiniteTalk (WaveSpeed) may add pre-speech silence or apply time-stretch
 *   before the avatar begins speaking.  Transcribing the TTS audio produces
 *   timestamps relative to the raw MP3, which then drift behind the actual
 *   voice in the composed video.  Transcribing the MP4's own audio stream
 *   ensures word timestamps match the video frame-for-frame.
 *
 * Process:
 *   1. Download the MP4 to a tmp file.
 *   2. Extract audio as 16 kHz mono WAV (FFmpeg) — small file, Whisper-optimal.
 *   3. Transcribe with Whisper (word-level verbose_json).
 *   4. Build SRT and upload to Object Storage.
 */
async function transcribeAudioToSrt(videoUrl: string, videoId: number): Promise<string | null> {
  const tmpVideo = `/tmp/ws-video-${videoId}.mp4`;
  const tmpAudio = `/tmp/ws-audio-${videoId}.wav`;
  try {
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) throw new Error("Object storage not configured");

    // 1. Download the talking-head MP4 from Object Storage / CDN
    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!videoRes.ok) throw new Error(`Video download failed: HTTP ${videoRes.status}`);
    nodeFs.writeFileSync(tmpVideo, Buffer.from(await videoRes.arrayBuffer()));

    // 2. Extract audio — 16 kHz mono WAV for Whisper.
    //    This captures any leading silence InfiniteTalk prepended before speech,
    //    so Whisper timestamps are relative to the video's t=0, not the TTS audio.
    await execFileAsync("ffmpeg", [
      "-y", "-i", tmpVideo,
      "-vn",                  // drop video stream
      "-acodec", "pcm_s16le", // uncompressed PCM
      "-ar",  "16000",        // 16 kHz
      "-ac",  "1",            // mono
      tmpAudio,
    ]);
    const audioBuffer = nodeFs.readFileSync(tmpAudio);

    // 3. Transcribe with Whisper — word-level granularity for precise per-word timing.
    //    The prompt primes the model with Spanish context so it doesn't mis-recognise
    //    Spanish phonemes as English words (common with accented vowels and ñ/ll/rr).
    const openai   = makeOpenAIClient({ timeout: 120_000 });
    // The Replit AI proxy exposes gpt-4o-mini-transcribe but does NOT support
    // response_format:"verbose_json" or timestamp_granularities.
    // We use "srt" which the proxy does support and returns phrase-level timestamps —
    // much better than proportional fallback even without word-level precision.
    const srtContent = await openai.audio.transcriptions.create({
      file:            new File([audioBuffer], "audio.wav", { type: "audio/wav" }),
      model:           "gpt-4o-mini-transcribe",
      language:        "es",
      prompt:          "Guion de video en español. Habla directamente a cámara sobre marketing, negocios o emprendimiento.",
      response_format: "srt",
    } as Parameters<typeof openai.audio.transcriptions.create>[0]) as unknown as string;

    if (!srtContent?.trim()) throw new Error("Whisper returned empty SRT");

    // Upload the SRT directly — the caption engine already knows how to parse it
    const objectName = `subtitles/${videoId}.srt`;
    await objectStorageClient
      .bucket(bucketId)
      .file(objectName)
      .save(Buffer.from(srtContent, "utf-8"), { contentType: "text/plain; charset=utf-8" });

    const domain = process.env.REPLIT_DEV_DOMAIN;
    if (!domain) throw new Error("REPLIT_DEV_DOMAIN not set");
    const srtUrl = `https://${domain}/api/captioned-objects/${objectName}`;

    const cueCount = (srtContent.match(/^\d+$/gm) ?? []).length;
    logger.info({ videoId, cueCount, srtUrl }, "[WaveSpeed] Whisper SRT uploaded ✓");
    return srtUrl;
  } catch (err) {
    logger.warn({ videoId, err }, "[WaveSpeed] Whisper transcription failed — captions will use proportional fallback");
    return null;
  } finally {
    // Clean up temp files regardless of outcome
    try { nodeFs.unlinkSync(tmpVideo); } catch {}
    try { nodeFs.unlinkSync(tmpAudio); } catch {}
  }
}

/**
 * Download a video (and optionally a thumbnail) from a temporary CDN URL and
 * upload both to Object Storage so the platform URLs stay valid permanently.
 *
 * Called immediately when HeyGen or WaveSpeed mark a video "completed".
 * Falls back to the original CDN URL on any error so generation is never blocked.
 */
async function persistVideoAssetsToStorage(
  videoId: number,
  videoUrl: string,
  thumbnailUrl: string | null | undefined,
): Promise<{ videoUrl: string; thumbnailUrl: string | null }> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  const domain   = process.env.REPLIT_DEV_DOMAIN;

  if (!bucketId || !domain) {
    logger.warn({ videoId }, "[PersistAssets] Object Storage not configured — keeping CDN URLs");
    return { videoUrl, thumbnailUrl: thumbnailUrl ?? null };
  }

  const bucket = objectStorageClient.bucket(bucketId);
  let persistentVideoUrl      = videoUrl;
  let persistentThumbnailUrl  = thumbnailUrl ?? null;

  // ── Video ──────────────────────────────────────────────────────────────────
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const objectName = `raw-videos/${videoId}.mp4`;
    await bucket.file(objectName).save(buf, { contentType: "video/mp4" });
    persistentVideoUrl = `https://${domain}/api/captioned-objects/${objectName}`;
    logger.info({ videoId, objectName }, "[PersistAssets] Video uploaded to Object Storage");
  } catch (err) {
    logger.warn({ videoId, err }, "[PersistAssets] Video upload failed — keeping original URL");
  }

  // ── Thumbnail ──────────────────────────────────────────────────────────────
  if (thumbnailUrl) {
    try {
      const res = await fetch(thumbnailUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const objectName = `thumbnails/${videoId}.jpg`;
      await bucket.file(objectName).save(buf, { contentType: "image/jpeg" });
      persistentThumbnailUrl = `https://${domain}/api/captioned-objects/${objectName}`;
      logger.info({ videoId, objectName }, "[PersistAssets] Thumbnail uploaded to Object Storage");
    } catch (err) {
      logger.warn({ videoId, err }, "[PersistAssets] Thumbnail upload failed — keeping original URL");
    }
  }

  return { videoUrl: persistentVideoUrl, thumbnailUrl: persistentThumbnailUrl };
}

/**
 * Send a one-time email when an automated video generation permanently fails.
 * Rate-limited to one email per user per hour to avoid notification floods.
 * Always swallows errors so it never disrupts the calling code path.
 */
async function sendVideoFailedAlert(userId: number, contentPlanItemId: number | null): Promise<void> {
  if (!contentPlanItemId) return;
  const now = Date.now();
  const lastAlert = failureAlertsSent.get(userId) ?? 0;
  if (now - lastAlert < FAILURE_ALERT_COOLDOWN_MS) return; // rate-limited
  failureAlertsSent.set(userId, now);

  try {
    const [user] = await db
      .select({ email: users.email, name: users.fullName })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.email) return;

    const [item] = await db
      .select({ topic: contentPlanItemsTable.topic, scheduledAt: contentPlanItemsTable.scheduledAt })
      .from(contentPlanItemsTable)
      .where(eq(contentPlanItemsTable.id, contentPlanItemId));

    const name = user.name ?? "";
    const topic = item?.topic ?? "Sin título";
    const scheduledAt = item?.scheduledAt ? new Date(item.scheduledAt) : null;
    const { subject, html, text } = videoFailedEmail(name, topic, scheduledAt);
    await sendEmail({ to: user.email, subject, html, text });
    logger.info({ userId, contentPlanItemId }, "[Alert] Video failure email sent");
  } catch (err) {
    logger.warn({ userId, contentPlanItemId, err }, "[Alert] Could not send video failure email — non-fatal");
  }
}

export async function pollAndPublishVideos(): Promise<void> {
  // ── Recovery: provision payments that failed after the purchase was recorded ──
  // Finds purchases paid > 30 min ago where provisionedAt is still null.
  // Retries provision and stamps provisionedAt on success to prevent re-runs.
  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const unprovisionedPurchases = await db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.status, "completed"),
          isNull(purchases.provisionedAt),
          lt(purchases.createdAt, thirtyMinAgo),
        ),
      )
      .limit(5);

    // Use type-aware provisioning so:
    //   - topups never create accounts or grant tool-access
    //   - subscriptions create the subscription row and grant cycle credits
    //   - legacy program purchases get standard provisionUser behavior
    let stripe: ReturnType<typeof getStripe> | null = null;
    try { stripe = getStripe(); } catch { /* Stripe not configured — skip recovery */ }

    if (stripe) {
      for (const purchase of unprovisionedPurchases) {
        logger.warn(
          { purchaseId: purchase.id, email: purchase.email, purchaseType: purchase.purchaseType },
          "[ProvisionRecovery] Re-intentando provision fallida para pago exitoso",
        );
        const ok = await provisionPurchase(purchase, stripe);
        if (ok) {
          logger.info(
            { purchaseId: purchase.id },
            "[ProvisionRecovery] Provision recuperada exitosamente",
          );
        } else {
          logger.error(
            { purchaseId: purchase.id },
            "[ProvisionRecovery] Reintento fallido — se reintentará en el próximo ciclo",
          );
        }
      }
    }
  } catch (recoveryErr) {
    logger.warn({ recoveryErr }, "[ProvisionRecovery] Error en el barrido de provision recovery");
  }

  // ── Recovery: content items in "ready" state with null copy_status ────────
  // Handles server restarts or items created before copy generation was added.
  // Finds content items whose video has a terminal caption_status but whose
  // copy hasn't been generated yet, and triggers generation for each.
  const copyPendingItems = await db
    .select({ itemId: contentPlanItemsTable.id })
    .from(contentPlanItemsTable)
    .innerJoin(videosTable, eq(videosTable.id, contentPlanItemsTable.videoId))
    .where(
      and(
        eq(contentPlanItemsTable.status, "ready"),
        isNull(contentPlanItemsTable.copyStatus),
        inArray(videosTable.captionStatus as any, ["done", "failed", "disabled"])
      )
    );
  for (const { itemId } of copyPendingItems) {
    logger.info({ itemId }, "[CopyEngine] Recovery: triggering copy generation for item with null copy_status");
    runCopyGeneration(itemId).catch((err) =>
      logger.error({ itemId, err }, "[CopyEngine] Recovery: failed to generate copy")
    );
  }

  // ── Recovery: content items stuck in "scripting" ─────────────────────────
  // If the server restarted (or the AI call timed out) while a script was
  // being generated, the item is left in "scripting" and no cycle will pick
  // it up again.  Reset any such items back to "draft" after 10 minutes.
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const stuckScripting = await db
    .select({ id: contentPlanItemsTable.id })
    .from(contentPlanItemsTable)
    .where(and(
      eq(contentPlanItemsTable.status, "scripting"),
      lte(contentPlanItemsTable.updatedAt, tenMinAgo),
    ));
  for (const { id } of stuckScripting) {
    logger.warn({ itemId: id }, "[Recovery] Resetting stuck 'scripting' item back to 'draft'");
    await db
      .update(contentPlanItemsTable)
      .set({ status: "draft", updatedAt: new Date() })
      .where(and(
        eq(contentPlanItemsTable.id, id),
        eq(contentPlanItemsTable.status, "scripting"),
      ))
      .catch((err) => logger.error({ itemId: id, err }, "[Recovery] Failed to reset stuck scripting item"));
  }

  // ── Recovery: videos stuck in "ready" with captionStatus=null OR processing ─
  // Covers two cases:
  //   1. captionStatus=null  — processing never started (e.g. missing captionConfig)
  //   2. captionStatus=processing AND updated_at stale >10 min — server was restarted
  //      mid-processing and the job will never finish on its own.
  // subtitle_url is no longer available so the engine uses proportional-SRT fallback.
  const [automation] = await db.select().from(automationConfigTable).limit(1);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const stuckVideos = await db
    .select()
    .from(videosTable)
    .where(
      and(
        eq(videosTable.status, "ready"),
        or(
          isNull(videosTable.captionStatus),
          and(
            eq(videosTable.captionStatus, "processing"),
            lte(videosTable.updatedAt, tenMinutesAgo),
          ),
        ),
      ),
    );
  for (const v of stuckVideos) {
    if (!v.videoUrl) continue;
    if (automation?.captionsEnabled) {
      // Captions are still on — run (or re-run) caption processing.
      // Wrap in a 12-minute timeout so a hung AI call (e.g. gpt-image-1 with
      // no response) never blocks the entire polling loop indefinitely.
      logger.info({ videoId: v.id }, "[CaptionEngine] Recovery: re-processing stuck caption");
      const RECOVERY_TIMEOUT_MS = 12 * 60 * 1000;
      await Promise.race([
        runCaptionProcessing(v.id, v.videoUrl, v.contentPlanId ?? null, null, v.durationSeconds),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Recovery timeout after 12 min")), RECOVERY_TIMEOUT_MS)
        ),
      ]).catch((err) =>
        logger.error({ videoId: v.id, err }, "[CaptionEngine] Recovery failed")
      );
    } else {
      // Captions have been disabled since this video was created — unblock it
      // so the publish sweep can pick it up without waiting for caption processing.
      logger.info({ videoId: v.id }, "[CaptionEngine] Recovery: captions now disabled — marking video as disabled to unblock publish");
      await db
        .update(videosTable)
        .set({ captionStatus: "disabled", updatedAt: new Date() })
        .where(eq(videosTable.id, v.id))
        .catch((err) => logger.error({ videoId: v.id, err }, "[CaptionEngine] Recovery: failed to mark as disabled"));
    }
  }

  // ── Recovery: videos stuck in "publishing" ───────────────────────────────
  // Handles server restarts that interrupted the Instagram publish flow.
  const publishingStuck = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.status, "publishing"));
  for (const v of publishingStuck) {
    if (v.igContainerId) {
      // Container already created — resume polling it
      logger.info({ videoId: v.id, igContainerId: v.igContainerId }, "[Publish] Recovery: resuming stuck publishing video");
      await publishVideoToInstagram(v.id).catch((err) =>
        logger.error({ videoId: v.id, err }, "[Publish] Recovery failed for stuck publishing video")
      );
    } else {
      // Crashed before the Instagram container was created.
      // Mark as failed (not back to ready) to avoid an infinite retry loop:
      // resetting to ready + auto-publish would restart the same cycle
      // repeatedly without making progress.  The user can retry via the UI.
      await db
        .update(videosTable)
        .set({
          status: "failed",
          errorMessage: "Publicación interrumpida antes de crear el contenedor. Reintenta manualmente.",
          updatedAt: new Date(),
        })
        .where(eq(videosTable.id, v.id));
      logger.warn({ videoId: v.id }, "[Publish] Marked stuck publishing video (no container) as failed — user must retry");
    }
  }
  // ── Publish videos whose scheduled_publish_at has passed ─────────────────
  const now = new Date();
  const scheduledDue = await db
    .select()
    .from(videosTable)
    .where(
      and(
        eq(videosTable.status, "ready"),
        // scheduledPublishAt IS NOT NULL and <= now  (drizzle: lte from drizzle-orm)
        inArray(videosTable.captionStatus as any, ["done", "failed", "disabled"])
      )
    );
  for (const video of scheduledDue) {
    if (!video.scheduledPublishAt) continue;
    if (video.scheduledPublishAt > now) continue;
    try {
      logger.info({ videoId: video.id, scheduledAt: video.scheduledPublishAt }, "[Scheduler] Publishing scheduled video");
      await publishVideoToInstagram(video.id);
    } catch (err) {
      logger.error({ videoId: video.id, err }, "[Scheduler] Failed to publish scheduled video");
    }
  }

  // ── Auto-publish all ready videos when automation + auto_publish are on ──
  // Only publish when both caption AND copy are in a terminal state so the
  // Instagram description is ready before the post goes live.
  if (automation?.enabled && automation?.autoPublish) {
    // Rate limit: 5 minutes minimum between auto-publishes per account.
    // Prevents IG bans from burst-publishing when many videos are "ready" at once.
    const AUTO_PUBLISH_MIN_GAP_MS = 5 * 60 * 1000;
    const recentCutoff = new Date(Date.now() - AUTO_PUBLISH_MIN_GAP_MS);

    const readyVideos = await db
      .select({ id: videosTable.id, scheduledPublishAt: videosTable.scheduledPublishAt, userId: videosTable.userId })
      .from(videosTable)
      .leftJoin(contentPlanItemsTable, eq(contentPlanItemsTable.id, videosTable.contentPlanId))
      .where(
        and(
          eq(videosTable.status, "ready"),
          inArray(videosTable.captionStatus as any, ["done", "failed", "disabled"]),
          // copy must be terminal OR video has no linked content plan
          or(
            isNull(videosTable.contentPlanId),
            inArray(contentPlanItemsTable.copyStatus as any, ["done", "failed"])
          )
        )
      );

    // Track which userIds already had a publish triggered this cycle (max 1 per account per cycle)
    const publishedThisCycle = new Set<number>();

    for (const video of readyVideos) {
      if (video.scheduledPublishAt) continue; // handled in the scheduled sweep above

      // Max 1 auto-publish per user account per cron cycle
      if (publishedThisCycle.has(video.userId)) {
        logger.info({ videoId: video.id, userId: video.userId }, "[Scheduler] Rate limit: already auto-publishing for this account this cycle — deferring");
        continue;
      }

      // Check if this account published anything in the last 5 minutes
      const [recentPublish] = await db
        .select({ publishedAt: videosTable.publishedAt })
        .from(videosTable)
        .where(and(
          eq(videosTable.userId, video.userId),
          eq(videosTable.status, "published"),
          gte(videosTable.publishedAt as any, recentCutoff),
        ))
        .orderBy(desc(videosTable.publishedAt))
        .limit(1);

      if (recentPublish) {
        logger.info({ videoId: video.id, userId: video.userId }, "[Scheduler] Rate limit: last publish was < 5 min ago — deferring to next cycle");
        continue;
      }

      publishedThisCycle.add(video.userId);
      try {
        logger.info({ id: video.id }, "[Scheduler] Publishing stalled ready video");
        await publishVideoToInstagram(video.id);
      } catch (err) {
        logger.error({ id: video.id, err }, "[Scheduler] Failed to publish stalled video");
      }
    }
  }

  // ── Poll HeyGen for videos still generating ───────────────────────────────
  const generatingVideos = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.status, "generating"));

  const pollTimeoutMs = Number(process.env.HEYGEN_POLL_TIMEOUT_MINUTES ?? 60) * 60 * 1000;

  for (const video of generatingVideos) {
    if (!video.heygenVideoId) {
      // Orphan: generateVideo() returned an ID but the DB update crashed before
      // persisting it. We have no way to look up the HeyGen job by ID, so we
      // wait 5 minutes then mark the video as failed and reset the content item
      // to 'scripted' (not 'failed') so the automation retries it cleanly.
      const orphanAgeMs = Date.now() - (video.generatingStartedAt ?? new Date()).getTime();
      if (orphanAgeMs > 5 * 60 * 1000) {
        const orphanMsg = "ID de HeyGen no persistido (posible caída del servidor). El item fue restablecido para reintento automático.";
        logger.warn({ videoId: video.id, orphanAgeMs }, "[Recovery] Video huérfano (sin heygenVideoId) — marcando fallido, restableciendo item a 'scripted'");
        await db
          .update(videosTable)
          .set({ status: "failed", errorMessage: orphanMsg, updatedAt: new Date() })
          .where(eq(videosTable.id, video.id));
        if (video.contentPlanId) {
          // Reset to 'scripted' so the scheduler retries automatically on the next cycle.
          await db
            .update(contentPlanItemsTable)
            .set({ status: "scripted", updatedAt: new Date() })
            .where(and(
              eq(contentPlanItemsTable.id, video.contentPlanId),
              eq(contentPlanItemsTable.status, "generating"),
            ));
        }
        await releaseVideoCredits(video.id, "Video huérfano — ID de HeyGen no persistido").catch((err) =>
          logger.error({ videoId: video.id, err }, "[Credits] Release falló para video huérfano")
        );
      }
      continue;
    }

    // ── WaveSpeed polling: sentinel "wavespeed-{stage}:{requestId}" ───────
    // Two-stage pipeline:
    //   wavespeed-tts:{id}  → poll TTS; when done submit talking-head
    //   wavespeed-th:{id}   → poll talking-head; when done mark video ready
    if (video.heygenVideoId.startsWith("wavespeed-")) {
      const [stage, requestId] = video.heygenVideoId.replace("wavespeed-", "").split(":");
      if (!requestId) continue;
      try {
        const jobResult = await getWavespeedJobStatus(requestId);

        if (stage === "tts") {
          if (jobResult.status === "completed") {
            // Extract audio URL from outputs.
            // WaveSpeed returns outputs as a plain string[] (CloudFront URLs), not a keyed object.
            // Handle both shapes so a future schema change doesn't silently break this.
            const rawOutputs = jobResult.outputs;
            const audioUrl: string | undefined = Array.isArray(rawOutputs)
              ? (typeof rawOutputs[0] === "string" ? rawOutputs[0] : (rawOutputs[0] as { url?: string })?.url)
              : (() => { const o = (rawOutputs ?? {}) as Record<string, unknown>; return (o["audio_url"] ?? o["audio"] ?? o["url"]) as string | undefined; })();
            if (!audioUrl) {
              throw new Error(`TTS completado pero sin audio_url en outputs: ${JSON.stringify(rawOutputs)}`);
            }

            // Find imageUrl stored in the TTS job's inputPayload
            const [ttsJobRow] = await db
              .select({ inputPayload: wavespeedJobsTable.inputPayload })
              .from(wavespeedJobsTable)
              .where(
                and(
                  eq(wavespeedJobsTable.wavespeedRequestId, requestId),
                  eq(wavespeedJobsTable.relatedVideoId, video.id),
                ),
              )
              .limit(1);
            const imageUrl: string | undefined = ttsJobRow?.inputPayload
              ? (JSON.parse(ttsJobRow.inputPayload) as { imageUrl?: string }).imageUrl
              : undefined;
            if (!imageUrl) {
              throw new Error("No se encontró imageUrl para el paso de talking-head");
            }

            // Mark TTS job done
            await db
              .update(wavespeedJobsTable)
              .set({ status: "completed", outputUrl: audioUrl, updatedAt: new Date() })
              .where(eq(wavespeedJobsTable.wavespeedRequestId, requestId));

            // Submit talking-head job
            // Build a topic-aware motion prompt so the model produces natural
            // body movement suited to the content — falls back to the library
            // default when no topic is stored on the video row.
            const motionPrompt = video.topic
              ? `Natural upper body movement with expressive gestures and slight head turns. ` +
                `Dynamic presenter energy: torso sway, occasional hand movement, engaged eye contact. ` +
                `Professional content creator speaking directly to camera about: ${video.topic}.`
              : undefined; // undefined → submitTalkingHead uses TALKING_HEAD_DEFAULT_PROMPT
            logger.info({ videoId: video.id, audioUrl, motionPrompt: motionPrompt?.slice(0, 80) }, "[WaveSpeed] TTS completado — enviando talking-head");
            const { requestId: thRequestId } = await submitTalkingHead(imageUrl, audioUrl, { prompt: motionPrompt });

            await db.insert(wavespeedJobsTable).values({
              userId: video.userId,
              model: WAVESPEED_MODELS.TALKING_HEAD,
              status: "processing",
              wavespeedRequestId: thRequestId,
              inputPayload: JSON.stringify({ image_url: imageUrl, audio_url: audioUrl }),
              relatedVideoId: video.id,
            });

            await db
              .update(videosTable)
              .set({ heygenVideoId: `wavespeed-th:${thRequestId}`, updatedAt: new Date() })
              .where(eq(videosTable.id, video.id));

            logger.info({ videoId: video.id, thRequestId }, "[WaveSpeed] Talking-head job enviado");
          } else if (jobResult.status === "failed") {
            throw new Error(`TTS fallido: ${jobResult.error ?? "error desconocido"}`);
          }
          // queued/processing → keep polling next cycle
        } else if (stage === "th") {
          if (jobResult.status === "completed") {
            // Same dual-shape handling: outputs may be string[] or keyed object.
            const rawOutputs = jobResult.outputs;
            const videoUrl: string | undefined = Array.isArray(rawOutputs)
              ? (typeof rawOutputs[0] === "string" ? rawOutputs[0] : (rawOutputs[0] as { url?: string })?.url)
              : (() => { const o = (rawOutputs ?? {}) as Record<string, unknown>; return (o["video_url"] ?? o["video"] ?? o["url"]) as string | undefined; })();
            if (!videoUrl) {
              throw new Error(`Talking-head completado pero sin video_url en outputs: ${JSON.stringify(rawOutputs)}`);
            }

            await db
              .update(wavespeedJobsTable)
              .set({ status: "completed", outputUrl: videoUrl, updatedAt: new Date() })
              .where(eq(wavespeedJobsTable.wavespeedRequestId, requestId));

            // Download from WaveSpeed CDN and store in Object Storage for permanent URLs.
            const persistent = await persistVideoAssetsToStorage(video.id, videoUrl, null);
            await db
              .update(videosTable)
              .set({ status: "ready", videoUrl: persistent.videoUrl, updatedAt: new Date() })
              .where(eq(videosTable.id, video.id));

            await consumeVideoCredits(video.id).catch((err) =>
              logger.error({ videoId: video.id, err }, "[Credits][WaveSpeed] Consume falló al completar video")
            );

            if (video.contentPlanId) {
              await db
                .update(contentPlanItemsTable)
                .set({ status: "ready", updatedAt: new Date() })
                .where(eq(contentPlanItemsTable.id, video.contentPlanId));
            }

            logger.info({ videoId: video.id, videoUrl }, "[WaveSpeed] Video listo");

            // ── Whisper transcription from the final MP4 audio track ──────────
            // MUST run after the talking-head is complete, NOT after TTS.
            // InfiniteTalk may prepend silence before speech begins; transcribing
            // the MP4 audio captures that silence so word timestamps are aligned
            // with what the avatar actually says at each video frame.
            const srtUrl = await transcribeAudioToSrt(persistent.videoUrl, video.id);
            if (srtUrl) {
              await db
                .update(videosTable)
                .set({ heygenSubtitleUrl: srtUrl, updatedAt: new Date() })
                .where(eq(videosTable.id, video.id));
            }

            // Caption processing (WaveSpeed has no subtitle_url; engine will use the SRT above)
            if (video.captionStatus === null) {
              const [autoCfg] = await db.select({ captionsEnabled: automationConfigTable.captionsEnabled })
                .from(automationConfigTable)
                .where(eq(automationConfigTable.userId, video.userId))
                .limit(1);
              if (autoCfg?.captionsEnabled) {
                await runCaptionProcessing(video.id, persistent.videoUrl, video.contentPlanId ?? null, srtUrl ?? null, undefined);
              } else {
                await db
                  .update(videosTable)
                  .set({ captionStatus: "disabled", updatedAt: new Date() })
                  .where(eq(videosTable.id, video.id));
                if (video.contentPlanId) {
                  runCopyGeneration(video.contentPlanId).catch((err) =>
                    logger.error({ videoId: video.id, contentPlanId: video.contentPlanId, err }, "[CopyEngine][WaveSpeed] Failed to start copy generation")
                  );
                }
              }
            }
          } else if (jobResult.status === "failed") {
            throw new Error(`Talking-head fallido: ${jobResult.error ?? "error desconocido"}`);
          }
          // queued/processing → keep polling next cycle
        }
      } catch (wsErr: any) {
        const wsError = wsErr instanceof Error ? wsErr.message : String(wsErr);
        logger.error({ videoId: video.id, stage, requestId, wsError }, "[WaveSpeed] Error en polling");
        await db
          .update(videosTable)
          .set({ status: "failed", errorMessage: wsError, updatedAt: new Date() })
          .where(eq(videosTable.id, video.id));
        if (video.contentPlanId) {
          await db
            .update(contentPlanItemsTable)
            .set({ status: "scripted", updatedAt: new Date() }) // retryable
            .where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }
        await releaseVideoCredits(video.id, `WaveSpeed fallo: ${wsError}`).catch((err) =>
          logger.error({ videoId: video.id, err }, "[Credits][WaveSpeed] Release falló en error de polling")
        );
      }
      continue; // skip HeyGen polling for this video
    }

    // ── Track polling attempts and generation start time ──────────────────
    const now = new Date();
    const startedAt = video.generatingStartedAt ?? now;
    const newAttempts = (video.pollAttempts ?? 0) + 1;

    await db
      .update(videosTable)
      .set({
        pollAttempts: newAttempts,
        generatingStartedAt: video.generatingStartedAt ?? now,
        updatedAt: now,
      })
      .where(eq(videosTable.id, video.id));

    // ── Timeout check ─────────────────────────────────────────────────────
    const ageMs = now.getTime() - startedAt.getTime();
    if (ageMs > pollTimeoutMs) {
      const timeoutMinutes = Math.round(pollTimeoutMs / 60000);
      const timeoutMsg = `Video atascado: HeyGen no respondió en ${timeoutMinutes} minutos (${newAttempts} intentos)`;
      await db
        .update(videosTable)
        .set({ status: "failed", errorMessage: timeoutMsg, updatedAt: now })
        .where(eq(videosTable.id, video.id));
      if (video.contentPlanId) {
        await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: now }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
      }
      sendVideoFailedAlert(video.userId, video.contentPlanId ?? null).catch(() => {});
      logger.warn({ videoId: video.id, ageMs, attempts: newAttempts }, timeoutMsg);
      await releaseVideoCredits(video.id, `Video timeout: ${timeoutMsg}`).catch((err) =>
        logger.error({ videoId: video.id, err }, "[Credits] Release falló en timeout")
      );
      continue;
    }

    try {
      const pollApiKey = await resolveHeyGenApiKey(video.userId);
      const status = await getVideoStatus(video.heygenVideoId, pollApiKey);
      if (status.status === "completed" && status.video_url) {
        // Download video + thumbnail from HeyGen CDN immediately and store in Object Storage
        // so the platform URLs never expire (HeyGen CDN links last ~7 days only).
        const persistent = await persistVideoAssetsToStorage(
          video.id, status.video_url, status.thumbnail_url ?? null
        );
        await db
          .update(videosTable)
          .set({
            status: "ready",
            videoUrl: persistent.videoUrl,
            thumbnailUrl: persistent.thumbnailUrl,
            durationSeconds: status.duration ? Math.round(status.duration) : null,
            // Persist subtitle URL so captions can be re-applied with real word timings later
            heygenSubtitleUrl: status.subtitle_url ?? null,
            updatedAt: new Date(),
          })
          .where(eq(videosTable.id, video.id));

        // Consume the credit reservation — video completed successfully.
        await consumeVideoCredits(video.id).catch((err) =>
          logger.error({ videoId: video.id, err }, "[Credits] Consume falló al completar video")
        );

        if (video.contentPlanId) {
          await db
            .update(contentPlanItemsTable)
            .set({ status: "ready", updatedAt: new Date() })
            .where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }

        logger.info({ videoId: video.id }, "Video ready");

        // ── Caption Studio ────────────────────────────────────────────────────
        // Re-read automation.captionsEnabled at completion time so that toggling
        // captions on/off in Caption Studio is respected immediately — even for
        // videos that were already in the pipeline when the setting changed.
        if (video.captionStatus === null) {
          if (automation?.captionsEnabled) {
            await runCaptionProcessing(
              video.id,
              status.video_url,
              video.contentPlanId ?? null,
              status.subtitle_url,   // HeyGen word-level SRT (only available here)
              status.duration ?? null
            );
          } else {
            // Captions disabled — skip Caption Studio and unblock publish
            await db
              .update(videosTable)
              .set({ captionStatus: "disabled", updatedAt: new Date() })
              .where(eq(videosTable.id, video.id));
            logger.info({ videoId: video.id }, "[Scheduler] Captions disabled — skipping Caption Studio step");
            // Trigger copy generation directly since captions won't fire it
            if (video.contentPlanId) {
              runCopyGeneration(video.contentPlanId).catch((err) =>
                logger.error({ videoId: video.id, contentPlanId: video.contentPlanId, err }, "[CopyEngine] Failed to start copy generation (captions disabled)")
              );
            }
          }
        }
        // captionStatus "disabled" was set at creation or above — no further action needed.
        // ─────────────────────────────────────────────────────────────────────

        // Auto-publish only when master switch + auto_publish are on AND captions
        // are in a terminal state AND there is no pending copy generation.
        // If this video has a content plan item, runCopyGeneration will trigger
        // auto-publish once copy is ready (~10 sec). Skip direct publish here
        // so the copy step completes first.
        const captionTerminal =
          video.captionStatus === "done" ||
          video.captionStatus === "failed" ||
          video.captionStatus === "disabled";
        const noCopyPending = !video.contentPlanId; // plan-linked items: copy handles publish
        if (automation?.enabled && automation?.autoPublish && status.video_url && captionTerminal && noCopyPending) {
          await publishVideoToInstagram(video.id);
        }
      } else if (status.status === "failed") {
        const providerError = status.error ?? "Error desconocido en la generación";
        await db
          .update(videosTable)
          .set({ status: "failed", errorMessage: providerError, updatedAt: new Date() })
          .where(eq(videosTable.id, video.id));

        await releaseVideoCredits(video.id, `Fallo en generación: ${providerError}`).catch((err) =>
          logger.error({ videoId: video.id, err }, "[Credits] Release falló tras fallo en generación")
        );

        if (video.contentPlanId) {
          await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }
        sendVideoFailedAlert(video.userId, video.contentPlanId ?? null).catch(() => {});
      }
    } catch (err: any) {
      // ── Classify HeyGen HTTP errors ──────────────────────────────────────
      const httpStatus: number | undefined = err?.response?.status ?? err?.status;
      let userMsg: string;
      let markFailed = false;

      if (httpStatus === 401) {
        userMsg = "Credencial de generación inválida — contacta soporte";
        markFailed = true; // Permanent — won't self-heal on retry
      } else if (httpStatus === 402) {
        userMsg = "Cuota de generación agotada — el servicio está temporalmente no disponible";
        markFailed = true; // Permanent — won't self-heal on retry
      } else if (httpStatus === 429) {
        userMsg = "Límite de generación alcanzado — el sistema reintentará en el próximo ciclo";
        markFailed = false; // Transient — will retry
      } else if (httpStatus !== undefined && httpStatus >= 500) {
        userMsg = `Error del servicio de generación (${httpStatus}) — el sistema reintentará automáticamente`;
        markFailed = false; // Transient — will retry
      } else {
        userMsg = err instanceof Error ? err.message : String(err);
        markFailed = false;
      }

      if (markFailed) {
        await db
          .update(videosTable)
          .set({ status: "failed", errorMessage: userMsg, updatedAt: new Date() })
          .where(eq(videosTable.id, video.id));
        await releaseVideoCredits(video.id, `Error HTTP ${httpStatus}: ${userMsg}`).catch((err) =>
          logger.error({ videoId: video.id, err }, "[Credits] Release falló tras error HTTP permanente")
        );
        if (video.contentPlanId) {
          await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }
        sendVideoFailedAlert(video.userId, video.contentPlanId ?? null).catch(() => {});
        logger.error({ videoId: video.id, httpStatus }, userMsg);
      } else {
        logger.warn({ videoId: video.id, httpStatus, err }, `Transient polling error (will retry): ${userMsg}`);
      }
    }
  }

  // ── Token refresh sweep — runs every polling cycle (every minute) ─────────
  // Refreshes tokens expiring in < 30 days before they cause publish failures.
  await refreshExpiringTokens();
}

export async function publishVideoToInstagram(videoId: number, videoUrl?: string): Promise<void> {
  // In-process mutex: prevent the recovery scheduler from re-entering this function
  // for a video already being actively published (would cause duplicate posts).
  if (activePublishes.has(videoId)) {
    logger.info({ videoId }, "[Publish] Already publishing in this process — skipping concurrent call");
    return;
  }
  activePublishes.add(videoId);
  try {
    await _publishVideoToInstagramInner(videoId, videoUrl);
  } finally {
    activePublishes.delete(videoId);
  }
}

async function _publishVideoToInstagramInner(videoId: number, videoUrl?: string): Promise<void> {
  const [initial] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!initial) throw new Error("Video not found");

  // Idempotency guard — skip if already published.
  // Check both status AND igMediaId: the status may still be "publishing" if the
  // server crashed after publishContainer succeeded but before the DB update ran.
  if (initial.status === "published" || initial.igMediaId) {
    logger.info({ videoId, status: initial.status, hasIgMediaId: !!initial.igMediaId }, "[Publish] Video already published — skipping");
    return;
  }

  // Atomically claim: transition current status → publishing using optimistic locking.
  // WHERE status = initial.status ensures only one concurrent request succeeds.
  // The recovery path (status already "publishing") skips this and continues below.
  if (initial.status !== "publishing") {
    const claimed = await db
      .update(videosTable)
      .set({ status: "publishing", updatedAt: new Date() })
      .where(and(eq(videosTable.id, videoId), eq(videosTable.status, initial.status)))
      .returning({ id: videosTable.id });
    if (claimed.length === 0) {
      // Another concurrent request claimed it first — bail out safely.
      logger.info({ videoId, prevStatus: initial.status }, "[Publish] Video already claimed by concurrent request — skipping");
      return;
    }
  }

  // Re-read with fresh data after the status transition.
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) throw new Error("Video disappeared after claim");

  // Use captioned URL if available (Caption Studio layer), fallback to original.
  // Captioned files live in /tmp which is cleared on every server restart.
  // Before passing the URL to Instagram, verify the file still exists on disk.
  // If it was wiped, fall back to the raw HeyGen URL so the publish doesn't
  // fail with a mysterious "Container processing failed" from Instagram.
  const rawUrl = videoUrl ?? video.videoUrl;
  if (!rawUrl) throw new Error("Video URL not available");

  let url = rawUrl;
  if (video.captionedVideoUrl) {
    const captionedUrl = video.captionedVideoUrl;

    if (captionedUrl.startsWith("https://")) {
      // Stored captionedVideoUrl goes through Replit's mTLS proxy (REPLIT_DEV_DOMAIN)
      // which Instagram's servers cannot reach in dev OR production.
      // Generate a short-lived signed GCS URL instead — publicly accessible everywhere.
      const devDomain = process.env.REPLIT_DEV_DOMAIN;
      const captionedObjectsPrefix = `/api/captioned-objects/`;
      if (devDomain && captionedUrl.includes(devDomain) && captionedUrl.includes(captionedObjectsPrefix)) {
        const objectName = captionedUrl.split(captionedObjectsPrefix)[1];
        try {
          url = await getSignedCaptionedVideoUrl(objectName);
          logger.info({ videoId, objectName }, "[Publish] Generated signed GCS URL for Instagram");
        } catch (signErr) {
          // Signing failed — fall back to the ORIGINAL public HeyGen URL, NOT captionedUrl.
          // captionedUrl points to the Replit dev domain (mTLS) which Instagram's servers cannot
          // reach from outside, so using it as a fallback always causes "Container processing failed".
          url = rawUrl;
          logger.warn({ videoId, signErr }, "[Publish] Could not sign GCS URL — falling back to original HeyGen URL (captions will be missing)");
        }
      } else {
        url = captionedUrl;
        logger.info({ videoId, captionedUrl: url.slice(0, 80) }, "[Publish] Using captioned video from HTTPS URL");
      }
    } else {
      // Legacy: URL pointed to the dev server's /tmp directory.
      // Verify the file still exists on disk before using it.
      const filename = captionedUrl.split("/").pop() ?? "";
      const filePath = filename ? nodePath.join(CAPTION_DIR, filename) : "";
      const fileExists = filePath ? nodeFs.existsSync(filePath) : false;

      if (fileExists) {
        url = captionedUrl;
        logger.info({ videoId, captionedUrl: url.slice(0, 60) }, "[Publish] Using captioned video from disk (legacy)");
      } else {
        logger.warn(
          { videoId, captionedUrl: captionedUrl.slice(0, 60) },
          "[Publish] Legacy captioned file not found on disk (server restart wiped /tmp) — falling back to HeyGen URL"
        );
        // Clear the stale captionedVideoUrl from DB so the UI reflects reality
        await db
          .update(videosTable)
          .set({ captionedVideoUrl: null, captionStatus: "failed", updatedAt: new Date() })
          .where(eq(videosTable.id, videoId));
      }
    }
  }

  // ── Fix: always scope to the video's owner — never use a global .limit(1) which
  // could publish a video from User A on the Instagram account of User B.
  const [igAccount] = await db.select().from(instagramAccountsTable)
    .where(eq(instagramAccountsTable.userId, video.userId)).limit(1);
  if (!igAccount) throw new Error("Instagram account not connected for this user");

  // Guard: if auto-refresh previously failed, throw a clear error so the video
  // ends up as "failed" with an actionable message instead of a cryptic IG error.
  if (igAccount.needsReconnection) {
    throw new Error("El token de Instagram expiró. Reconecta tu cuenta en Ajustes → Instagram para continuar publicando.");
  }

  let caption = "";
  if (video.contentPlanId) {
    const [item] = await db.select().from(contentPlanItemsTable).where(eq(contentPlanItemsTable.id, video.contentPlanId));

    // Safety net: if the item reached publishing without a caption, generate it now
    if (item && !item.caption) {
      try {
        const [settings] = await db.select().from(settingsTable).limit(1);
        const result = await generateScript(
          item.topic,
          settings?.niche ?? "marketing digital",
          settings?.tone ?? "casual",
          settings?.language ?? "es",
          settings?.videoDurationSeconds ?? 60,
          {},
        );
        await db
          .update(contentPlanItemsTable)
          .set({ caption: result.caption, hashtags: result.hashtags, updatedAt: new Date() })
          .where(eq(contentPlanItemsTable.id, item.id));
        item.caption = result.caption;
        item.hashtags = result.hashtags;
        logger.info({ itemId: item.id }, "Caption generated before publishing");
      } catch (err) {
        logger.error({ itemId: item.id, err }, "Failed to generate caption before publishing; publishing without it");
      }
    }

    caption = [item?.caption, item?.hashtags].filter(Boolean).join("\n\n");
  }

  // Generate a branded cover image when auto_cover_enabled is set and brand colors exist.
  // If thumbnailCoverUrl is already saved (from a prior attempt), reuse it instead of
  // re-calling gpt-image-1 — avoids unnecessary API cost on publish retry.
  // Falls back gracefully: if the flag is off or generation fails, publish without a cover.
  let brandCoverUrl: string | null = video.thumbnailCoverUrl ?? null;
  if (!brandCoverUrl) {
    try {
      const [automationRow] = await db
        .select({ autoCoverEnabled: automationConfigTable.autoCoverEnabled })
        .from(automationConfigTable)
        .where(eq(automationConfigTable.userId, video.userId))
        .limit(1);
      const [brandSettings] = await db
        .select({
          brandPrimaryColor: settingsTable.brandPrimaryColor,
          brandAccentColor: settingsTable.brandAccentColor,
          brandLogoUrl: settingsTable.brandLogoUrl,
        })
        .from(settingsTable)
        .where(eq(settingsTable.userId, video.userId))
        .limit(1);
      // autoCoverEnabled is force-disabled pending plan-gate rollout (Task #276).
      // Replace this constant with the DB flag once billing UI is shipped.
      const FORCE_AUTO_COVER_DISABLED = true;
      if (!FORCE_AUTO_COVER_DISABLED && automationRow?.autoCoverEnabled && brandSettings?.brandPrimaryColor) {
        // Resolve the best hook text to use on the cover
        let coverText = video.topic ?? "Reel";
        if (video.contentPlanId) {
          const [itemForCover] = await db
            .select({ hook: contentPlanItemsTable.hook, topic: contentPlanItemsTable.topic })
            .from(contentPlanItemsTable)
            .where(eq(contentPlanItemsTable.id, video.contentPlanId))
            .limit(1);
          coverText = itemForCover?.hook ?? itemForCover?.topic ?? coverText;
        }
        // Resolve avatar preview photo — clean portrait used as gpt-image-1 reference.
        let avatarImageUrl: string | null = null;
        if (video.avatarId) {
          const heygenKey = process.env.HEYGEN_API_KEY ?? undefined;
          avatarImageUrl = await fetchAvatarPreviewImage(video.avatarId, heygenKey);
          logger.info(
            { videoId, avatarId: video.avatarId, found: !!avatarImageUrl },
            "[Publish] Avatar preview image resolved",
          );
        }

        brandCoverUrl = await generateBrandCover(
          videoId,
          coverText,
          brandSettings.brandPrimaryColor,
          brandSettings.brandAccentColor ?? null,
          avatarImageUrl,                      // avatar portrait → images.edit reference 1
          brandSettings.brandLogoUrl ?? null,  // brand logo    → images.edit reference 2
        );
        if (brandCoverUrl) {
          // Persist so retry runs don't regenerate (saves AI cost)
          await db
            .update(videosTable)
            .set({ thumbnailCoverUrl: brandCoverUrl, updatedAt: new Date() })
            .where(eq(videosTable.id, videoId));
          logger.info({ videoId, coverUrl: brandCoverUrl.slice(0, 80) }, "[Publish] Brand cover generated and saved");
        }
      }
    } catch (err) {
      logger.warn({ videoId, err }, "[Publish] Brand cover generation failed — continuing without cover");
    }
  } else {
    logger.info({ videoId }, "[Publish] Reusing saved thumbnail cover URL");
  }

  // Create container (or resume existing one from a previous attempt)
  let containerId: string;
  if (video.igContainerId) {
    // Server restarted after container was created — resume polling it
    containerId = video.igContainerId;
    logger.info({ videoId, containerId }, "[Publish] Resuming existing Instagram container");
  } else {
    containerId = await createReelContainer(igAccount.accessToken, igAccount.igUserId, url, caption, brandCoverUrl);
    // Persist the container ID BEFORE polling so a crash/restart can resume
    await db
      .update(videosTable)
      .set({ igContainerId: containerId, updatedAt: new Date() })
      .where(eq(videosTable.id, videoId));
    logger.info({ videoId, containerId }, "[Publish] Created Instagram container");
  }

  // Poll container status
  try {
    let attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 10000));
      const statusCode = await checkContainerStatus(igAccount.accessToken, containerId);
      if (statusCode === "FINISHED") break;
      if (statusCode === "ERROR") {
        // Container is permanently bad (typically because Instagram couldn't download
        // the video URL). Clear it so the next attempt creates a fresh container.
        await db
          .update(videosTable)
          .set({ status: "failed", igContainerId: null, errorMessage: "Instagram rechazó el video — reintenta la publicación", updatedAt: new Date() })
          .where(eq(videosTable.id, videoId));
        throw new Error("Container processing failed — Instagram could not process the video");
      }
      attempts++;
    }

    // Re-read the video fresh before calling Instagram — a previous run may have
    // already called publishContainer and saved igMediaId to DB, but then crashed
    // before marking status = "published". Calling publishContainer a second time
    // on the same container would create a duplicate post on Instagram.
    const [prePublish] = await db
      .select({ igMediaId: videosTable.igMediaId, igPermalink: videosTable.igPermalink })
      .from(videosTable)
      .where(eq(videosTable.id, videoId));

    let igMediaId: string;
    let permalink: string;

    if (prePublish?.igMediaId) {
      // Already published in a previous run — reuse the saved igMediaId.
      igMediaId = prePublish.igMediaId;
      permalink = prePublish.igPermalink ?? await getPermalink(igAccount.accessToken, igMediaId) ?? "";
      logger.info({ videoId, igMediaId }, "[Publish] igMediaId already saved — skipping duplicate publishContainer call");
    } else {
      igMediaId = await publishContainer(igAccount.accessToken, igAccount.igUserId, containerId);
      permalink = await getPermalink(igAccount.accessToken, igMediaId) ?? "";
    }

    await db
      .update(videosTable)
      .set({ status: "published", igMediaId, igPermalink: permalink, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(videosTable.id, videoId));

    // Clear the scheduled publish time on the video (it's now published, the
    // original scheduled date is no longer meaningful) and stamp the real publish time.
    await db
      .update(videosTable)
      .set({ scheduledPublishAt: null, updatedAt: new Date() })
      .where(eq(videosTable.id, videoId));

    if (video.contentPlanId) {
      // Update scheduledAt to the actual publish time so the UI shows when the
      // video was really published, not when it was originally planned.
      await db
        .update(contentPlanItemsTable)
        .set({ status: "published", scheduledAt: new Date(), updatedAt: new Date() })
        .where(eq(contentPlanItemsTable.id, video.contentPlanId));
    }

    logger.info({ videoId, igMediaId }, "Video published to Instagram");
  } catch (err) {
    // If the video is still in "publishing" status (i.e. we didn't already set it
    // to "failed" above), reset it so the user can retry without getting "ya se está publicando".
    const [current] = await db.select({ status: videosTable.status }).from(videosTable).where(eq(videosTable.id, videoId));
    if (current?.status === "publishing") {
      await db
        .update(videosTable)
        .set({ status: "failed", errorMessage: err instanceof Error ? err.message : String(err), updatedAt: new Date() })
        .where(eq(videosTable.id, videoId));
    }
    throw err;
  }
}

/**
 * Dependencies injected into the voice-poller core loop.
 * Keeping them injectable makes the core unit-testable without a real DB or HeyGen key.
 */
export interface VoicePollerDeps {
  /** Fetch all rows with status = "pending" */
  fetchPending: () => Promise<Array<{
    id: number;
    userId: number;
    voiceId: string;
    displayName: string;
    createdAt: Date;
  }>>;
  /** Call HeyGen's status endpoint for one clone job */
  getStatus: (cloneId: string) => Promise<{ status: string; voice_id?: string | null; error?: string | null }>;
  /** Persist a terminal state to the DB */
  updateVoice: (id: number, patch: { status: string; voiceId?: string }) => Promise<void>;
  /** Called when a voice transitions to "ready" — used for side-effects like email notification */
  onVoiceReady?: (voice: { id: number; userId: number; finalVoiceId: string }) => Promise<void>;
  /** "Current" time — injected so tests can control it */
  now: Date;
  /** Voices pending longer than this are force-failed (default 60 min) */
  timeoutMs: number;
}

/**
 * Core poller loop — separated from DB/HeyGen side-effects so it can be unit-tested.
 *
 * The v3 `/v3/voices/clone` endpoint returns a `voice_clone_id` (job ID), not the
 * final usable `voice_id`. We poll `GET /v3/voices/{voice_clone_id}` until a
 * terminal state is reached.
 *
 * On completion the `voiceId` column is updated to the final voice_id (may differ
 * from the initial clone_id) so downstream generation/deletion routes are correct.
 *
 * Source audio cleanup: voice recordings are uploaded to GCS with unguessable UUIDs
 * and are accessible only via short-lived signed URLs. Proactive GCS deletion after
 * a terminal state requires storing the object name in the DB — tracked as a
 * follow-up task to add that column when needed.
 */
export async function runVoicePollerCycle(deps: VoicePollerDeps): Promise<void> {
  const { fetchPending, getStatus, updateVoice, now, timeoutMs } = deps;

  const pendingVoices = await fetchPending();
  if (pendingVoices.length === 0) return;

  logger.debug({ count: pendingVoices.length }, "[VoicePoller] Checking pending cloned voices");

  for (const voice of pendingVoices) {
    const ageMs = now.getTime() - voice.createdAt.getTime();

    try {
      const cloneStatus = await getStatus(voice.voiceId);

      if (cloneStatus.status === "complete") {
        // The final voice_id may differ from the voice_clone_id stored in the DB.
        // Update it so generation/deletion routes use the correct identifier.
        const finalVoiceId = cloneStatus.voice_id ?? voice.voiceId;
        await updateVoice(voice.id, { status: "ready", voiceId: finalVoiceId });
        await deps.onVoiceReady?.({ id: voice.id, userId: voice.userId, finalVoiceId }).catch((err) =>
          logger.warn({ err, voiceId: voice.voiceId }, "[VoicePoller] onVoiceReady callback failed"),
        );
        logger.info(
          { cloneId: voice.voiceId, finalVoiceId, userId: voice.userId },
          "[VoicePoller] Cloned voice is now ready ✓",
        );
      } else if (cloneStatus.status === "failed") {
        await updateVoice(voice.id, { status: "failed" });
        logger.warn(
          { voiceId: voice.voiceId, userId: voice.userId, error: cloneStatus.error },
          "[VoicePoller] HeyGen reported voice clone failed",
        );
      } else if (ageMs > timeoutMs) {
        // Still "processing" but has been pending too long — force-fail
        await updateVoice(voice.id, { status: "failed" });
        logger.warn(
          { voiceId: voice.voiceId, userId: voice.userId, ageMs },
          "[VoicePoller] Cloned voice timed out — marking failed",
        );
      } else {
        logger.debug(
          { voiceId: voice.voiceId, status: cloneStatus.status, ageMs },
          "[VoicePoller] Voice still processing — will check again next cycle",
        );
      }
    } catch (err) {
      logger.warn({ err, voiceId: voice.voiceId }, "[VoicePoller] Failed to poll voice clone status — will retry next cycle");
    }
  }
}

/**
 * Production wrapper — wires real DB + HeyGen into `runVoicePollerCycle`.
 */
async function pollPendingClonedVoices(): Promise<void> {
  const now = new Date();

  // Fetch ALL pending voices upfront
  const allPending = await db
    .select()
    .from(heygenClonedVoicesTable)
    .where(eq(heygenClonedVoicesTable.status, "pending"));

  if (allPending.length === 0) return;

  // Group by userId so we resolve each user's API key exactly once
  const byUser = new Map<number, typeof allPending>();
  for (const voice of allPending) {
    const list = byUser.get(voice.userId) ?? [];
    list.push(voice);
    byUser.set(voice.userId, list);
  }

  // All voice polling uses the platform key exclusively — no per-user BYOK.
  await Promise.allSettled(
    [...byUser.entries()].map(async ([voiceUserId, voices]) => {
      const apiKey = process.env.HEYGEN_API_KEY ?? undefined;

      await runVoicePollerCycle({
        fetchPending: async () => voices,
        getStatus: (cloneId) => getVoiceCloneStatus(cloneId, apiKey),
        updateVoice: (id, patch) =>
          db
            .update(heygenClonedVoicesTable)
            .set({ ...patch, updatedAt: now })
            .where(eq(heygenClonedVoicesTable.id, id))
            .then(() => undefined),
        onVoiceReady: async ({ userId, finalVoiceId }) => {
          const [user] = await db
            .select({ email: users.email, username: users.username, fullName: users.fullName })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          const to = user?.email ?? user?.username;
          if (!to) return;
          await sendEmail({
            to,
            subject: "¡Tu voz clonada está lista en Reelsona! 🎤",
            html: `<p>Hola ${user?.fullName ?? ""},</p>
<p>Tu voz clonada ya está disponible para usar en todos tus videos de Reelsona.</p>
<p>Entra a la plataforma, ve a <strong>Avatares → Mis Voces</strong> y asígnala a tus avatares para empezar a generar contenido con tu propia voz.</p>
<p style="color:#888;font-size:12px">ID de voz: ${finalVoiceId}</p>`,
            text: `Tu voz clonada está lista. Entra a Reelsona, ve a Avatares → Mis Voces y asígnala a tus avatares.`,
          });
        },
        now,
        timeoutMs: 60 * 60 * 1000,
      });
    })
  );
}

let cronJob: ReturnType<typeof cron.schedule> | null = null;
let cycleRunning = false;

export function startScheduler(): void {
  if (cronJob) return;

  // Every minute: poll video statuses + pending cloned voice statuses
  let pollRunning = false;
  cron.schedule("* * * * *", async () => {
    if (pollRunning) return;
    pollRunning = true;
    try {
      await Promise.all([
        pollAndPublishVideos(),
        pollPendingClonedVoices(),
      ]);
    } catch (err) {
      logger.error({ err }, "Error in video polling cycle");
    } finally {
      pollRunning = false;
    }
  });

  // Every 5 minutes: process any content item whose scheduled time has arrived.
  // Runs a separate automation cycle for each user that has automation enabled.
  cron.schedule("*/5 * * * *", async () => {
    if (cycleRunning) {
      logger.warn("Skipping automation tick: previous cycle still running");
      return;
    }
    cycleRunning = true;
    try {
      const now = new Date();

      // Find all users with automation enabled
      const enabledConfigs = await db
        .select({ id: automationConfigTable.id, userId: automationConfigTable.userId })
        .from(automationConfigTable)
        .where(eq(automationConfigTable.enabled, true));

      if (enabledConfigs.length === 0) return;

      for (const config of enabledConfigs) {
        const dueItems = await db
          .select({ id: contentPlanItemsTable.id })
          .from(contentPlanItemsTable)
          .where(
            and(
              eq(contentPlanItemsTable.userId, config.userId),
              inArray(contentPlanItemsTable.status, ["draft", "scripted"]),
              lte(contentPlanItemsTable.scheduledAt, now)
            )
          )
          .limit(1);

        if (dueItems.length === 0) continue;

        logger.info({ userId: config.userId, itemId: dueItems[0].id }, "Scheduled automation cycle triggered");
        const result = await runAutomationCycle(config.userId);

        // Transient / self-healing results (concurrent cycle, no items ready, etc.)
        // should not overwrite a meaningful last_run_status — they are expected and
        // the system retries automatically on the next tick.
        const isTransient =
          !result.success &&
          (result.message?.includes("will retry") ||
            result.message?.includes("already being processed") ||
            result.message?.includes("No draft") ||
            result.message?.includes("No content item") ||
            result.message?.includes("Script ready") ||
            result.message?.includes("disabled"));

        if (!isTransient) {
          await db
            .update(automationConfigTable)
            .set({
              lastRunAt: now,
              lastRunStatus: result.success ? "success" : `failed: ${result.message}`,
              updatedAt: now,
            })
            .where(eq(automationConfigTable.id, config.id));
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in scheduled automation cycle");
    } finally {
      cycleRunning = false;
    }
  });

  // Weekly on Monday at 03:00 AM: sync all stale radar accounts via Apify.
  // Runs independently of the automation enabled flag — enrichment is always useful.
  cron.schedule("0 3 * * 1", async () => {
    logger.info("[RadarSync] Weekly radar sync started");
    await syncAllStaleRadarAccounts();
  });

  // 1st of each month at 04:00 AM: grant 1,500 subscription credits to all
  // active Founder subscribers whose monthly grant count < FOUNDER_MAX_MONTHS
  // and whose last grant was ≥ 28 days ago (guards against double-runs).
  cron.schedule("0 4 1 * *", async () => {
    logger.info("[FounderGrant] Monthly Founder credit grant started");
    try {
      const twentyEightDaysAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
      const activeFounders = await db
        .select()
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.planSlug, "founder"),
            inArray(subscriptionsTable.status, ["active", "trialing"]),
          )
        );

      let granted = 0;
      for (const sub of activeFounders) {
        // Each Founder gets a fully atomic grant: lock subscription row → re-read
        // counter → check limit + cooldown → insert durable idempotency claim →
        // update wallet → increment counter. One transaction, crash-safe at every step.
        try {
          const planCredits = PLAN_CREDITS["founder"] ?? 1500;
          let didGrant = false;

          await db.transaction(async (tx) => {
            // Lock the subscription row to prevent concurrent cron runs and
            // overlap with invoice.paid from racing on the same counter.
            const [lockedSub] = await tx
              .select()
              .from(subscriptionsTable)
              .where(eq(subscriptionsTable.id, sub.id))
              .for("update")
              .limit(1);

            if (!lockedSub) return;

            const grantedSoFar = lockedSub.founderMonthsGranted ?? 0;

            // Re-check limit with fresh (locked) value
            if (grantedSoFar >= FOUNDER_MAX_MONTHS) {
              logger.info({ userId: sub.userId, months: grantedSoFar }, "[FounderGrant] Max months reached (locked re-read) — skipping");
              return;
            }

            // Re-check cooldown with fresh (locked) value
            if (lockedSub.founderLastGrantAt && lockedSub.founderLastGrantAt > twentyEightDaysAgo) {
              logger.info({ userId: sub.userId }, "[FounderGrant] Last grant < 28 days ago (locked re-read) — skipping");
              return;
            }

            const grantMonthNumber = grantedSoFar + 1;

            // Durable idempotency key — unique per subscription per grant month.
            // A crash-retry will attempt the same INSERT → ON CONFLICT DO NOTHING → skip.
            const idempotencyKey = `cron_founder_${sub.id}_month${grantMonthNumber}`;
            const claimed = await tx
              .insert(invoiceCreditGrantsTable)
              .values({
                stripeInvoiceId: idempotencyKey,
                userId:          sub.userId,
                planSlug:        "founder",
                creditsGranted:  planCredits,
              })
              .onConflictDoNothing()
              .returning({ id: invoiceCreditGrantsTable.id });

            if (claimed.length === 0) {
              logger.info({ userId: sub.userId, grantMonthNumber, idempotencyKey }, "[FounderGrant] Already claimed this month — skipping");
              return;
            }

            // Wallet lock — prevents concurrent topup/reservation from producing lost updates
            const [existing] = await tx
              .select().from(userCreditsTable).where(eq(userCreditsTable.userId, sub.userId))
              .for("update").limit(1);

            const prevSubCredits   = existing?.subscriptionCredits ?? 0;
            const purchasedCredits = existing?.purchasedCredits    ?? 0;
            // Query unsettled reserved-from-sub (renewal safety — see pool model in credits.ts).
            // newSub = planCredits - reservedFromSub ensures release cannot push sub above planCredits.
            const reservedResultS  = await tx.execute(sql`
              SELECT COALESCE(SUM(COALESCE(subscription_amount, 0)), 0) AS rsub
              FROM credit_ledger r
              WHERE r.user_id = ${sub.userId}
                AND r.type = 'reserve'
                AND NOT EXISTS (
                  SELECT 1 FROM credit_ledger s
                  WHERE s.related_ledger_id = r.id AND s.type IN ('consume', 'release')
                )
            `);
            const reservedFromSubS = Number((reservedResultS.rows[0] as Record<string, unknown>)?.rsub ?? 0);
            const newSubCreditsS   = planCredits - reservedFromSubS;
            const newAvailable     = newSubCreditsS + purchasedCredits;
            const balanceBefore    = existing?.availableCredits    ?? 0;

            if (existing) {
              await tx.update(userCreditsTable)
                .set({ subscriptionCredits: newSubCreditsS, availableCredits: newAvailable, updatedAt: new Date() })
                .where(eq(userCreditsTable.userId, sub.userId));
            } else {
              await tx.insert(userCreditsTable).values({
                userId: sub.userId, availableCredits: planCredits, subscriptionCredits: planCredits,
                purchasedCredits: 0, reservedCredits: 0, totalConsumed: 0,
              });
            }

            await tx.insert(creditLedgerTable).values({
              userId:             sub.userId,
              type:               "provision",
              amount:             planCredits - prevSubCredits,
              balanceBefore,
              balanceAfter:       newAvailable,
              pool:               "subscription",
              subscriptionAmount: newSubCreditsS,
              description:        `Founder mensual #${grantMonthNumber}: ${planCredits} créditos`,
            });

            // Atomically increment counter in the same tx (cannot diverge from credit grant)
            await tx.update(subscriptionsTable)
              .set({ founderMonthsGranted: grantMonthNumber, founderLastGrantAt: new Date(), updatedAt: new Date() })
              .where(eq(subscriptionsTable.id, sub.id));

            didGrant = true;
          });

          if (didGrant) {
            granted++;
            logger.info({ userId: sub.userId, grantMonthNumber: (sub.founderMonthsGranted ?? 0) + 1, planCredits }, "[FounderGrant] Credits granted");
          }
        } catch (subErr) {
          logger.error({ err: subErr, userId: sub.userId }, "[FounderGrant] Failed to grant credits for subscriber");
        }
      }
      logger.info({ granted, total: activeFounders.length }, "[FounderGrant] Monthly grant complete");
    } catch (err) {
      logger.error({ err }, "[FounderGrant] Monthly Founder grant error");
    }
  });

  logger.info("Automation scheduler started");
}

/**
 * Enrich all niche radar accounts that have never been synced or whose
 * last_synced_at is older than 7 days.  Used by the weekly cron job and
 * can be called directly from the POST /strategy/radar/sync-all endpoint.
 *
 * Returns counts for logging: { synced, failed, total }.
 */
export async function syncAllStaleRadarAccounts(userId?: number): Promise<{ synced: number; failed: number; total: number }> {
  if (!process.env.APIFY_TOKEN) {
    logger.warn("[RadarSync] APIFY_TOKEN not set — skipping radar sync");
    return { synced: 0, failed: 0, total: 0 };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const staleness = or(
    isNull(nicheRadarAccountsTable.lastSyncedAt),
    lt(nicheRadarAccountsTable.lastSyncedAt, sevenDaysAgo)
  );

  const staleAccounts = await db
    .select()
    .from(nicheRadarAccountsTable)
    .where(
      userId !== undefined
        ? and(eq(nicheRadarAccountsTable.userId, userId), staleness)
        : staleness
    );

  if (staleAccounts.length === 0) {
    logger.info("[RadarSync] All radar accounts are up to date — nothing to sync");
    return { synced: 0, failed: 0, total: 0 };
  }

  logger.info({ count: staleAccounts.length }, "[RadarSync] Syncing stale radar accounts");

  let synced = 0;
  let failed = 0;

  for (const account of staleAccounts) {
    try {
      const apifyData = await enrichProfileWithApify(account.igUsername);
      if (!apifyData) {
        failed++;
        logger.warn({ igUsername: account.igUsername }, "[RadarSync] Apify returned no data — skipping account");
        continue;
      }
      await db
        .update(nicheRadarAccountsTable)
        .set({
          bio:          apifyData.biography ?? account.bio,
          followers:    apifyData.followersCount ?? account.followers,
          profileUrl:   apifyData.profilePicUrl ?? account.profileUrl,
          topPostsJson: apifyData.topPosts.length > 0 ? apifyData.topPosts : account.topPostsJson,
          lastSyncedAt: new Date(),
        })
        .where(eq(nicheRadarAccountsTable.id, account.id));
      synced++;
      logger.info({ igUsername: account.igUsername }, "[RadarSync] Account synced ✓");
    } catch (err) {
      failed++;
      logger.error({ err, igUsername: account.igUsername }, "[RadarSync] Failed to sync account");
    }
  }

  logger.info({ synced, failed, total: staleAccounts.length }, "[RadarSync] Weekly radar sync complete");
  return { synced, failed, total: staleAccounts.length };
}
