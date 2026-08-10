import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, contentPlanItemsTable, avatarConfigTable, automationConfigTable, captionConfigTable, settingsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  GetVideosQueryParams,
  GetVideosResponse,
  GenerateVideoBody,
  GenerateVideoResponse,
  GetVideoParams,
  GetVideoResponse,
  PublishVideoParams,
  PublishVideoBody,
  PublishVideoResponse,
  ScheduleVideoParams,
  ScheduleVideoBody,
  ScheduleVideoResponse,
} from "@workspace/api-zod";
import { generateVideo } from "../lib/heygen";
import { publishVideoToInstagram, pickNextAvatar, resolveVoiceId, runCaptionProcessing } from "../lib/scheduler";
import { logger } from "../lib/logger";

const router = Router();

import fs from "fs";
import path from "path";
import { CAPTION_DIR } from "../lib/caption-engine";

/**
 * Resolve the captionedVideoUrl to return, filtering out stale /tmp-based URLs.
 * Pre-Object-Storage entries point to /api/captioned/<file> on this server;
 * those files are wiped on every restart. If the file is gone, return null so
 * the frontend doesn't try to load a dead URL and show a broken player.
 * Object Storage URLs (anything that does NOT contain "/api/captioned/") are
 * always returned as-is.
 */
function resolveCaptionedUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.includes("/api/captioned/")) return raw; // Object Storage or external — always valid
  const filename = raw.split("/api/captioned/").pop() ?? "";
  const filePath = path.join(CAPTION_DIR, filename);
  return fs.existsSync(filePath) ? raw : null;
}

function mapVideo(v: typeof videosTable.$inferSelect) {
  return {
    id: v.id,
    content_plan_id: v.contentPlanId ?? null,
    heygen_video_id: v.heygenVideoId ?? null,
    topic: v.topic ?? null,
    avatar_id: v.avatarId ?? null,
    status: v.status,
    video_url: v.videoUrl ?? null,
    thumbnail_url: v.thumbnailUrl ?? null,
    ig_media_id: v.igMediaId ?? null,
    ig_permalink: v.igPermalink ?? null,
    error_message: v.errorMessage ?? null,
    duration_seconds: v.durationSeconds ?? null,
    captioned_video_url: resolveCaptionedUrl(v.captionedVideoUrl ?? null),
    caption_status: v.captionStatus ?? null,
    video_effects: (v.videoEffects as { zoom: boolean; ai_broll: boolean; text_cards: boolean } | null) ?? null,
    created_at: v.createdAt.toISOString(),
    updated_at: v.updatedAt.toISOString(),
    published_at: v.publishedAt?.toISOString() ?? null,
    scheduled_publish_at: v.scheduledPublishAt?.toISOString() ?? null,
    thumbnail_cover_url: v.thumbnailCoverUrl ?? null,
  };
}

// NOTE: /captioned-objects/* is served by routes/captioned.ts (mounted before
// requireAuth in app.ts) so Instagram can fetch videos without a session cookie.

router.get("/videos", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const queryParsed = GetVideosQueryParams.safeParse(req.query);
  const status = queryParsed.success ? queryParsed.data.status ?? "all" : "all";

  const videos =
    status !== "all"
      ? await db.select().from(videosTable).where(and(eq(videosTable.status, status), eq(videosTable.userId, userId))).orderBy(desc(videosTable.createdAt)).limit(50)
      : await db.select().from(videosTable).where(eq(videosTable.userId, userId)).orderBy(desc(videosTable.createdAt)).limit(50);

  res.json(GetVideosResponse.parse(videos.map(mapVideo)));
});

