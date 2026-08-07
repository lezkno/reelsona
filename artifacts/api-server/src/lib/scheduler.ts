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
import { eq, and, lte, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { generateScript } from "./ai-scripts";
import { generateVideo, getVideoStatus, listVoices, getAvatarDefaultVoiceId } from "./heygen";
import { createReelContainer, checkContainerStatus, publishContainer, getPermalink } from "./instagram-api";

/** Sentinel stored in preferred_voice_id meaning "use the avatar's own HeyGen default voice" (legacy, kept for backwards compat). */
export const AVATAR_DEFAULT_VOICE = "avatar_default";

/**
 * Resolve the effective voice for a given avatar.
 *
 * Resolution order:
 * 1. Per-avatar override from voiceOverrides map (avatarId → voiceId), if set
 * 2. HeyGen's own default voice for this avatar's group (getAvatarDefaultVoiceId)
 * 3. null — caller must handle missing voice explicitly; no auto-pick
 */
export async function resolveVoiceId(avatarId: string | null): Promise<string | null> {
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
      const def = await getAvatarDefaultVoiceId(avatarId);
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

  // Load settings
  const [settings] = await db.select().from(settingsTable).limit(1);
  if (!settings?.niche) {
    return { success: false, message: "Niche not configured" };
  }

  // Load avatar config
  const [avatarCfg] = await db.select().from(avatarConfigTable).limit(1);
  if (!avatarCfg?.selectedAvatarIds?.length) {
    return { success: false, message: "No avatars configured" };
  }

  // Load IG account
  const [igAccount] = await db.select().from(instagramAccountsTable).limit(1);
  if (!igAccount) {
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

    const voiceId = draft.voiceId ?? (await resolveVoiceId(avatarId));

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
    logger.info({ itemId: draft.id }, "Script generated for draft item");
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
    // Voice must be re-resolved for the new avatar
    contentItem.voiceId = null;
  }
  if (!contentItem.voiceId) {
    contentItem.voiceId = await resolveVoiceId(contentItem.avatarId);
  }
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
    })
    .returning();

  try {
    const heygenVideoId = await generateVideo({
      script: contentItem.script,
      avatar_id: contentItem.avatarId,
      voice_id: contentItem.voiceId,
      title: contentItem.topic,
      captionsEnabled: automation.captionsEnabled ?? false,
    });

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

export async function pollAndPublishVideos(): Promise<void> {
  // ── Publish videos that are already "ready" (captions done/failed/disabled) ──
  // This handles the case where the server restarted after captions were applied
  // but before publishing, leaving videos stuck in "ready" state.
  const [automation] = await db.select().from(automationConfigTable).limit(1);
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
  if (automation?.enabled && automation?.autoPublish) {
    const readyVideos = await db
      .select()
      .from(videosTable)
      .where(
        and(
          eq(videosTable.status, "ready"),
          inArray(videosTable.captionStatus as any, ["done", "failed", "disabled"])
        )
      );

    for (const video of readyVideos) {
      if (video.scheduledPublishAt) continue; // handled above (or not yet due)
      try {
        logger.info({ videoId: video.id }, "[Scheduler] Publishing stalled ready video");
        await publishVideoToInstagram(video.id);
      } catch (err) {
        logger.error({ videoId: video.id, err }, "[Scheduler] Failed to publish stalled video");
      }
    }
  }

  // ── Poll HeyGen for videos still generating ───────────────────────────────
  const generatingVideos = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.status, "generating"));

  for (const video of generatingVideos) {
    if (!video.heygenVideoId) continue;
    try {
      const status = await getVideoStatus(video.heygenVideoId);
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

        // ── Caption Studio: optional captions layer (Punto A) ─────────────────
        const [automation] = await db.select().from(automationConfigTable).limit(1);
        if (automation?.captionsEnabled) {
          try {
            const [captionCfg] = await db.select().from(captionConfigTable).limit(1);
            if (captionCfg) {
              await db.update(videosTable)
                .set({ captionStatus: "processing", updatedAt: new Date() })
                .where(eq(videosTable.id, video.id));

              // Fetch script for word-timing (passed to render engine)
              let script: string | null = null;
              if (video.contentPlanId) {
                const [item] = await db.select().from(contentPlanItemsTable)
                  .where(eq(contentPlanItemsTable.id, video.contentPlanId));
                script = item?.script ?? null;
              }

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

              const captionResult = await applyCaptions(status.video_url, script, style, {
                subtitleUrl: status.subtitle_url,
                videoDurationSeconds: status.duration ?? undefined,
              });

              if (captionResult.url) {
                await db.update(videosTable)
                  .set({ captionedVideoUrl: captionResult.url, captionStatus: "done", updatedAt: new Date() })
                  .where(eq(videosTable.id, video.id));
                logger.info({ videoId: video.id }, "[CaptionEngine] Captioned video ready");
              } else {
                await db.update(videosTable)
                  .set({ captionStatus: "failed", updatedAt: new Date() })
                  .where(eq(videosTable.id, video.id));
                logger.warn({ videoId: video.id, error: captionResult.error }, "[CaptionEngine] Failed — using original video");
              }
            }
          } catch (captionErr) {
            logger.error({ videoId: video.id, captionErr }, "[CaptionEngine] Unexpected error — using original video");
            await db.update(videosTable)
              .set({ captionStatus: "failed", updatedAt: new Date() })
              .where(eq(videosTable.id, video.id)).catch(() => {});
          }
        } else {
          await db.update(videosTable)
            .set({ captionStatus: "disabled", updatedAt: new Date() })
            .where(eq(videosTable.id, video.id));
        }
        // ─────────────────────────────────────────────────────────────────────

        // Auto-publish only when both the master switch and auto_publish are on
        if (automation?.enabled && automation?.autoPublish && status.video_url) {
          await publishVideoToInstagram(video.id);
        }
      } else if (status.status === "failed") {
        await db
          .update(videosTable)
          .set({ status: "failed", errorMessage: status.error ?? "Unknown error", updatedAt: new Date() })
          .where(eq(videosTable.id, video.id));

        if (video.contentPlanId) {
          await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
        }
      }
    } catch (err) {
      logger.error({ videoId: video.id, err }, "Error polling video status");
    }
  }
}

export async function publishVideoToInstagram(videoId: number, videoUrl?: string): Promise<void> {
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) throw new Error("Video not found");

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

    if (captionedUrl.startsWith("https://storage.googleapis.com/")) {
      // Stored in Object Storage — permanently available, use directly.
      url = captionedUrl;
      logger.info({ videoId, captionedUrl: url.slice(0, 80) }, "[Publish] Using captioned video from Object Storage");
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

  // Create container
  const containerId = await createReelContainer(igAccount.accessToken, igAccount.igUserId, url, caption);

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
