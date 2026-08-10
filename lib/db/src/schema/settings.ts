import { pgTable, serial, text, integer, boolean, real, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  niche: text("niche").notNull().default(""),
  nicheDescription: text("niche_description"),
  topicKeywords: text("topic_keywords").array().notNull().default([]),
  tone: text("tone").notNull().default("casual"),
  language: text("language").notNull().default("es"),
  videoDurationSeconds: integer("video_duration_seconds").notNull().default(60),
  includeCaptions: boolean("include_captions").notNull().default(true),
  watermarkText: text("watermark_text"),
  heygenApiKey: text("heygen_api_key"),
  /** Voice speed multiplier for HeyGen TTS. null = HeyGen default (1.0). Range: 0.5–1.5 */
  heygenVoiceSpeed: real("heygen_voice_speed"),
  /** Whether the user has dismissed the welcome modal (stored server-side so it persists across devices) */
  welcomeDismissed: boolean("welcome_dismissed").notNull().default(false),
  /** Account-level video effects defaults applied to every new video */
  videoEffects: jsonb("video_effects").notNull().default({ zoom: false, ai_broll: false, text_cards: false }),
  /** Object storage path of the brand logo uploaded by the user */
  brandLogoUrl: text("brand_logo_url"),
  /** Primary brand color (hex, e.g. #1A2B3C) chosen by the user */
  brandPrimaryColor: text("brand_primary_color"),
  /** Accent brand color (hex) chosen by the user */
  brandAccentColor: text("brand_accent_color"),
  /** Full extracted palette from the logo (array of hex strings) */
  brandPaletteColors: text("brand_palette_colors").array(),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type SettingsRow = typeof settingsTable.$inferSelect;