router.post("/videos/generate", async (req, res): Promise<void> => {
  const parsed = GenerateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.session.user!.userId;

  const [item] = await db
    .select()
    .from(contentPlanItemsTable)
    .where(and(eq(contentPlanItemsTable.id, parsed.data.content_plan_id), eq(contentPlanItemsTable.userId, userId)))
    .limit(1);

  if (!item) {
    res.status(404).json({ error: "Content plan item not found" });
    return;
  }

  if (!item.script) {
    res.status(400).json({ error: "El video necesita un guion antes de generar el video" });
    return;
  }

  // Prevent launching a second HeyGen job while one is already running.
  // Parallel generations waste credits and can conflict on avatar rotation.
  const [alreadyGenerating] = await db
    .select({ id: videosTable.id, topic: videosTable.topic })
    .from(videosTable)
    .where(and(eq(videosTable.status, "generating"), eq(videosTable.userId, userId)))
    .limit(1);
  if (alreadyGenerating) {
    res.status(409).json({
      error: `Ya hay un video en proceso: "${alreadyGenerating.topic}". Espera a que termine antes de crear otro.`,
    });
    return;
  }

  // Resolve the user's HeyGen API key and video effects from their settings row
  const [userSettings] = await db
    .select({ heygenApiKey: settingsTable.heygenApiKey, videoEffects: settingsTable.videoEffects })
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId))
    .limit(1);
  const heygenApiKey = userSettings?.heygenApiKey ?? undefined;
  if (!heygenApiKey) {
    res.status(400).json({ error: "No hay una API key de HeyGen configurada. Conecta tu cuenta en Configuración → Integraciones." });
    return;
  }

  // Ensure avatar/voice are set AND that the stored avatarId is still in the active selection.
  // If the user removed the previously assigned avatar, re-pick from the current list.
  {
    const [avatarCfg] = await db.select().from(avatarConfigTable)
      .where(eq(avatarConfigTable.userId, userId)).limit(1);
    if (!avatarCfg?.selectedAvatarIds?.length) {
      res.status(400).json({ error: "No hay avatares configurados: selecciona al menos uno en la página de Avatares" });
      return;
    }
    const avatarStillValid =
      item.avatarId && avatarCfg.selectedAvatarIds.includes(item.avatarId);
    if (!avatarStillValid) {
      item.avatarId = pickNextAvatar(
        avatarCfg.selectedAvatarIds,
        avatarCfg.lastUsedAvatarId,
        avatarCfg.rotationStrategy,
        (avatarCfg.avatarUsageCount as Record<string, number>) ?? {}
      );
      // Advance lastUsedAvatarId so next generation picks a different avatar
      await db
        .update(avatarConfigTable)
        .set({ lastUsedAvatarId: item.avatarId, updatedAt: new Date() })
        .where(and(eq(avatarConfigTable.id, avatarCfg.id), eq(avatarConfigTable.userId, userId)));
      // Force voice re-resolution for the new avatar
      item.voiceId = null;
    }
    // Always re-resolve from current voice_overrides at generation time.
    // The voiceId stored on the item may be stale (set before the user configured
    // per-avatar overrides, or before they changed them). The override always wins.
    const freshVoiceId = await resolveVoiceId(item.avatarId!, heygenApiKey);
    if (!freshVoiceId && !item.voiceId) {
      res.status(400).json({ error: "No se encontró ninguna voz disponible en HeyGen. Verifica tu cuenta de HeyGen." });
      return;
    }
    item.voiceId = freshVoiceId ?? item.voiceId;
    await db
      .update(contentPlanItemsTable)
      .set({ avatarId: item.avatarId, voiceId: item.voiceId, updatedAt: new Date() })
      .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.userId, userId)));
  }

  // Atomically claim the item (scripted -> generating) so concurrent requests
  // or a scheduler tick can't both submit a HeyGen generation for it.
  const claimed = await db
    .update(contentPlanItemsTable)
    .set({ status: "generating", updatedAt: new Date() })
    .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.status, "scripted"), eq(contentPlanItemsTable.userId, userId)))
    .returning({ id: contentPlanItemsTable.id });
  if (claimed.length === 0) {
    res.status(409).json({ error: "Este video ya se está generando" });
    return;
  }

  // Manual videos request captions whenever Caption Studio is configured,
  // regardless of the automation captionsEnabled toggle (which only controls
  // the automatic pipeline). null = captions requested; "disabled" = skip.
  const [captionCfg] = await db.select().from(captionConfigTable)
    .where(eq(captionConfigTable.userId, userId)).limit(1);
  const [automationCfg] = await db.select().from(automationConfigTable)
    .where(eq(automationConfigTable.userId, userId)).limit(1);

  // Resolve effective video effects: item override (if set) merged over account default
  const DEFAULT_EFFECTS = { zoom: false, ai_broll: false, text_cards: false };
  const accountEffects = (userSettings?.videoEffects as typeof DEFAULT_EFFECTS | null) ?? DEFAULT_EFFECTS;
  const itemOverride = (item as any).videoEffectsOverride as Partial<typeof DEFAULT_EFFECTS> | null;
  const effectsSnapshot = itemOverride
    ? { ...accountEffects, ...itemOverride }
    : accountEffects;

  // Create video row — set captionStatus upfront so the pipeline UI knows
  // whether Caption Studio will run even before HeyGen finishes
  const [videoRow] = await db
    .insert(videosTable)
    .values({
      userId,
      contentPlanId: item.id,
      topic: item.topic,
      avatarId: item.avatarId,
      status: "generating",
      captionStatus: captionCfg ? null : "disabled",
      videoEffects: effectsSnapshot,
      // Start the timeout clock at submission, not at first poll
      generatingStartedAt: new Date(),
    })
    .returning();

  await db
    .update(contentPlanItemsTable)
    .set({ videoId: videoRow.id, updatedAt: new Date() })
    .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.userId, userId)));

  // Fire and forget video generation — pass the user's own HeyGen key
  generateVideo({
    script: item.script,
    avatar_id: item.avatarId!,
    voice_id: item.voiceId!,
    title: item.topic,
    captionsEnabled: automationCfg?.captionsEnabled ?? false,
  }, heygenApiKey)
    .then(async (heygenVideoId) => {
      await db.update(videosTable).set({ heygenVideoId, updatedAt: new Date() })
        .where(and(eq(videosTable.id, videoRow.id), eq(videosTable.userId, userId)));
      // Update avatar usage
      const [avatarCfg] = await db.select().from(avatarConfigTable)
        .where(eq(avatarConfigTable.userId, userId)).limit(1);
      if (avatarCfg) {
        const usageCount = (avatarCfg.avatarUsageCount as Record<string, number>) ?? {};
        if (item.avatarId) usageCount[item.avatarId] = (usageCount[item.avatarId] ?? 0) + 1;
        await db.update(avatarConfigTable)
          .set({ lastUsedAvatarId: item.avatarId, avatarUsageCount: usageCount, updatedAt: new Date() })
          .where(and(eq(avatarConfigTable.id, avatarCfg.id), eq(avatarConfigTable.userId, userId)));
      }
    })
    .catch(async (err) => {
      const error = err instanceof Error ? err.message : String(err);
      await db.update(videosTable).set({ status: "failed", errorMessage: error, updatedAt: new Date() })
        .where(and(eq(videosTable.id, videoRow.id), eq(videosTable.userId, userId)));
      await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.userId, userId)));
    });

  res.status(202).json(GenerateVideoResponse.parse(mapVideo(videoRow)));
});

