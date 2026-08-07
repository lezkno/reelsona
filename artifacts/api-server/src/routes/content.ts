import { Router } from "express";
import { db } from "@workspace/db";
import { contentPlanItemsTable, settingsTable, automationConfigTable, videosTable } from "@workspace/db";
import { eq, and, sql, isNotNull, gte, inArray } from "drizzle-orm";
import { computeUpcomingSlots } from "../lib/schedule";
import {
  GetContentPlanQueryParams,
  GetContentPlanResponse,
  GenerateContentPlanBody,
  CreateContentItemBody,
  CreateContentItemResponse,
  ProcessContentItemNowParams,
  ProcessContentItemNowResponse,
  GenerateContentPlanResponse,
  GenerateScriptBody,
  GenerateScriptResponse,
  GetContentItemParams,
  GetContentItemResponse,
  UpdateContentItemParams,
  UpdateContentItemBody,
  UpdateContentItemResponse,
  DeleteContentItemParams,
  DeleteContentItemResponse,
} from "@workspace/api-zod";
import { generateScript, generateContentTopics } from "../lib/ai-scripts";
import { runAutomationCycle } from "../lib/scheduler";

const router = Router();

function mapItem(
  item: typeof contentPlanItemsTable.$inferSelect,
  captionStatus?: string | null
) {
  return {
    id: item.id,
    topic: item.topic,
    hook: item.hook ?? null,
    script: item.script ?? null,
    cta: item.cta ?? null,
    avatar_id: item.avatarId ?? null,
    voice_id: item.voiceId ?? null,
    caption: item.caption ?? null,
    hashtags: item.hashtags ?? null,
    scheduled_at: item.scheduledAt?.toISOString() ?? null,
    status: item.status,
    video_id: item.videoId ?? null,
    caption_status: captionStatus ?? null,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}

/** Fetch captionStatus for a list of video IDs, returns a Map<videoId, captionStatus>. */
async function fetchCaptionStatuses(videoIds: number[]): Promise<Map<number, string | null>> {
  if (videoIds.length === 0) return new Map();
  const rows = await db
    .select({ id: videosTable.id, captionStatus: videosTable.captionStatus })
    .from(videosTable)
    .where(inArray(videosTable.id, videoIds));
  return new Map(rows.map((r) => [r.id, r.captionStatus]));
}

router.get("/content/plan", async (req, res): Promise<void> => {
  const queryParsed = GetContentPlanQueryParams.safeParse(req.query);
  const status = queryParsed.success ? queryParsed.data.status ?? "all" : "all";
  const limit = queryParsed.success ? queryParsed.data.limit ?? 30 : 30;

  const conditions =
    status !== "all" ? [eq(contentPlanItemsTable.status, status)] : [];

  // Fetch items + automation config in parallel
  const [items, [automation]] = await Promise.all([
    db
      .select()
      .from(contentPlanItemsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        sql`${contentPlanItemsTable.scheduledAt} ASC NULLS LAST`,
        contentPlanItemsTable.createdAt
      )
      .limit(limit),
    db.select().from(automationConfigTable).limit(1),
  ]);

  const captionsGloballyEnabled = automation?.captionsEnabled ?? false;

  // Fetch captionStatus for items that have an associated video
  const videoIds = items.map((i) => i.videoId).filter((v): v is number => v != null);
  const captionMap = await fetchCaptionStatuses(videoIds);

  res.json(
    GetContentPlanResponse.parse(
      items.map((i) => {
        if (i.videoId == null) return mapItem(i, null);

        let cs = captionMap.get(i.videoId) ?? null;

        // Backfill: videos created before the captionStatus-aware fix have
        // captionStatus = "disabled" by default. If captions are globally
        // enabled and the item is still in-flight (generating/ready), treat
        // it as null (pending) so the Caption Studio step appears in the UI.
        const inFlight = i.status === "generating" || i.status === "ready";
        if (captionsGloballyEnabled && cs === "disabled" && inFlight) {
          cs = null;
        }

        return mapItem(i, cs);
      })
    )
  );
});

router.post("/content/plan/generate", async (req, res): Promise<void> => {
  const parsed = GenerateContentPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [settings] = await db.select().from(settingsTable).limit(1);
  const niche = settings?.niche ?? "marketing digital";
  const keywords = settings?.topicKeywords ?? [];
  const tone = settings?.tone ?? "casual";
  const language = settings?.language ?? "es";

  const existingItems = await db.select({ topic: contentPlanItemsTable.topic }).from(contentPlanItemsTable).limit(20);
  const existingTopics = existingItems.map((i) => i.topic);

  // Compute publishing slots from the automation schedule (days of week + times)
  const [automation] = await db.select().from(automationConfigTable).limit(1);
  const now = new Date();
  const futureScheduled = await db
    .select({ scheduledAt: contentPlanItemsTable.scheduledAt })
    .from(contentPlanItemsTable)
    .where(and(isNotNull(contentPlanItemsTable.scheduledAt), gte(contentPlanItemsTable.scheduledAt, now)));

  const postsPerDay = parsed.data.posts_per_day ?? 1;
  const slots = computeUpcomingSlots({
    daysOfWeek: automation?.daysOfWeek ?? [1, 2, 3, 4, 5],
    postingTimes: automation?.postingTimes ?? ["09:00"],
    timezone: automation?.timezone ?? "America/Buenos_Aires",
    scheduledDays: parsed.data.days,
    postsPerDay,
    occupied: futureScheduled.map((r) => r.scheduledAt!).filter(Boolean),
  });

  if (slots.length === 0) {
    res.status(400).json({ error: "No hay horarios disponibles: revisá los días y horas en Automatización" });
    return;
  }

  const topics = await generateContentTopics(
    niche,
    keywords,
    tone,
    language,
    parsed.data.days,
    postsPerDay,
    existingTopics
  );

  const inserted = await db
    .insert(contentPlanItemsTable)
    .values(
      topics.slice(0, slots.length).map((t, i) => ({
        topic: t.topic,
        scheduledAt: slots[i],
        status: "draft",
      }))
    )
    .returning();

  res.status(201).json(GenerateContentPlanResponse.parse(inserted.map((i) => mapItem(i))));
});

router.post("/content", async (req, res): Promise<void> => {
  const parsed = CreateContentItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let topic = parsed.data.topic?.trim() ?? "";

  // If no topic given, ask the AI for one
  if (!topic) {
    const [settings] = await db.select().from(settingsTable).limit(1);
    const niche = settings?.niche ?? "marketing digital";
    const keywords = settings?.topicKeywords ?? [];
    const tone = settings?.tone ?? "casual";
    const language = settings?.language ?? "es";
    const existingItems = await db.select({ topic: contentPlanItemsTable.topic }).from(contentPlanItemsTable).limit(20);
    const generated = await generateContentTopics(niche, keywords, tone, language, 1, 1, existingItems.map((i) => i.topic));
    if (!generated[0]?.topic) {
      res.status(500).json({ error: "No se pudo generar el tema" });
      return;
    }
    topic = generated[0].topic;
  }

  const [inserted] = await db
    .insert(contentPlanItemsTable)
    .values({
      topic,
      scheduledAt: parsed.data.scheduled_at ? new Date(parsed.data.scheduled_at) : null,
      status: "draft",
    })
    .returning();

  res.status(201).json(CreateContentItemResponse.parse(mapItem(inserted)));
});

router.post("/content/:id/process", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = ProcessContentItemNowParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [item] = await db
    .select()
    .from(contentPlanItemsTable)
    .where(eq(contentPlanItemsTable.id, paramsParsed.data.id))
    .limit(1);

  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (item.status !== "draft" && item.status !== "scripted") {
    res.status(400).json({ error: `El video ya está en proceso (estado: ${item.status})` });
    return;
  }

  // Bring the item forward to now, then kick off the full pipeline
  await db
    .update(contentPlanItemsTable)
    .set({ scheduledAt: new Date(), updatedAt: new Date() })
    .where(eq(contentPlanItemsTable.id, item.id));

  const result = await runAutomationCycle(item.id);
  res.json(ProcessContentItemNowResponse.parse({ success: result.success, message: result.message }));
});

