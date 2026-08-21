import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, contentPlanItemsTable, avatarConfigTable, automationConfigTable, captionConfigTable, settingsTable, heygenClonedVoicesTable } from "@workspace/db";
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
  CancelVideoParams,
  CancelVideoResponse,
} from "@workspace/api-zod";
import { generateVideo } from "../lib/heygen";
import { reserveCredits, releaseVideoCredits, estimateDurationFromScript, computeReelCreditCost, hasEnoughCredits } from "../lib/credits";
import { publishVideoToInstagram, pickNextAvatar, resolveVoiceId, runCaptionProcessing, runAutomationCycle, insertVideoClaimingUserSlot, resetCaptionProcessingForReapply, hasUsableWavespeedLook } from "../lib/scheduler";
import { isRenderFastV2Failure } from "../lib/render-fast-v2";
import {
  captionsAreEnabled,
  normalizeVideoEffects,
  resolveVideoEffectsForCreation,
} from "../lib/video-pipeline-effects";
import { getBrowserMediaUrl } from "../lib/objectStorage";
// brand-cover import removed — AI cover generation is discontinued
import { logger } from "../lib/logger";
import { cancelVideoForUser } from "../lib/video-cancellation";
import {
  buildGenerationStartClaim,
  buildGenerationStartRollback,
} from "../lib/generation-start-schedule";

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

/**
 * HeyGen CDN URLs (files2.heygen.ai / heygen.ai) contain signed query params
 * that expire in ~7 days. Returning an expired URL causes broken thumbnails /
 * video players in the UI. We null them out here so the frontend falls back to
 * the avatar image or the captioned_video_url instead.
 */
function resolveHeyGenUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.includes("heygen.ai")) return null; // always temp CDN — drop it
  return raw;
}

function mapVideo(v: typeof videosTable.$inferSelect, wavespeedLookId?: number | null) {
  return {
    id: v.id,
    content_plan_id: v.contentPlanId ?? null,
    heygen_video_id: v.heygenVideoId ?? null,
    topic: v.topic ?? null,
    avatar_id: v.avatarId ?? null,
    status: v.status,
    video_url: getBrowserMediaUrl(resolveHeyGenUrl(v.videoUrl)),
    thumbnail_url: getBrowserMediaUrl(resolveHeyGenUrl(v.thumbnailUrl)),
    ig_media_id: v.igMediaId ?? null,
    ig_permalink: v.igPermalink ?? null,
    error_message: v.errorMessage ?? null,
    duration_seconds: v.durationSeconds ?? null,
    captioned_video_url: getBrowserMediaUrl(resolveCaptionedUrl(v.captionedVideoUrl ?? null)),
    caption_status: v.captionStatus ?? null,
    video_effects: (v.videoEffects as { zoom: boolean; ai_broll: boolean; text_cards: boolean } | null) ?? null,
    created_at: v.createdAt.toISOString(),
    updated_at: v.updatedAt.toISOString(),
    published_at: v.publishedAt?.toISOString() ?? null,
    scheduled_publish_at: v.scheduledPublishAt?.toISOString() ?? null,
    thumbnail_cover_url: v.thumbnailCoverUrl ?? null,
    wavespeed_look_id: wavespeedLookId ?? null,
  };
}

// NOTE: /captioned-objects/* is served by routes/captioned.ts (mounted before
// requireAuth in app.ts) so Instagram can fetch videos without a session cookie.

