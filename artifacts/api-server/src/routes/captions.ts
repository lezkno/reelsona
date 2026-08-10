import { Router } from "express";
import { db } from "@workspace/db";
import { captionConfigTable, videosTable, contentPlanItemsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getVideoStatus } from "../lib/heygen";
import {
  GetCaptionPresetsResponse,
  GetCaptionConfigResponse,
  UpdateCaptionConfigBody,
  UpdateCaptionConfigResponse,
} from "@workspace/api-zod";
import { CAPTION_PRESETS } from "../lib/caption-engine";
import { renderDiagnosticFrame, isBrowserEngineAvailable, applyCaptionsBrowser, BROWSER_CAPTION_TEMPLATES } from "../lib/browser-caption-engine";

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
    template_overrides: c.templateOverrides ?? null,
    selected_preset_ids: c.selectedPresetIds ?? [],
    caption_rotation_strategy: c.captionRotationStrategy ?? "sequential",
    last_used_preset_id: c.lastUsedPresetId ?? null,
    preset_usage_count: (c.presetUsageCount ?? {}) as Record<string, number>,
    updated_at: c.updatedAt.toISOString(),
  };
}

/** List all browser (Caption Studio) templates — used for rotation selector UI */
router.get("/captions/browser-templates", (_req, res): void => {
  const templates = BROWSER_CAPTION_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    primary_color: t.primaryColor,
    active_word_color: t.activeWordColor,
    background_color: t.backgroundColor ?? null,
    animation: t.animation,
    font_family: t.fontFamily,
  }));
  res.json(templates);
});

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
  if (d.caption_engine       !== undefined) updates.captionEngine      = d.caption_engine;
  if (d.template_id          !== undefined) updates.templateId         = d.template_id;
  if (d.template_overrides   !== undefined) updates.templateOverrides  = d.template_overrides ?? null;
  // Caption preset rotation
  if (d.selected_preset_ids        !== undefined) updates.selectedPresetIds       = d.selected_preset_ids;
  if (d.caption_rotation_strategy  !== undefined) updates.captionRotationStrategy  = d.caption_rotation_strategy;
  if (d.last_used_preset_id        !== undefined) updates.lastUsedPresetId        = d.last_used_preset_id ?? null;
  if (d.preset_usage_count         !== undefined) updates.presetUsageCount        = d.preset_usage_count;

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

  // Optional ?words=WORD1,WORD2 for overflow/custom tests
  const wordsParam = typeof req.query.words === "string" ? req.query.words : undefined;
  const testWords  = wordsParam ? wordsParam.split(",").map(w => w.trim()).filter(Boolean) : undefined;

  const result = await renderDiagnosticFrame(templateId, testWords);

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
 * POST /api/videos/:id/recaption
 * Re-render captions on an existing video using a specific browser template.
 * Used for testing new templates without going through the full automation cycle.
 */
router.post("/videos/:id/recaption", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { template_id } = req.body ?? {};
  if (!template_id) { res.status(400).json({ error: "template_id required" }); return; }

  const [video] = await db
    .select()
    .from(videosTable)
    .where(eq(videosTable.id, id))
    .limit(1);

  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  if (!video.videoUrl) { res.status(400).json({ error: "Video has no videoUrl" }); return; }

  // ── 1. Fetch script from linked content plan item ──────────────────────────
  let script: string | null = null;
  if (video.contentPlanId) {
    const [item] = await db
      .select({ script: contentPlanItemsTable.script })
      .from(contentPlanItemsTable)
      .where(eq(contentPlanItemsTable.id, video.contentPlanId))
      .limit(1);
    script = item?.script ?? null;
  }

  // ── 2. Fetch subtitle_url live from HeyGen ─────────────────────────────────
  // subtitle_url is not persisted in the DB — fetch it fresh from HeyGen API.
  let subtitleUrl: string | null = null;
  if (video.heygenVideoId) {
    try {
      const [settings] = await db.select().from(settingsTable)
        .where(eq(settingsTable.userId, req.session.user!.userId))
        .limit(1);
      const apiKey = (settings as any)?.heygenApiKey ?? "";
      const status = await getVideoStatus(video.heygenVideoId, apiKey || undefined);
      if (status.subtitle_url) subtitleUrl = status.subtitle_url;
    } catch { /* ignore — will fall back to proportional timings */ }
  }

  const hasSRT = !!subtitleUrl;
  res.json({
    message: hasSRT
      ? "Rendering con SRT de HeyGen — sincronía exacta con la voz…"
      : "Rendering con timings proporcionales (sin SRT disponible)…",
    videoId: id,
    templateId: template_id,
    hasSRT,
  });

  // Fire-and-forget: render captions and save URL
  applyCaptionsBrowser(video.videoUrl, script, template_id, {
    subtitleUrl:          subtitleUrl ?? undefined,
    videoDurationSeconds: video.durationSeconds ?? undefined,
  }).then(async (result) => {
    if (result.url) {
      await db
        .update(videosTable)
        .set({ captionedVideoUrl: result.url, captionStatus: "done", updatedAt: new Date() })
        .where(eq(videosTable.id, id));
    }
  }).catch(() => { /* logged inside applyCaptionsBrowser */ });
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
