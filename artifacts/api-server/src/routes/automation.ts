import { Router } from "express";
import { db } from "@workspace/db";
import { automationConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetAutomationResponse,
  UpdateAutomationBody,
  UpdateAutomationResponse,
  TriggerAutomationResponse,
} from "@workspace/api-zod";
import { runAutomationCycle } from "../lib/scheduler";

const router = Router();

function mapConfig(c: typeof automationConfigTable.$inferSelect) {
  return {
    enabled: c.enabled,
    posting_times: c.postingTimes ?? ["09:00", "18:00"],
    days_of_week: c.daysOfWeek ?? [1, 2, 3, 4, 5],
    timezone: c.timezone ?? "America/Buenos_Aires",
    auto_generate_script: c.autoGenerateScript,
    auto_generate_video: c.autoGenerateVideo,
    auto_publish: c.autoPublish,
    last_run_at: c.lastRunAt?.toISOString() ?? null,
    next_run_at: c.nextRunAt?.toISOString() ?? null,
    last_run_status: c.lastRunStatus ?? null,
  };
}

router.get("/automation", async (req, res): Promise<void> => {
  let [config] = await db.select().from(automationConfigTable).limit(1);
  if (!config) {
    [config] = await db.insert(automationConfigTable).values({}).returning();
  }
  res.json(GetAutomationResponse.parse(mapConfig(config)));
});

router.put("/automation", async (req, res): Promise<void> => {
  const parsed = UpdateAutomationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(automationConfigTable).limit(1);
  const updates: Partial<typeof automationConfigTable.$inferInsert> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.enabled !== undefined) updates.enabled = d.enabled;
  if (d.posting_times !== undefined) updates.postingTimes = d.posting_times;
  if (d.days_of_week !== undefined) updates.daysOfWeek = d.days_of_week;
  if (d.timezone !== undefined) updates.timezone = d.timezone;
  if (d.auto_generate_script !== undefined) updates.autoGenerateScript = d.auto_generate_script;
  if (d.auto_generate_video !== undefined) updates.autoGenerateVideo = d.auto_generate_video;
  if (d.auto_publish !== undefined) updates.autoPublish = d.auto_publish;

  let config;
  if (existing) {
    [config] = await db.update(automationConfigTable).set(updates).where(eq(automationConfigTable.id, existing.id)).returning();
  } else {
    [config] = await db.insert(automationConfigTable).values(updates).returning();
  }

  res.json(UpdateAutomationResponse.parse(mapConfig(config)));
});

router.post("/automation/trigger", async (req, res): Promise<void> => {
  req.log.info("Manual automation trigger requested");
  const result = await runAutomationCycle();
  res.status(202).json(
    TriggerAutomationResponse.parse({
      triggered: result.success,
      message: result.message,
      content_item_id: result.contentItemId ?? null,
      video_id: result.videoId ?? null,
    })
  );
});

export default router;
