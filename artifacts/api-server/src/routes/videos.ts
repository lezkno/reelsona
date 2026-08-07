import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, contentPlanItemsTable, avatarConfigTable } from "@workspace/db";
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
} from "@workspace/api-zod";
import { generateVideo } from "../lib/heygen";
import { publishVideoToInstagram, pickNextAvatar, resolveVoiceId } from "../lib/scheduler";

const router = Router();

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
    captioned_video_url: v.captionedVideoUrl ?? null,
    caption_status: v.captionStatus ?? null,
    created_at: v.createdAt.toISOString(),
    updated_at: v.updatedAt.toISOString(),
    published_at: v.publishedAt?.toISOString() ?? null,
  };
}

router.get("/videos", async (req, res): Promise<void> => {
  const queryParsed = GetVideosQueryParams.safeParse(req.query);
  const status = queryParsed.success ? queryParsed.data.status ?? "all" : "all";

  const videos =
    status !== "all"
      ? await db.select().from(videosTable).where(eq(videosTable.status, status)).orderBy(desc(videosTable.createdAt)).limit(50)
      : await db.select().from(videosTable).orderBy(desc(videosTable.createdAt)).limit(50);

  res.json(GetVideosResponse.parse(videos.map(mapVideo)));
});

router.post("/videos/generate", async (req, res): Promise<void> => {
  const parsed = GenerateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [item] = await db
    .select()
    .from(contentPlanItemsTable)
    .where(eq(contentPlanItemsTable.id, parsed.data.content_plan_id))
    .limit(1);

  if (!item) {
    res.status(404).json({ error: "Content plan item not found" });
    return;
  }

  if (!item.script) {
    res.status(400).json({ error: "El video necesita un guion antes de generar el video" });
    return;
  }

  // If the item has no avatar/voice assigned, pick one from the avatar rotation
  if (!item.avatarId || !item.voiceId) {
    const [avatarCfg] = await db.select().from(avatarConfigTable).limit(1);
    if (!avatarCfg?.selectedAvatarIds?.length) {
      res.status(400).json({ error: "No hay avatares configurados: seleccioná al menos uno en la página de Avatares" });
      return;
    }
    if (!item.avatarId) {
      item.avatarId = pickNextAvatar(
        avatarCfg.selectedAvatarIds,
        avatarCfg.lastUsedAvatarId,
        avatarCfg.rotationStrategy,
        (avatarCfg.avatarUsageCount as Record<string, number>) ?? {}
      );
    }
    if (!item.voiceId) {
      const voiceId = await resolveVoiceId(item.avatarId);
      if (!voiceId) {
        res.status(400).json({ error: "No se encontró ninguna voz disponible en HeyGen. Verificá tu cuenta de HeyGen." });
        return;
      }
      item.voiceId = voiceId;
    }
    await db
      .update(contentPlanItemsTable)
      .set({ avatarId: item.avatarId, voiceId: item.voiceId, updatedAt: new Date() })
      .where(eq(contentPlanItemsTable.id, item.id));
  }

  // Atomically claim the item (scripted -> generating) so concurrent requests
  // or a scheduler tick can't both submit a HeyGen generation for it.
  const claimed = await db
    .update(contentPlanItemsTable)
    .set({ status: "generating", updatedAt: new Date() })
    .where(and(eq(contentPlanItemsTable.id, item.id), eq(contentPlanItemsTable.status, "scripted")))
    .returning({ id: contentPlanItemsTable.id });
  if (claimed.length === 0) {
    res.status(409).json({ error: "Este video ya se está generando" });
    return;
  }

  // Create video row
  const [videoRow] = await db
    .insert(videosTable)
    .values({
      contentPlanId: item.id,
      topic: item.topic,
      avatarId: item.avatarId,
      status: "generating",
    })
    .returning();

  await db
    .update(contentPlanItemsTable)
    .set({ videoId: videoRow.id, updatedAt: new Date() })
    .where(eq(contentPlanItemsTable.id, item.id));

  // Fire and forget video generation
  generateVideo({
    script: item.script,
    avatar_id: item.avatarId,
    voice_id: item.voiceId,
    title: item.topic,
  })
    .then(async (heygenVideoId) => {
      await db.update(videosTable).set({ heygenVideoId, updatedAt: new Date() }).where(eq(videosTable.id, videoRow.id));
      // Update avatar usage
      const [avatarCfg] = await db.select().from(avatarConfigTable).limit(1);
      if (avatarCfg) {
        const usageCount = (avatarCfg.avatarUsageCount as Record<string, number>) ?? {};
        if (item.avatarId) usageCount[item.avatarId] = (usageCount[item.avatarId] ?? 0) + 1;
        await db.update(avatarConfigTable).set({ lastUsedAvatarId: item.avatarId, avatarUsageCount: usageCount, updatedAt: new Date() }).where(eq(avatarConfigTable.id, avatarCfg.id));
      }
    })
    .catch(async (err) => {
      const error = err instanceof Error ? err.message : String(err);
      await db.update(videosTable).set({ status: "failed", errorMessage: error, updatedAt: new Date() }).where(eq(videosTable.id, videoRow.id));
      await db.update(contentPlanItemsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, item.id));
    });

  res.status(202).json(GenerateVideoResponse.parse(mapVideo(videoRow)));
});

router.get("/videos/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = GetVideoParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, paramsParsed.data.id)).limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json(GetVideoResponse.parse(mapVideo(video)));
});

router.post("/videos/:id/publish", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = PublishVideoParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const bodyParsed = PublishVideoBody.safeParse(req.body ?? {});

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, paramsParsed.data.id)).limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  if (video.status !== "ready" || !video.videoUrl) {
    res.status(400).json({ error: "Video is not ready for publishing" });
    return;
  }

  // If custom caption provided, update content item
  if (bodyParsed.success && bodyParsed.data.caption && video.contentPlanId) {
    const caption = [bodyParsed.data.caption, bodyParsed.data.hashtags].filter(Boolean).join("\n\n");
    await db.update(contentPlanItemsTable).set({ caption, updatedAt: new Date() }).where(eq(contentPlanItemsTable.id, video.contentPlanId));
  }

  await publishVideoToInstagram(video.id);

  const [updated] = await db.select().from(videosTable).where(eq(videosTable.id, video.id)).limit(1);
  res.json(PublishVideoResponse.parse(mapVideo(updated ?? video)));
});

export default router;
