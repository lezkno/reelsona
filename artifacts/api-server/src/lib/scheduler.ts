import cron from "node-cron";
import { db } from "@workspace/db";
import {
  automationConfigTable,
  settingsTable,
  avatarConfigTable,
  contentPlanItemsTable,
  videosTable,
  instagramAccountsTable,
} from "@workspace/db";
import { eq, and, lte, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { generateScript } from "./ai-scripts";
import { generateVideo, getVideoStatus } from "./heygen";
import { createReelContainer, checkContainerStatus, publishContainer, getPermalink } from "./instagram-api";

function pickNextAvatar(
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

export async function runAutomationCycle(): Promise<{
  success: boolean;
  message: string;
  contentItemId?: number;
  videoId?: number;
}> {
  logger.info("Starting automation cycle");

  // Load automation config
  const [automation] = await db.select().from(automationConfigTable).limit(1);
  if (!automation?.enabled) {
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
    .where(and(eq(contentPlanItemsTable.status, "scripted"), lte(contentPlanItemsTable.scheduledAt, now)))
    .orderBy(contentPlanItemsTable.scheduledAt)
    .limit(1);

  let contentItem = readyItems[0];

  // If no scripted item, generate one from the next due draft
  if (!contentItem && automation.autoGenerateScript) {
    const draftItems = await db
      .select()
      .from(contentPlanItemsTable)
      .where(and(eq(contentPlanItemsTable.status, "draft"), lte(contentPlanItemsTable.scheduledAt, now)))
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

    const avatarId = pickNextAvatar(
      avatarCfg.selectedAvatarIds,
      avatarCfg.lastUsedAvatarId,
      avatarCfg.rotationStrategy,
      avatarCfg.avatarUsageCount as Record<string, number>
    );

    await db
      .update(contentPlanItemsTable)
      .set({
        hook: scriptResult.hook,
        script: scriptResult.script,
        cta: scriptResult.cta,
        caption: scriptResult.caption,
        hashtags: scriptResult.hashtags,
        avatarId,
        voiceId: avatarCfg.preferredVoiceId,
        status: "scripted",
        updatedAt: new Date(),
      })
      .where(eq(contentPlanItemsTable.id, draft.id));

    contentItem = { ...draft, status: "scripted", avatarId, voiceId: avatarCfg.preferredVoiceId };
    logger.info({ itemId: draft.id }, "Script generated for draft item");
  }

  if (!contentItem) {
    return { success: false, message: "No content item ready for processing" };
  }

  // Generate video
  if (!automation.autoGenerateVideo) {
    return { success: true, message: "Script ready, video generation disabled", contentItemId: contentItem.id };
  }

  if (!contentItem.avatarId || !contentItem.voiceId || !contentItem.script) {
    return { success: false, message: "Content item missing avatar, voice, or script" };
  }

  await db
    .update(contentPlanItemsTable)
    .set({ status: "generating", updatedAt: new Date() })
    .where(eq(contentPlanItemsTable.id, contentItem.id));

  const [videoRow] = await db
    .insert(videosTable)
    .values({
      contentPlanId: contentItem.id,
      topic: contentItem.topic,
      avatarId: contentItem.avatarId,
      status: "generating",
    })
    .returning();

  try {
    const heygenVideoId = await generateVideo({
      script: contentItem.script,
      avatar_id: contentItem.avatarId,
      voice_id: contentItem.voiceId,
      title: contentItem.topic,
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
  // Check all generating videos
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

        // Auto-publish if enabled
        const [automation] = await db.select().from(automationConfigTable).limit(1);
        if (automation?.autoPublish && status.video_url) {
          await publishVideoToInstagram(video.id, status.video_url);
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

  const url = videoUrl ?? video.videoUrl;
  if (!url) throw new Error("Video URL not available");

  const [igAccount] = await db.select().from(instagramAccountsTable).limit(1);
  if (!igAccount) throw new Error("Instagram account not connected");

  let caption = "";
  if (video.contentPlanId) {
    const [item] = await db.select().from(contentPlanItemsTable).where(eq(contentPlanItemsTable.id, video.contentPlanId));
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

  // Every 5 minutes: poll video statuses
  cron.schedule("*/5 * * * *", async () => {
    try {
      await pollAndPublishVideos();
    } catch (err) {
      logger.error({ err }, "Error in video polling cycle");
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
