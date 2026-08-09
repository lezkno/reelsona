import cron from "node-cron";
import nodePath from "path";
import nodeFs from "fs";
import { db } from "@workspace/db";
import {
  automationConfigTable,
  settingsTable,
  avatarConfigTable,
  contentPlanItemsTable,
  videosTable,
  instagramAccountsTable,
  captionConfigTable,
} from "@workspace/db";
import { applyCaptions, CAPTION_DIR, type CaptionStyle } from "./caption-engine";
import { applyCaptionsBrowser } from "./browser-caption-engine";
import { eq, and, lte, inArray, isNull, isNotNull, or } from "drizzle-orm";
import { logger } from "./logger";
import { generateScript, regenerateCaption } from "./ai-scripts";
import { generateVideo, getVideoStatus, listVoices, getAvatarDefaultVoiceId } from "./heygen";
import { createReelContainer, checkContainerStatus, publishContainer, getPermalink } from "./instagram-api";

/** Sentinel stored in preferred_voice_id meaning "use the avatar's own HeyGen default voice" (legacy, kept for backwards compat). */
export const AVATAR_DEFAULT_VOICE = "avatar_default";

/**
 * Resolve the HeyGen API key for background scheduler jobs.
 * Picks the first settings row that has a key (user-supplied).
 * Falls back to the HEYGEN_API_KEY env var if none is stored.
 */
