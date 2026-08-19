import { pgTable, serial, text, integer, boolean, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  niche: text("niche").notNull().default(""),
  nicheDescription: text("niche_description"),
  topicKeywords: text("topic_keywords").array().notNull().default([]),
  tone: text("tone").notNull().default("casual"),
  language: text("language").notNull().default("es"),
  videoDurationSeconds: integer("video_duration_seconds").notNull().default(60),
  includeCaptions: boolean("include_captions").notNull().default(true),
  watermarkText: text("watermark_text"),
  /** Legacy BYOK field. No new product flow should write this. */
  heygenApiKey: text("heygen_api_key"),
  heygenVoiceSpeed: real("heygen_voice_speed"),
  welcomeDismissed: boolean("welcome_dismissed").notNull().default(false),
  videoEffects: jsonb("video_effects").notNull().default({ zoom: false, ai_broll: false, text_cards: false }),
  brandLogoUrl: text("brand_logo_url"),
  brandPrimaryColor: text("brand_primary_color"),
  brandAccentColor: text("brand_accent_color"),
  brandPaletteColors: text("brand_palette_colors").array(),
  /** Legacy BYOK field. No new product flow should write this. */
  openaiApiKey: text("openai_api_key"),
  offer: text("offer"),
  idealAudience: text("ideal_audience"),
  uniqueValueProp: text("unique_value_prop"),
  voiceStyle: text("voice_style"),
  commonObjections: text("common_objections"),
  customCta: text("custom_cta"),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type SettingsRow = typeof settingsTable.$inferSelect;
