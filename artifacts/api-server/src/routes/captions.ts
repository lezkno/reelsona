import { Router } from "express";
import { db } from "@workspace/db";
import { captionConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetCaptionPresetsResponse,
  GetCaptionConfigResponse,
  UpdateCaptionConfigBody,
  UpdateCaptionConfigResponse,
} from "@workspace/api-zod";
import { CAPTION_PRESETS } from "../lib/caption-engine";

const router = Router();

function mapConfig(c: typeof captionConfigTable.$inferSelect) {
  return {
    preset_id: c.presetId,
    position: c.position as "top" | "center" | "bottom",
    words_per_line: c.wordsPerLine,
    primary_color: c.primaryColor,
    active_word_color: c.activeWordColor,
    outline_color: c.outlineColor,
    background_color: c.backgroundColor ?? null,
    font_family: c.fontFamily,
    font_size: c.fontSize,
    line_spacing_factor: c.lineSpacingFactor,
    active_word_scale: c.activeWordScale,
    highlight_mode: c.highlightMode as "color" | "scale" | "both",
    auto_scale: c.autoScale,
    auto_movement: c.autoMovement,
    subtle_rotation: c.subtleRotation,
    updated_at: c.updatedAt.toISOString(),
  };
}

router.get("/captions/presets", (_req, res): void => {
  const presets = CAPTION_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    primary_color: p.primaryColor,
    active_word_color: p.activeWordColor,
    outline_color: p.outlineColor,
    background_color: p.backgroundColor ?? null,
    font_family: p.fontFamily,
    font_size: p.fontSize,
    active_word_scale: p.activeWordScale,
    highlight_mode: p.highlightMode,
    auto_movement: p.autoMovement,
    subtle_rotation: p.subtleRotation,
  }));
  res.json(GetCaptionPresetsResponse.parse(presets));
});

router.get("/captions/config", async (_req, res): Promise<void> => {
  let [config] = await db.select().from(captionConfigTable).limit(1);
  if (!config) {
    [config] = await db.insert(captionConfigTable).values({}).returning();
  }
  res.json(GetCaptionConfigResponse.parse(mapConfig(config)));
});

router.put("/captions/config", async (req, res): Promise<void> => {
  const parsed = UpdateCaptionConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  const updates: Partial<typeof captionConfigTable.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (d.preset_id !== undefined) updates.presetId = d.preset_id;
  if (d.position !== undefined) updates.position = d.position;
  if (d.words_per_line !== undefined) updates.wordsPerLine = d.words_per_line;
  if (d.primary_color !== undefined) updates.primaryColor = d.primary_color;
  if (d.active_word_color !== undefined) updates.activeWordColor = d.active_word_color;
  if (d.outline_color !== undefined) updates.outlineColor = d.outline_color;
  if (d.background_color !== undefined) updates.backgroundColor = d.background_color;
  if (d.font_family !== undefined) updates.fontFamily = d.font_family;
  if (d.font_size !== undefined) updates.fontSize = d.font_size;
  if (d.line_spacing_factor !== undefined) updates.lineSpacingFactor = d.line_spacing_factor;
  if (d.active_word_scale !== undefined) updates.activeWordScale = d.active_word_scale;
  if (d.highlight_mode !== undefined) updates.highlightMode = d.highlight_mode;
  if (d.auto_scale !== undefined) updates.autoScale = d.auto_scale;
  if (d.auto_movement !== undefined) updates.autoMovement = d.auto_movement;
  if (d.subtle_rotation !== undefined) updates.subtleRotation = d.subtle_rotation;

  const [existing] = await db.select().from(captionConfigTable).limit(1);
  let config;
  if (existing) {
    [config] = await db
      .update(captionConfigTable)
      .set(updates)
      .where(eq(captionConfigTable.id, existing.id))
      .returning();
  } else {
    [config] = await db.insert(captionConfigTable).values(updates).returning();
  }

  res.json(UpdateCaptionConfigResponse.parse(mapConfig(config)));
});

export default router;