async function resolveHeyGenApiKey(): Promise<string | undefined> {
  const [row] = await db
    .select({ heygenApiKey: settingsTable.heygenApiKey })
    .from(settingsTable)
    .where(isNotNull(settingsTable.heygenApiKey))
    .limit(1);
  return row?.heygenApiKey ?? process.env.HEYGEN_API_KEY ?? undefined;
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
export async function resolveVoiceId(avatarId: string | null, apiKey?: string): Promise<string | null> {
  const [avatarCfg] = await db.select().from(avatarConfigTable).limit(1);

  // 1. Check per-avatar override first
  if (avatarId) {
    const overrides = (avatarCfg?.voiceOverrides ?? {}) as Record<string, string>;
    const override = overrides[avatarId];
    if (override && override !== AVATAR_DEFAULT_VOICE) {
      logger.debug({ avatarId, voiceId: override }, "Using per-avatar voice override");
      return override;
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

export async function runAutomationCycle(targetItemId?: number): Promise<{
  success: boolean;
  message: string;
  contentItemId?: number;
  videoId?: number;
}> {
  logger.info({ targetItemId }, "Starting automation cycle");

  // Load automation config (a manual "create now" run ignores the enabled flag)
  const [automation] = await db.select().from(automationConfigTable).limit(1);
  if (!automation) {
    return { success: false, message: "Automation not configured" };
  }
  if (!automation.enabled && targetItemId === undefined) {
    return { success: false, message: "Automation disabled" };
  }

  // Load settings (scoped to automation owner if possible, else first available)
  const [settings] = await db.select().from(settingsTable).limit(1);
  if (!settings?.niche) {
    return { success: false, message: "Niche not configured" };
  }
  const heygenApiKey = settings.heygenApiKey ?? process.env.HEYGEN_API_KEY ?? undefined;

  // Load avatar config
  const [avatarCfg] = await db.select().from(avatarConfigTable).limit(1);
  if (!avatarCfg?.selectedAvatarIds?.length) {
    return { success: false, message: "No avatars configured" };
  }

  // Load IG account — only required when auto-publish is on.
  // Script and video generation should work even without an IG account connected.
  const [igAccount] = await db.select().from(instagramAccountsTable).limit(1);
  if (!igAccount && automation.autoPublish && targetItemId === undefined) {
    return { success: false, message: "Instagram account not connected" };
  }

  // Check if we have a ready content item scheduled for now or overdue
  const now = new Date();
  const readyItems = await db
    .select()
    .from(contentPlanItemsTable)
    .where(
      targetItemId !== undefined
        ? and(eq(contentPlanItemsTable.id, targetItemId), eq(contentPlanItemsTable.status, "scripted"))
        : and(eq(contentPlanItemsTable.status, "scripted"), lte(contentPlanItemsTable.scheduledAt, now))
    )
    .orderBy(contentPlanItemsTable.scheduledAt)
    .limit(1);

  let contentItem = readyItems[0];

  // If no scripted item, generate one from the next due draft
  if (!contentItem && (automation.autoGenerateScript || targetItemId !== undefined)) {
    const draftItems = await db
      .select()
      .from(contentPlanItemsTable)
      .where(
        targetItemId !== undefined
          ? and(eq(contentPlanItemsTable.id, targetItemId), eq(contentPlanItemsTable.status, "draft"))
          : and(eq(contentPlanItemsTable.status, "draft"), lte(contentPlanItemsTable.scheduledAt, now))
      )
      .orderBy(contentPlanItemsTable.scheduledAt)
      .limit(1);

    const draft = draftItems[0];
    if (!draft) {
      return { success: false, message: "No draft content items available" };
    }

    const scriptResult = await generateScript(
      draft.topic,
      settings.niche,
      settings.tone,
      settings.language,
      settings.videoDurationSeconds
    );

    // Use the stored avatarId only if it's still in the current selection.
    // If the user removed it from their list, re-pick from the active selection.
    const storedAvatarValid =
      draft.avatarId && avatarCfg.selectedAvatarIds.includes(draft.avatarId);
    const avatarId = storedAvatarValid
      ? draft.avatarId!
      : pickNextAvatar(
          avatarCfg.selectedAvatarIds,
          avatarCfg.lastUsedAvatarId,
          avatarCfg.rotationStrategy,
          avatarCfg.avatarUsageCount as Record<string, number>
        );
    if (!storedAvatarValid && draft.avatarId) {
      logger.warn(
        { removedAvatarId: draft.avatarId, newAvatarId: avatarId },
        "Stored avatarId is no longer in the active selection — re-picking from current list"
      );
    }

    // Always re-resolve from current voice_overrides — draft.voiceId may be stale.
    const voiceId = (await resolveVoiceId(avatarId, heygenApiKey)) ?? draft.voiceId;

    await db
      .update(contentPlanItemsTable)
      .set({
        hook: scriptResult.hook,
        script: scriptResult.script,
        cta: scriptResult.cta,
        caption: scriptResult.caption,
        hashtags: scriptResult.hashtags,
        avatarId,
        voiceId,
        status: "scripted",
        updatedAt: new Date(),
      })
      .where(eq(contentPlanItemsTable.id, draft.id));

    // Advance lastUsedAvatarId immediately so the next scripting cycle picks a
    // DIFFERENT avatar. Without this update, consecutive scripting cycles all
    // read the same lastUsedAvatarId (set at video-generation time) and can
    // assign the same avatar repeatedly regardless of rotation strategy.
    await db
      .update(avatarConfigTable)
      .set({ lastUsedAvatarId: avatarId, updatedAt: new Date() })
      .where(eq(avatarConfigTable.id, avatarCfg.id));
    avatarCfg.lastUsedAvatarId = avatarId; // keep in-memory ref consistent

    contentItem = {
      ...draft,
      status: "scripted",
      avatarId,
      voiceId,
      hook: scriptResult.hook,
      script: scriptResult.script,
      cta: scriptResult.cta,
      caption: scriptResult.caption,
      hashtags: scriptResult.hashtags,
    };
    logger.info({ itemId: draft.id, avatarId }, "Script generated for draft item");
  }

  if (!contentItem) {
    return { success: false, message: "No content item ready for processing" };
  }

  // Generate video (a manual run always continues to video generation)
  if (!automation.autoGenerateVideo && targetItemId === undefined) {
    return { success: true, message: "Script ready, video generation disabled", contentItemId: contentItem.id };
  }

  // Backfill missing avatar/voice so scripted items never get stuck.
  // Also replace stored avatarId if it's no longer in the active selection.
  const currentAvatarValid =
    contentItem.avatarId && avatarCfg.selectedAvatarIds.includes(contentItem.avatarId);
  if (!currentAvatarValid) {
    if (contentItem.avatarId) {
      logger.warn(
        { removedAvatarId: contentItem.avatarId },
        "avatarId on scripted item is no longer in active selection — re-picking"
      );
    }
    contentItem.avatarId = pickNextAvatar(
      avatarCfg.selectedAvatarIds,
      avatarCfg.lastUsedAvatarId,
      avatarCfg.rotationStrategy,
      (avatarCfg.avatarUsageCount as Record<string, number>) ?? {}
    );
    // Advance lastUsedAvatarId so the next cycle picks differently
    await db
      .update(avatarConfigTable)
      .set({ lastUsedAvatarId: contentItem.avatarId, updatedAt: new Date() })
      .where(eq(avatarConfigTable.id, avatarCfg.id));
    avatarCfg.lastUsedAvatarId = contentItem.avatarId;
    // Voice must be re-resolved for the new avatar
    contentItem.voiceId = null;
  }
  // Always re-resolve voice from current overrides at generation time.
  // The voiceId stored on the item may be stale (set before the user configured
  // per-avatar overrides). The override map always wins over the cached value.
  const freshVoiceId = await resolveVoiceId(contentItem.avatarId, heygenApiKey);
  contentItem.voiceId = freshVoiceId ?? contentItem.voiceId;
  if (contentItem.avatarId && contentItem.voiceId) {
    await db
      .update(contentPlanItemsTable)
      .set({ avatarId: contentItem.avatarId, voiceId: contentItem.voiceId, updatedAt: new Date() })
      .where(eq(contentPlanItemsTable.id, contentItem.id));
  }

  if (!contentItem.avatarId || !contentItem.voiceId || !contentItem.script) {
    logger.error({ itemId: contentItem.id, hasAvatar: !!contentItem.avatarId, hasVoice: !!contentItem.voiceId, hasScript: !!contentItem.script }, "Content item missing avatar, voice, or script");
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

  const [videoRow] = await db
    .insert(videosTable)
    .values({
      contentPlanId: contentItem.id,
      topic: contentItem.topic,
      avatarId: contentItem.avatarId,
      status: "generating",
      // null = caption pending (will be processed after HeyGen completes)
      // "disabled" = captions are off, skip the step entirely
      captionStatus: automation.captionsEnabled ? null : "disabled",
      // Start the timeout clock at submission, not at first poll
      generatingStartedAt: new Date(),
    })
    .returning();

  try {
    const heygenVideoId = await generateVideo({
      script: contentItem.script,
      avatar_id: contentItem.avatarId,
      voice_id: contentItem.voiceId,
      title: contentItem.topic,
      captionsEnabled: automation.captionsEnabled ?? false,
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
    usageCount[contentItem.avatarId] = (usageCount[contentItem.avatarId] ?? 0) + 1;
    await db
      .update(avatarConfigTable)
      .set({ lastUsedAvatarId: contentItem.avatarId, avatarUsageCount: usageCount, updatedAt: new Date() })
      .where(eq(avatarConfigTable.id, avatarCfg.id));

    logger.info({ videoId: videoRow.id, heygenVideoId }, "Video generation started");
    return { success: true, message: "Video generation started", contentItemId: contentItem.id, videoId: videoRow.id };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(videosTable).set({ status: "failed", errorMessage: error, updatedAt: new Date() }).where(eq(videosTable.id, videoRow.id));
    await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, contentItem.id));
    return { success: false, message: `Video generation failed: ${error}` };
  }
}

/**
 * Apply Caption Studio processing to a single video row.
 * Uses the video's stored URL + the linked content-item script.
 * subtitleUrl is optional — if absent (e.g. recovery after restart) the engine
 * falls back to proportional SRT generated from the script text.
 */
async function runCaptionProcessing(
  videoId: number,
  videoUrl: string,
  contentPlanId: number | null,
  subtitleUrl?: string | null,
  durationSeconds?: number | null
): Promise<void> {
  const [captionCfg] = await db.select().from(captionConfigTable).limit(1);
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
  if (contentPlanId) {
    const [item] = await db.select().from(contentPlanItemsTable)
      .where(eq(contentPlanItemsTable.id, contentPlanId));
    script = item?.script ?? null;
  }

  // ── Browser Caption Engine (experimental) ────────────────────────────────
  // When captionEngine = "browser_experimental" and a templateId is set,
  // attempt the canvas-based render first. On failure → fall through to ASS.
  if (captionCfg.captionEngine === "browser_experimental" && captionCfg.templateId) {
    logger.info(
      { videoId, templateId: captionCfg.templateId },
      "[Scheduler] Using Browser Caption Engine (experimental)",
    );

    // Parse stored template overrides JSON (set via Caption Studio advanced settings)
    let parsedTemplateOverrides: Partial<import("@workspace/caption-templates").CaptionTemplate> | undefined;
    if (captionCfg.templateOverrides) {
      try { parsedTemplateOverrides = JSON.parse(captionCfg.templateOverrides); } catch { /* ignore malformed */ }
    }
    const browserResult = await applyCaptionsBrowser(videoUrl, script, captionCfg.templateId, {
      subtitleUrl:          subtitleUrl ?? undefined,
      videoDurationSeconds: durationSeconds ?? undefined,
      // Pass user drag overrides so position set in Caption Studio is honoured in the render
      yPositionPct: captionCfg.yPosition  ?? undefined,
      marginXPct:   captionCfg.marginX    != null
        ? (captionCfg.marginX / 1080) * 100  // px at 1080-width scale → % of VIDEO_WIDTH
        : undefined,
      // Pass style overrides from Caption Studio advanced settings
      templateOverrides: parsedTemplateOverrides,
    });

    if (browserResult.url) {
      await db
        .update(videosTable)
        .set({ captionedVideoUrl: browserResult.url, captionStatus: "done", updatedAt: new Date() })
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
  const style: CaptionStyle = {
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
      subtitleUrl: subtitleUrl ?? undefined,
      videoDurationSeconds: durationSeconds ?? undefined,
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

    const [settings] = await db.select().from(settingsTable).limit(1);
    const niche    = settings?.niche    || "general";
    const tone     = settings?.tone     || "profesional";
    const language = settings?.language || "es";

    const result = await regenerateCaption(
      item.topic,
      item.script ?? item.topic,
      niche,
      tone,
      language
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
    const [automation] = await db.select().from(automationConfigTable).limit(1);
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

export async function pollAndPublishVideos(): Promise<void> {
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

  // ── Recovery: videos stuck in "ready" with captionStatus=null ─────────────
  // These are videos that completed in HeyGen but caption processing never ran
  // (e.g. server restarted mid-processing, or captionConfig was missing).
  // subtitle_url is no longer available so the engine uses proportional-SRT fallback.
  const [automation] = await db.select().from(automationConfigTable).limit(1);
  const stuckVideos = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.status, "ready"), isNull(videosTable.captionStatus)));
  for (const v of stuckVideos) {
    if (!v.videoUrl) continue;
    if (automation?.captionsEnabled) {
      // Captions are still on — run (or re-run) caption processing
      logger.info({ videoId: v.id }, "[CaptionEngine] Recovery: re-processing stuck caption");
      await runCaptionProcessing(v.id, v.videoUrl, v.contentPlanId ?? null, null, v.durationSeconds).catch((err) =>
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
    const readyVideos = await db
      .select({ id: videosTable.id, scheduledPublishAt: videosTable.scheduledPublishAt })
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

    for (const video of readyVideos) {
      if (video.scheduledPublishAt) continue; // handled above (or not yet due)
      try {
        logger.info({ id: video.id }, "[Scheduler] Publishing stalled ready video");
        await publishVideoToInstagram(video.id);
      } catch (err) {
        logger.error({ id: video.id, err }, "[Scheduler] Failed to publish stalled video");
      }
    }
  }

  // ── Poll HeyGen for videos still generating ───────────────────────────────
  const pollApiKey = await resolveHeyGenApiKey();
  const generatingVideos = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.status, "generating"));

  const pollTimeoutMs = Number(process.env.HEYGEN_POLL_TIMEOUT_MINUTES ?? 60) * 60 * 1000;

  for (const video of generatingVideos) {
    if (!video.heygenVideoId) continue;

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
      logger.warn({ videoId: video.id, ageMs, attempts: newAttempts }, timeoutMsg);
      continue;
    }

    try {
      const status = await getVideoStatus(video.heygenVideoId, pollApiKey);
      if (status.status === "completed" && status.video_url) {
        await db
          .update(videosTable)
          .set({
            status: "ready",
            videoUrl: status.video_url,
            thumbnailUrl: status.thumbnail_url,
            durationSeconds: status.duration ? Math.round(status.duration) : null,
            updatedAt: new Date(),
          })
          .where(eq(videosTable.id, video.id));

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
        const heygenError = status.error ?? "Error desconocido en HeyGen";
        await db
          .update(videosTable)
          .set({ status: "failed", errorMessage: heygenError, updatedAt: new Date() })
          .where(eq(videosTable.id, video.id));

        if (video.contentPlanId) {
          await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }
      }
    } catch (err: any) {
      // ── Classify HeyGen HTTP errors ──────────────────────────────────────
      const httpStatus: number | undefined = err?.response?.status ?? err?.status;
      let userMsg: string;
      let markFailed = false;

      if (httpStatus === 401) {
        userMsg = "API key de HeyGen inválida — conectá tu cuenta en Configuración → Integraciones";
        markFailed = true; // Permanent — won't self-heal on retry
      } else if (httpStatus === 402) {
        userMsg = "Créditos de HeyGen insuficientes — recargá tu cuenta en heygen.com";
        markFailed = true; // Permanent — won't self-heal on retry
      } else if (httpStatus === 429) {
        userMsg = "Rate limit de HeyGen — el sistema reintentará en el próximo ciclo";
        markFailed = false; // Transient — will retry
      } else if (httpStatus !== undefined && httpStatus >= 500) {
        userMsg = `Error del servidor HeyGen (${httpStatus}) — el sistema reintentará automáticamente`;
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
        if (video.contentPlanId) {
          await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }
        logger.error({ videoId: video.id, httpStatus }, userMsg);
      } else {
        logger.warn({ videoId: video.id, httpStatus, err }, `Transient polling error (will retry): ${userMsg}`);
      }
    }
  }
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
  if (initial.status === "published") {
    logger.info({ videoId }, "[Publish] Video already published — skipping");
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
      // Any full HTTPS URL (Object Storage proxy, GCS direct, etc.) — use directly.
      url = captionedUrl;
      logger.info({ videoId, captionedUrl: url.slice(0, 80) }, "[Publish] Using captioned video from HTTPS URL");
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

  const [igAccount] = await db.select().from(instagramAccountsTable).limit(1);
  if (!igAccount) throw new Error("Instagram account not connected");

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
          settings?.videoDurationSeconds ?? 60
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

  // Create container (or resume existing one from a previous attempt)
  let containerId: string;
  if (video.igContainerId) {
    // Server restarted after container was created — resume polling it
    containerId = video.igContainerId;
    logger.info({ videoId, containerId }, "[Publish] Resuming existing Instagram container");
  } else {
    containerId = await createReelContainer(igAccount.accessToken, igAccount.igUserId, url, caption);
    // Persist the container ID BEFORE polling so a crash/restart can resume
    await db
      .update(videosTable)
      .set({ igContainerId: containerId, updatedAt: new Date() })
      .where(eq(videosTable.id, videoId));
    logger.info({ videoId, containerId }, "[Publish] Created Instagram container");
  }

  // Poll container status
  let attempts = 0;
  while (attempts < 30) {
    await new Promise((r) => setTimeout(r, 10000));
    const statusCode = await checkContainerStatus(igAccount.accessToken, containerId);
    if (statusCode === "FINISHED") break;
    if (statusCode === "ERROR") throw new Error("Container processing failed");
    attempts++;
  }

  const igMediaId = await publishContainer(igAccount.accessToken, igAccount.igUserId, containerId);
  const permalink = await getPermalink(igAccount.accessToken, igMediaId);

  await db
    .update(videosTable)
    .set({ status: "published", igMediaId, igPermalink: permalink, publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(videosTable.id, videoId));

  if (video.contentPlanId) {
    await db.update(contentPlanItemsTable).set({ status: "published", updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
  }

  logger.info({ videoId, igMediaId }, "Video published to Instagram");
}

let cronJob: ReturnType<typeof cron.schedule> | null = null;
let cycleRunning = false;

export function startScheduler(): void {
  if (cronJob) return;

  // Every minute: poll video statuses so finished HeyGen videos are detected quickly
  let pollRunning = false;
  cron.schedule("* * * * *", async () => {
    if (pollRunning) return;
    pollRunning = true;
    try {
      await pollAndPublishVideos();
    } catch (err) {
      logger.error({ err }, "Error in video polling cycle");
    } finally {
      pollRunning = false;
    }
  });

  // Every 5 minutes: process any content item whose scheduled time has arrived.
  // The content plan items are the single source of truth for when to publish
  // (they were assigned slots from the configured days/times when generated,
  // and the user can reschedule them freely).
  cron.schedule("*/5 * * * *", async () => {
    if (cycleRunning) {
      logger.warn("Skipping automation tick: previous cycle still running");
      return;
    }
    cycleRunning = true;
    try {
      const [automation] = await db.select().from(automationConfigTable).limit(1);
      if (!automation?.enabled) return;

      const now = new Date();
      const dueItems = await db
        .select({ id: contentPlanItemsTable.id })
        .from(contentPlanItemsTable)
        .where(
          and(
            inArray(contentPlanItemsTable.status, ["draft", "scripted"]),
            lte(contentPlanItemsTable.scheduledAt, now)
          )
        )
        .limit(1);

      if (dueItems.length === 0) return;

      logger.info({ itemId: dueItems[0].id }, "Scheduled automation cycle triggered");
      const result = await runAutomationCycle();

      await db
        .update(automationConfigTable)
        .set({
          lastRunAt: now,
          lastRunStatus: result.success ? "success" : `failed: ${result.message}`,
          updatedAt: now,
        })
        .where(eq(automationConfigTable.id, automation.id));
    } catch (err) {
      logger.error({ err }, "Error in scheduled automation cycle");
    } finally {
      cycleRunning = false;
    }
  });

  logger.info("Automation scheduler started");
}