router.get("/videos", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const queryParsed = GetVideosQueryParams.safeParse(req.query);
  const status = queryParsed.success ? queryParsed.data.status ?? "all" : "all";

  const baseQuery = db
    .select({ video: videosTable, wavespeedLookId: contentPlanItemsTable.wavespeedLookId })
    .from(videosTable)
    .leftJoin(contentPlanItemsTable, eq(contentPlanItemsTable.id, videosTable.contentPlanId))
    .orderBy(desc(videosTable.createdAt))
    .limit(50);

  const rows = status !== "all"
    ? await baseQuery.where(and(eq(videosTable.status, status), eq(videosTable.userId, userId)))
    : await baseQuery.where(eq(videosTable.userId, userId));

  res.json(GetVideosResponse.parse(rows.map((r) => mapVideo(r.video, r.wavespeedLookId))));
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

  // ── WaveSpeed branch ──────────────────────────────────────────────────────
  // Delegate to the scheduler's unified selector. It handles the avatar/voice
  // resolution, video row, WaveSpeed submission and recovery without creating a
  // second pipeline in this route.
  const beginWavespeedGeneration = () => {
    runAutomationCycle(userId, item.id, { rescheduleOnManualStart: true }).catch((err) => {
      logger.error({ itemId: item.id, err }, "[/videos/generate] WaveSpeed runAutomationCycle failed");
    });
    // Return schema-compliant 202 immediately — the scheduler updates DB state
    // asynchronously; the frontend polls via getContentPlan to track progress.
    const now = new Date().toISOString();
    res.status(202).json(GenerateVideoResponse.parse({
      id: 0,
      content_plan_id: item.id,
      heygen_video_id: null,
      topic: item.topic,
      avatar_id: null,
      status: "generating",
      video_url: null,
      thumbnail_url: null,
      ig_media_id: null,
      ig_permalink: null,
      error_message: null,
      duration_seconds: null,
      captioned_video_url: null,
      caption_status: null,
      video_effects: null,
      created_at: now,
      updated_at: now,
      published_at: null,
      scheduled_publish_at: null,
      thumbnail_cover_url: null,
    }));
  };

  // A content item can pin an individual WaveSpeed look. In that case, do not
  // inspect HeyGen selection at all.
  if (item.wavespeedLookId) {
    beginWavespeedGeneration();
    return;
  }

  // Load the account selection once. A user who uses Avatar AI/WaveSpeed only
  // intentionally has no HeyGen IDs; this must not be treated as "no avatar".
  const [avatarCfg] = await db.select().from(avatarConfigTable)
    .where(eq(avatarConfigTable.userId, userId)).limit(1);
  if (!avatarCfg?.selectedAvatarIds?.length && await hasUsableWavespeedLook(userId)) {
    beginWavespeedGeneration();
    return;
  }

  // Resolve video effects and language from user settings
  const [userSettings] = await db
    .select({ videoEffects: settingsTable.videoEffects, language: settingsTable.language })
    .from(settingsTable)
    .where(eq(settingsTable.userId, userId))
    .limit(1);
  const heygenApiKey = process.env.HEYGEN_API_KEY;
  if (!heygenApiKey) {
    res.status(503).json({ error: "El servicio de generación no está disponible temporalmente." });
    return;
  }

  // Ensure avatar/voice are set AND that the stored avatarId is still in the active selection.
  // If the user removed the previously assigned avatar, re-pick from the current list.
  {
    if (!avatarCfg?.selectedAvatarIds?.length) {
      res.status(400).json({ error: "No hay avatares configurados: selecciona al menos uno en la página de Avatares" });
      return;
    }
    // Resolve avatar + voice for this manual generation.
    //
    // Voice resolution is the authoritative "is this avatar usable?" check.
    // selectedAvatarIds.includes() alone was not sufficient — public/system HeyGen
    // avatars are pruned from selectedAvatarIds by pruneDeletedAvatars even when
    // perfectly valid (they don't appear in the user's private groups).
    //
    //  1. avatarId set + voice resolves          → use it (respects manual pick)
    //  2. avatarId set + voice fails + NOT in selection → stale; rotate
    //  3. avatarId set + voice fails + IS in selection  → HeyGen config error
    //  4. avatarId null                               → rotate
    const usageCount = (avatarCfg.avatarUsageCount as Record<string, number>) ?? {};

    if (!item.avatarId) {
      // No avatar stored — pick from rotation.
      item.avatarId = pickNextAvatar(
        avatarCfg.selectedAvatarIds,
        avatarCfg.lastUsedAvatarId,
        avatarCfg.rotationStrategy,
        usageCount,
      );
      await db
        .update(avatarConfigTable)
        .set({ lastUsedAvatarId: item.avatarId, updatedAt: new Date() })
        .where(and(eq(avatarConfigTable.id, avatarCfg.id), eq(avatarConfigTable.userId, userId)));
      item.voiceId = null;
    }

    // Re-resolve voice at generation time (picks up current voice_overrides, new clones, etc.)
    // IMPORTANT: if the user stored a specific avatar (item.avatarId is set), NEVER rotate
    // to a different one — not even when voice resolution fails.  Silently swapping the
    // avatar defeats the purpose of a manual pick (common for custom/cloned avatars whose
    // HeyGen group has no default_voice_id configured).
    // If voice truly cannot be resolved we surface a clear, actionable error.
    const freshVoiceId = await resolveVoiceId(item.avatarId!, heygenApiKey, userId);
    item.voiceId = freshVoiceId ?? item.voiceId;

    if (!item.voiceId) {
      // No voice resolved through any path — tell the user what to fix.
      res.status(400).json({
        error:
          "No se encontró una voz para el avatar seleccionado. Ve a Avatares → Voces y asigna una voz a este avatar antes de generar el video.",
      });
      return;
    }

    logger.info(
      { itemId: item.id, avatarId: item.avatarId, voiceId: item.voiceId },
      "[/videos/generate] Avatar + voice resolved — honouring stored avatar",
    );

    await db
      .update(contentPlanItemsTable)
      .set({ avatarId: item.avatarId, voiceId: item.voiceId, updatedAt: new Date() })
      .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.userId, userId)));
  }

  // Check the balance before claiming. A manual request rejected for insufficient
  // credits must keep the card in its original calendar slot.
  const isAdminUser = req.session.user!.role === "admin";
  const estimatedDurationSec = estimateDurationFromScript(item.script!);
  const estimatedCreditCost = computeReelCreditCost(estimatedDurationSec);
  if (!isAdminUser) {
    const enough = await hasEnoughCredits(userId, estimatedCreditCost);
    if (!enough) {
      res.status(402).json({ error: "Créditos insuficientes para generar este video. Recarga tu saldo para continuar." });
      return;
    }
  }

  // Atomically claim the item (scripted -> generating) so concurrent requests
  // or a scheduler tick can't both submit a HeyGen generation. This explicit
  // manual path moves scheduledAt only in that successful claim.
  const claimStartedAt = new Date();
  const claimed = await db
    .update(contentPlanItemsTable)
    .set(buildGenerationStartClaim({ isManualTargetedStart: true, startedAt: claimStartedAt }))
    .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.status, "scripted"), eq(contentPlanItemsTable.userId, userId)))
    .returning({ id: contentPlanItemsTable.id });
  if (claimed.length === 0) {
    res.status(409).json({ error: "Este video ya se está generando" });
    return;
  }

  const [automationCfg] = await db.select().from(automationConfigTable)
    .where(eq(automationConfigTable.userId, userId)).limit(1);
  const captionsEnabled = captionsAreEnabled(automationCfg?.captionsEnabled);

  // Save a complete, explicit snapshot. A missing or malformed value can never
  // make a renderer treat an old truthy setting as enabled.
  const effectsSnapshot = resolveVideoEffectsForCreation(
    userSettings?.videoEffects,
    item.videoEffectsOverride,
  );

  // Create video row — set captionStatus upfront so the pipeline UI knows
  // whether Caption Studio will run even before HeyGen finishes
  const videoRow = await insertVideoClaimingUserSlot(userId, {
    userId,
    contentPlanId: item.id,
    topic: item.topic,
    avatarId: item.avatarId,
    status: "generating",
    captionStatus: captionsEnabled ? null : "disabled",
    videoEffects: effectsSnapshot,
    // Start the timeout clock at submission, not at first poll
    generatingStartedAt: new Date(),
  });
  if (!videoRow) {
    // Slot lost at the DB level (concurrent launch) — release the item claim.
    await db
      .update(contentPlanItemsTable)
      .set(buildGenerationStartRollback({
        isManualTargetedStart: true,
        originalScheduledAt: item.scheduledAt,
        startedAt: new Date(),
      }))
      .where(eq(contentPlanItemsTable.id, item.id));
    res.status(409).json({ error: "Ya tienes un video generándose. Espera a que termine para generar otro." });
    return;
  }

  await db
    .update(contentPlanItemsTable)
    .set({ videoId: videoRow.id, updatedAt: new Date() })
    .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.userId, userId)));

  // Reserve credits before dispatching to the generation provider
  if (!isAdminUser) {
    try {
      await reserveCredits(userId, estimatedCreditCost, videoRow.id, `Reserva generación video ${videoRow.id}`);
    } catch {
      await db.update(videosTable).set({ status: "failed", errorMessage: "Error al reservar créditos", updatedAt: new Date() })
        .where(and(eq(videosTable.id, videoRow.id), eq(videosTable.userId, userId)));
      await db.update(contentPlanItemsTable).set(buildGenerationStartRollback({
        isManualTargetedStart: true,
        originalScheduledAt: item.scheduledAt,
        startedAt: new Date(),
      }))
        .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.userId, userId)));
      res.status(402).json({ error: "Créditos insuficientes para generar este video. Recarga tu saldo para continuar." });
      return;
    }
  }

  // Resolve voice speed/pitch so the manual route matches the scheduler's audio params
  let manualVoiceSpeed: number | undefined;
  let manualVoicePitch: number | undefined;
  if (item.voiceId) {
    const [clonedVoiceRow] = await db
      .select({ speed: heygenClonedVoicesTable.speed, pitch: heygenClonedVoicesTable.pitch })
      .from(heygenClonedVoicesTable)
      .where(eq(heygenClonedVoicesTable.voiceId, item.voiceId));
    manualVoiceSpeed = clonedVoiceRow?.speed ?? undefined;
    manualVoicePitch = clonedVoiceRow?.pitch ?? undefined;
  }

  // Fire and forget video generation — pass the user's own HeyGen key
  generateVideo({
    script:          item.script,
    avatar_id:       item.avatarId!,
    voice_id:        item.voiceId!,
    title:           item.topic,
    captionsEnabled,
    voiceSpeed:      manualVoiceSpeed,
    voicePitch:      manualVoicePitch,
    language:        userSettings?.language ?? "es",
    userId,
  }, heygenApiKey)
    .then(async (heygenVideoId) => {
      await db.update(videosTable).set({ heygenVideoId, updatedAt: new Date() })
        .where(and(
          eq(videosTable.id, videoRow.id),
          eq(videosTable.userId, userId),
          eq(videosTable.status, "generating"),
        ));
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
      logger.error({ err, videoId: videoRow.id, contentPlanId: item.id }, "[VideoGeneration] Submission failed");
      const failed = await db.update(videosTable).set({
        status: "failed",
        errorMessage: "No se pudo iniciar la generación del video. Intenta de nuevo.",
        updatedAt: new Date(),
      })
        .where(and(
          eq(videosTable.id, videoRow.id),
          eq(videosTable.userId, userId),
          eq(videosTable.status, "generating"),
        ))
        .returning({ id: videosTable.id });
      await db.update(contentPlanItemsTable).set(buildGenerationStartRollback({
        isManualTargetedStart: true,
        originalScheduledAt: item.scheduledAt,
        startedAt: new Date(),
      }, "failed"))
        .where(and(
          eq(contentPlanItemsTable.id, item.id),
          eq(contentPlanItemsTable.userId, userId),
          eq(contentPlanItemsTable.videoId, videoRow.id),
        ));
      // Release reserved credits on immediate submission failure
      if (!isAdminUser && failed[0]) {
        releaseVideoCredits(videoRow.id, "Fallo al iniciar la generación").catch((creditErr) =>
          logger.error({ videoId: videoRow.id, creditErr }, "[Credits] release failed after submission error"),
        );
      }
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
  if (video.status === "cancelled") {
    res.status(409).json({ error: "Este video fue cancelado. Reintenta la generación antes de publicarlo." });
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
  // A Fast V2 failure must be regenerated, never published as the original
  // uncaptioned source. Keep the exact renderer error intact for the UI.
  if (isRenderFastV2Failure(video.errorMessage)) {
    res.status(409).json({
      error: `${video.errorMessage} Regenera el video antes de intentar publicarlo.`,
    });
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
  if (video.status !== "failed" && video.status !== "cancelled") {
    res.status(400).json({ error: "Solo se pueden reintentar videos fallidos o cancelados" });
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
 * POST /api/videos/:id/cancel
 * Atomically fences an active generation/render before idempotently releasing
 * only the reservations that are still open for this user's video.
 */
router.post("/videos/:id/cancel", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = CancelVideoParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const result = await cancelVideoForUser(paramsParsed.data.id, userId);
  if (result.kind !== "cancelled" && result.kind !== "already_cancelled") {
    if (result.kind === "not_found") {
      res.status(404).json({ error: "Video not found" });
      return;
    }
    res.status(409).json({ error: "Este video ya terminó y no se puede cancelar" });
    return;
  }

  res.json(CancelVideoResponse.parse(mapVideo(result.video)));
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
  const currentVideoEffects = normalizeVideoEffects(userSettings?.videoEffects);

  // Reset only if no other entry point holds a live caption-processing lease.
  const requeued = await resetCaptionProcessingForReapply(id, currentVideoEffects);
  if (!requeued) {
    res.status(409).json({ error: "Los efectos ya están procesando, espera a que terminen" });
    return;
  }

  // Fire-and-forget
  // skipBroll=true: do not regenerate B-roll images on a reapply path — no persisted
  // assets exist to reuse and silent AI spend on reapply is not acceptable.
  runCaptionProcessing(id, video.videoUrl, video.contentPlanId ?? null, null, video.durationSeconds ?? null, true)
    .catch((err) => console.error("[ReapplyCaptions] Failed for video", id, err));

  res.json({ success: true, message: "Re-procesando efectos en segundo plano" });
});

router.post("/videos/:id/regenerate-cover", (_req, res): void => {
  // AI cover generation has been permanently discontinued.
  res.status(404).json({ error: "Esta funcionalidad ya no está disponible." });
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
