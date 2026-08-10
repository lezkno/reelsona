import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetSettingsResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
  ExtractBrandPaletteBody,
  ExtractBrandPaletteResponse,
} from "@workspace/api-zod";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router = Router();
const storageService = new ObjectStorageService();

const DEFAULT_VIDEO_EFFECTS = { zoom: false, ai_broll: false, text_cards: false };

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
    heygen_voice_speed: s.heygenVoiceSpeed ?? null,
    welcome_dismissed: s.welcomeDismissed ?? false,
    video_effects: (s.videoEffects as typeof DEFAULT_VIDEO_EFFECTS | null) ?? DEFAULT_VIDEO_EFFECTS,
    brand_logo_url: s.brandLogoUrl ?? null,
    brand_primary_color: s.brandPrimaryColor ?? null,
    brand_accent_color: s.brandAccentColor ?? null,
    brand_palette: s.brandPaletteColors ?? null,
  };
}

// ── Color extraction helpers ───────────────────────────────────────────────────

function hexDistance(hex1: string, hex2: string): number {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

async function extractDominantColors(buffer: Buffer): Promise<string[]> {
  const img = await loadImage(buffer);
  const SAMPLE = 80;
  const canvas = createCanvas(SAMPLE, SAMPLE);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
  const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);

  const colorMap = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 100) continue; // skip mostly-transparent pixels (logo transparency)

    // Quantize to reduce noise (nearest 24)
    const rq = Math.round(r / 24) * 24;
    const gq = Math.round(g / 24) * 24;
    const bq = Math.round(b / 24) * 24;

    // Skip near-white and near-black (commonly backgrounds, not brand colors)
    const brightness = (rq + gq + bq) / 3;
    if (brightness > 230 || brightness < 25) continue;

    const key = `${rq},${gq},${bq}`;
    colorMap.set(key, (colorMap.get(key) ?? 0) + 1);
  }

  // Sort by frequency, then keep only perceptually distinct colors
  const sorted = [...colorMap.entries()].sort((a, b) => b[1] - a[1]);
  const palette: string[] = [];
  for (const [key] of sorted) {
    if (palette.length >= 5) break;
    const [r, g, b] = key.split(",").map(Number);
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    if (!palette.some((c) => hexDistance(c, hex) < 55)) {
      palette.push(hex);
    }
  }
  return palette;
}

// ── Routes ────────────────────────────────────────────────────────────────────

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
  if (d.heygen_voice_speed !== undefined) updates.heygenVoiceSpeed = d.heygen_voice_speed ?? null;
  if (d.welcome_dismissed !== undefined) updates.welcomeDismissed = d.welcome_dismissed;
  if (d.video_effects !== undefined) updates.videoEffects = d.video_effects;
  if (d.brand_logo_url !== undefined) updates.brandLogoUrl = d.brand_logo_url ?? null;
  if (d.brand_primary_color !== undefined) updates.brandPrimaryColor = d.brand_primary_color ?? null;
  if (d.brand_accent_color !== undefined) updates.brandAccentColor = d.brand_accent_color ?? null;
  if (d.brand_palette !== undefined) updates.brandPaletteColors = d.brand_palette ?? null;

  let settings;
  if (existing) {
    [settings] = await db.update(settingsTable).set(updates).where(eq(settingsTable.id, existing.id)).returning();
  } else {
    [settings] = await db.insert(settingsTable).values({ ...updates, userId }).returning();
  }

  res.json(UpdateSettingsResponse.parse(mapSettings(settings)));
});

/** POST /settings/brand-logo — extract palette from an already-uploaded logo */
router.post("/settings/brand-logo", async (req, res): Promise<void> => {
  const parsed = ExtractBrandPaletteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { object_path } = parsed.data;
  const userId = req.session.user!.userId;

  try {
    // Download the uploaded image from object storage
    const gcsFile = await storageService.getObjectEntityFile(object_path);
    const [buffer] = await gcsFile.download();

    // Extract dominant brand colors
    const palette = await extractDominantColors(buffer as Buffer);

    // Persist the logo URL in settings so it shows on reload
    const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.userId, userId)).limit(1);
    if (existing) {
      await db.update(settingsTable)
        .set({ brandLogoUrl: object_path, brandPaletteColors: palette })
        .where(eq(settingsTable.id, existing.id));
    } else {
      await db.insert(settingsTable).values({ niche: "", userId, brandLogoUrl: object_path, brandPaletteColors: palette });
    }

    res.json(ExtractBrandPaletteResponse.parse({ palette, logo_url: object_path }));
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(400).json({ error: "Logo file not found in storage. Make sure the upload completed successfully." });
      return;
    }
    console.error("[brand-logo] palette extraction error:", err);
    res.status(500).json({ error: "Failed to extract palette from logo." });
  }
});

export default router;