// Suggest a fresh AI topic for an existing content item (without generating the script).
// Returns a single {topic} string so the user can accept/retry/cancel inline.
router.post("/content/:id/suggest-topic", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(raw);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const [settings] = await db.select().from(settingsTable).limit(1);
  const niche    = settings?.niche ?? "marketing digital";
  const keywords = settings?.topicKeywords ?? [];
  const tone     = settings?.tone ?? "casual";
  const language = settings?.language ?? "es";

  // Avoid repeating any existing topic
  const existing = await db.select({ topic: contentPlanItemsTable.topic }).from(contentPlanItemsTable);
  const existingTopics = existing.map((i) => i.topic);

  const [generated] = await generateContentTopics(niche, keywords, tone, language, 1, 1, existingTopics);
  if (!generated?.topic) { res.status(500).json({ error: "No se pudo generar el tema" }); return; }

  res.json({ topic: generated.topic });
});

router.post("/content/script", async (req, res): Promise<void> => {
  const parsed = GenerateScriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [settings] = await db.select().from(settingsTable).limit(1);
  const niche = settings?.niche ?? "marketing digital";
  const tone = settings?.tone ?? "casual";
  const language = settings?.language ?? "es";
  const duration = parsed.data.duration_seconds ?? 60;

  const result = await generateScript(parsed.data.topic, niche, tone, language, duration);

  res.json(
    GenerateScriptResponse.parse({
      topic: result.topic,
      hook: result.hook,
      script: result.script,
      cta: result.cta,
      caption: result.caption,
      hashtags: result.hashtags,
      estimated_duration_seconds: result.estimated_duration_seconds,
    })
  );
});

