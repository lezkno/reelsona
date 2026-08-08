import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetSettingsResponse, UpdateSettingsBody, UpdateSettingsResponse } from "@workspace/api-zod";

const router = Router();

function mapSettings(s: typeof settingsTable.$inferSelect) {
  return {
    niche: s.niche ?? "",
    niche_description: s.nicheDescription ?? null,
    topic_keywords: s.topicKeywords ?? [],
    tone: s.tone ?? "casual",
    language: s.language ?? "es",
    video_duration_seconds: s.videoDurationSeconds ?? 60,
    include_captions: s.includeCaptions ?? true,
    watermark_text: s.watermarkText ?? null,
  };
}

router.get("/settings", async (req, res): Promise<void> => {
  const userId = req.session.user!.userId;
  let [settings] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
  if (!settings) {
    [settings] = await db.insert(settingsTable).values({ niche: "", userId }).returning();
  }
  res.json(GetSettingsResponse.parse(mapSettings(settings)));
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.session.user!.userId;
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
  const updates: Partial<typeof settingsTable.$inferInsert> = {};
  const d = parsed.data;
  if (d.niche !== undefined) updates.niche = d.niche;
  if (d.niche_description !== undefined) updates.nicheDescription = d.niche_description ?? null;
  if (d.topic_keywords !== undefined) updates.topicKeywords = d.topic_keywords;
  if (d.tone !== undefined) updates.tone = d.tone;
  if (d.language !== undefined) updates.language = d.language;
  if (d.video_duration_seconds !== undefined) updates.videoDurationSeconds = d.video_duration_seconds;
  if (d.include_captions !== undefined) updates.includeCaptions = d.include_captions;
  if (d.watermark_text !== undefined) updates.watermarkText = d.watermark_text ?? null;

  let settings;
  if (existing) {
    [settings] = await db.update(settingsTable).set(updates).where(eq(settingsTable.id, existing.id)).returning();
  } else {
    [settings] = await db.insert(settingsTable).values({ ...updates, userId }).returning();
  }

  res.json(UpdateSettingsResponse.parse(mapSettings(settings)));
});

export default router;