router.get("/videos/:id", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = GetVideoParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, paramsParsed.data.id), eq(videosTable.userId, userId))).limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json(GetVideoResponse.parse(mapVideo(video)));
});

router.post("/videos/:id/publish", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = PublishVideoParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const bodyParsed = PublishVideoBody.safeParse(req.body ?? {});

  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, paramsParsed.data.id), eq(videosTable.userId, userId))).limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // A video needs a URL (captioned or original) to be publishable
  const publishableUrl = video.captionedVideoUrl || video.videoUrl;
  if (!publishableUrl) {
    res.status(400).json({ error: "Video is not ready for publishing" });
    return;
  }
  if (video.status === "generating") {
    res.status(400).json({ error: "El video todavía se está generando, espera a que termine" });
    return;
  }
  if (video.status === "published") {
    res.status(400).json({ error: "Este video ya fue publicado en Instagram" });
    return;
  }
  if (video.status === "publishing") {
    res.status(400).json({ error: "Este video ya se está publicando en este momento" });
    return;
  }
  // "failed" can happen when a publish attempt was interrupted (server restart mid-publish).
  // If the video has a URL it's still publishable — reset to "ready" so the pipeline proceeds.
  if (video.status === "failed") {
    if (!video.videoUrl) {
      res.status(400).json({ error: "Este video falló al generarse. Reintenta la generación desde el Plan de Contenido." });
      return;
    }
    await db.update(videosTable)
      .set({ status: "ready", errorMessage: null, updatedAt: new Date() })
      .where(and(eq(videosTable.id, video.id), eq(videosTable.userId, userId)));
  }
  if (video.captionStatus === null || video.captionStatus === "processing") {
    res.status(400).json({ error: "Los subtítulos todavía se están procesando — espera un momento antes de publicar" });
    return;
  }

  // If custom caption provided, update content item
  if (bodyParsed.success && bodyParsed.data.caption && video.contentPlanId) {
    const caption = [bodyParsed.data.caption, bodyParsed.data.hashtags].filter(Boolean).join("\n\n");
    await db.update(contentPlanItemsTable).set({ caption, updatedAt: new Date() })
      .where(and(eq(contentPlanItemsTable.id, video.contentPlanId), eq(contentPlanItemsTable.userId, userId)));
  }

  // Fire-and-forget: publish runs in the background so the HTTP request returns
  // immediately (avoids Replit proxy 30-second timeout on long publishes).
  // The UI polls /api/videos every 5 s and picks up status changes automatically.
  publishVideoToInstagram(video.id).catch((err) => {
    logger.error({ videoId: video.id, err }, "[Publish] Background publish failed");
  });

  // Return the current video state — status will move to "publishing" momentarily
  const [current] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, video.id), eq(videosTable.userId, userId))).limit(1);
  res.json(PublishVideoResponse.parse(mapVideo(current ?? video)));
});

