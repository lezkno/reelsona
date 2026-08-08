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
import { renderDiagnosticFrame, isBrowserEngineAvailable } from "../lib/browser-caption-engine";

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
    y_position: c.yPosition,
    margin_x: c.marginX,
    active_word_scale: c.activeWordScale,
    highlight_mode: c.highlightMode as "color" | "scale" | "both",
    auto_scale: c.autoScale,
    auto_movement: c.autoMovement,
    subtle_rotation: c.subtleRotation,
    caption_engine: (c.captionEngine ?? "standard") as "standard" | "browser_experimental",
    template_id: c.templateId ?? null,
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
    words_per_line: p.wordsPerLine ?? null,
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

  if (d.preset_id         !== undefined) updates.presetId         = d.preset_id;
  if (d.position          !== undefined) updates.position         = d.position;
  if (d.words_per_line    !== undefined) updates.wordsPerLine      = d.words_per_line;
  if (d.primary_color     !== undefined) updates.primaryColor      = d.primary_color;
  if (d.active_word_color !== undefined) updates.activeWordColor   = d.active_word_color;
  if (d.outline_color     !== undefined) updates.outlineColor      = d.outline_color;
  if (d.background_color  !== undefined) updates.backgroundColor   = d.background_color;
  if (d.font_family       !== undefined) updates.fontFamily        = d.font_family;
  if (d.font_size         !== undefined) updates.fontSize          = d.font_size;
  if (d.line_spacing_factor !== undefined) updates.lineSpacingFactor = d.line_spacing_factor;
  if (d.y_position        !== undefined) updates.yPosition         = d.y_position;
  if (d.margin_x          !== undefined) updates.marginX           = d.margin_x;
  if (d.active_word_scale !== undefined) updates.activeWordScale   = d.active_word_scale;
  if (d.highlight_mode    !== undefined) updates.highlightMode     = d.highlight_mode;
  if (d.auto_scale        !== undefined) updates.autoScale         = d.auto_scale;
  if (d.auto_movement     !== undefined) updates.autoMovement      = d.auto_movement;
  if (d.subtle_rotation   !== undefined) updates.subtleRotation    = d.subtle_rotation;
  // Browser Caption Engine fields
  if (d.caption_engine    !== undefined) updates.captionEngine     = d.caption_engine;
  if (d.template_id       !== undefined) updates.templateId        = d.template_id;

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

// ── Browser Engine diagnostic ─────────────────────────────────────────────────

/**
 * GET /api/captions/browser/preview-frame?templateId=<id>
 *
 * Returns a PNG sample frame for a browser template, rendered using @napi-rs/canvas.
 * Useful for verifying the canvas renderer works on this server before activating it.
 * If canvas is unavailable, returns 503 with a JSON error body.
 */
router.get("/captions/browser/preview-frame", async (req, res): Promise<void> => {
  const templateId = typeof req.query.templateId === "string" ? req.query.templateId : "";
  if (!templateId) {
    res.status(400).json({ error: "templateId query param is required" });
    return;
  }

  const result = await renderDiagnosticFrame(templateId);

  if (!result.ok) {
    res.status(503).json({
      error: result.reason,
      canvasAvailable: false,
    });
    return;
  }

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `inline; filename="preview-${templateId}.png"`);
  res.end(result.png);
});

/**
 * GET /api/captions/browser/status
 * Returns whether @napi-rs/canvas is available for rendering.
 */
router.get("/captions/browser/status", async (_req, res): Promise<void> => {
  const available = await isBrowserEngineAvailable();
  res.json({
    available,
    message: available
      ? "Browser caption engine (canvas) is available"
      : "Browser caption engine not available — standard ASS/FFmpeg engine will be used as fallback",
  });
});

export default router;