router.get("/content/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const idParsed = GetContentItemParams.safeParse({ id: Number(raw) });
  if (!idParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [item] = await db
    .select()
    .from(contentPlanItemsTable)
    .where(eq(contentPlanItemsTable.id, idParsed.data.id))
    .limit(1);

  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(GetContentItemResponse.parse(mapItem(item)));
});

router.patch("/content/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = UpdateContentItemParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const bodyParsed = UpdateContentItemBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const updates: Partial<typeof contentPlanItemsTable.$inferInsert> = { updatedAt: new Date() };
  const b = bodyParsed.data;
  if (b.topic !== undefined) updates.topic = b.topic;
  if (b.hook !== undefined) updates.hook = b.hook ?? null;
  if (b.script !== undefined) updates.script = b.script ?? null;
  if (b.cta !== undefined) updates.cta = b.cta ?? null;
  if (b.avatar_id !== undefined) updates.avatarId = b.avatar_id ?? null;
  if (b.voice_id !== undefined) updates.voiceId = b.voice_id ?? null;
  if (b.caption !== undefined) updates.caption = b.caption ?? null;
  if (b.hashtags !== undefined) updates.hashtags = b.hashtags ?? null;
  if (b.scheduled_at !== undefined) updates.scheduledAt = b.scheduled_at ? new Date(b.scheduled_at) : null;

  // If script was added, move to scripted status
  if (b.script && b.script.length > 10) {
    const [existing] = await db.select().from(contentPlanItemsTable).where(eq(contentPlanItemsTable.id, paramsParsed.data.id)).limit(1);
    if (existing?.status === "draft") updates.status = "scripted";
  }

  const [updated] = await db
    .update(contentPlanItemsTable)
    .set(updates)
    .where(eq(contentPlanItemsTable.id, paramsParsed.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(UpdateContentItemResponse.parse(mapItem(updated)));
});

router.delete("/content/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const paramsParsed = DeleteContentItemParams.safeParse({ id: Number(raw) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.delete(contentPlanItemsTable).where(eq(contentPlanItemsTable.id, paramsParsed.data.id));
  res.json(DeleteContentItemResponse.parse({ success: true, message: "Deleted" }));
});

export default router;