/**
 * POST /api/videos/:id/retry
 * Retry a failed video: deletes the failed video row and resets the linked
 * content plan item back to "scripted" so the user can regenerate it.
 */
router.post("/videos/:id/retry", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(raw);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, id), eq(videosTable.userId, userId))).limit(1);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  if (video.status !== "failed") {
    res.status(400).json({ error: "Solo se pueden reintentar videos en estado fallido" });
    return;
  }

  // Detach from content plan item and reset to scripted so it can be regenerated
  if (video.contentPlanId) {
    await db
      .update(contentPlanItemsTable)
      .set({ videoId: null, status: "scripted", updatedAt: new Date() })
      .where(and(eq(contentPlanItemsTable.id, video.contentPlanId), eq(contentPlanItemsTable.userId, userId)));
  }

  // Delete the failed video row; a fresh one will be created on next generate
  await db.delete(videosTable).where(and(eq(videosTable.id, id), eq(videosTable.userId, userId)));

  res.json({ success: true });
});

/**
 * POST /api/videos/:id/reapply-captions
 * Re-run caption/effects processing on a video that already has a videoUrl.
 * Useful for testing new effects (e.g. Ken Burns zoom) without re-generating the HeyGen video.
 */
router.post("/videos/:id/reapply-captions", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(raw);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, id), eq(videosTable.userId, userId))).limit(1);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  if (!video.videoUrl) {
    res.status(400).json({ error: "Este video aún no tiene URL de fuente" });
    return;
  }
  if (video.captionStatus === "processing") {
    res.status(409).json({ error: "Los efectos ya están procesando, espera a que terminen" });
    return;
  }

  const [captionCfg] = await db.select().from(captionConfigTable)
    .where(eq(captionConfigTable.userId, userId)).limit(1);
  if (!captionCfg) {
    res.status(400).json({ error: "No hay configuración de Caption Studio. Configúrala primero en la sección Captions." });
    return;
  }

  // Read the user's CURRENT video effects from settings so re-apply always
  // honours the latest configuration (e.g. zoom was enabled after original generation)
  const [userSettings] = await db.select({ videoEffects: settingsTable.videoEffects })
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId))
    .limit(1);
  const currentVideoEffects = (userSettings?.videoEffects as object | null) ?? null;

  // Reset caption state AND refresh videoEffects from current settings
  await db.update(videosTable)
    .set({ captionStatus: null, captionedVideoUrl: null, videoEffects: currentVideoEffects, updatedAt: new Date() })
    .where(and(eq(videosTable.id, id), eq(videosTable.userId, userId)));

  // Fire-and-forget
  runCaptionProcessing(id, video.videoUrl, video.contentPlanId ?? null, null, video.durationSeconds ?? null)
    .catch((err) => console.error("[ReapplyCaptions] Failed for video", id, err));

  res.json({ success: true, message: "Re-procesando efectos en segundo plano" });
});

router.delete("/videos/:id", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(raw);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, id), eq(videosTable.userId, userId))).limit(1);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  // Detach from content plan item first (nullify videoId so the item stays)
  if (video.contentPlanId) {
    await db
      .update(contentPlanItemsTable)
      .set({ videoId: null, status: "scripted", updatedAt: new Date() })
      .where(and(eq(contentPlanItemsTable.id, video.contentPlanId), eq(contentPlanItemsTable.userId, userId)));
  }

  await db.delete(videosTable).where(and(eq(videosTable.id, id), eq(videosTable.userId, userId)));
  res.json({ success: true, message: "Deleted" });
});

router.patch("/videos/:id/schedule", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = ScheduleVideoParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const bodyParsed = ScheduleVideoBody.safeParse(req.body ?? {});
  if (!bodyParsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const [video] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, paramsParsed.data.id), eq(videosTable.userId, userId))).limit(1);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  if (video.status !== "ready") { res.status(400).json({ error: "Video is not ready" }); return; }

  const scheduledAt = bodyParsed.data.scheduled_publish_at
    ? new Date(bodyParsed.data.scheduled_publish_at)
    : null;

  await db.update(videosTable)
    .set({ scheduledPublishAt: scheduledAt, updatedAt: new Date() })
    .where(and(eq(videosTable.id, video.id), eq(videosTable.userId, userId)));

  const [updated] = await db.select().from(videosTable)
    .where(and(eq(videosTable.id, video.id), eq(videosTable.userId, userId))).limit(1);
  res.json(ScheduleVideoResponse.parse(mapVideo(updated ?? video)));
});

export default router;
