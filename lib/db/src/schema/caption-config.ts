import { pgTable, serial, text, integer, boolean, real, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

export interface SavedCardTemplate {
  type: "hook" | "stat" | "cta";
  /** When true, AI generates the card text using the script; when false, uses fixed text fields below. */
  useAi: boolean;
  /** Text for hook or cta cards (useAi: false) */
  text?: string;
  /** Headline for stat cards (useAi: false), e.g. "2.3M" */
  headline?: string;
  /** Subtext for stat cards (useAi: false), e.g. "usuarios activos" */
  subtext?: string;
}

export const captionConfigTable = pgTable("caption_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  presetId: text("preset_id").notNull().default("viral"),
  position: text("position").notNull().default("bottom"), // top | center | bottom
  wordsPerLine: integer("words_per_line").notNull().default(3),
  primaryColor: text("primary_color").notNull().default("#FFFFFF"),
  activeWordColor: text("active_word_color").notNull().default("#FFE600"),
  outlineColor: text("outline_color").notNull().default("#000000"),
  backgroundColor: text("background_color"), // null = no bg
  fontFamily: text("font_family").notNull().default("Oswald"),
  fontSize: integer("font_size").notNull().default(88),
  activeWordScale: real("active_word_scale").notNull().default(1.2),
  highlightMode: text("highlight_mode").notNull().default("color"), // color | scale | both
  autoScale: boolean("auto_scale").notNull().default(true),
  lineSpacingFactor: real("line_spacing_factor").notNull().default(1.1),
  yPosition: real("y_position").notNull().default(75),
  marginX: real("margin_x").notNull().default(60),
  autoMovement: boolean("auto_movement").notNull().default(false),
  subtleRotation: boolean("subtle_rotation").notNull().default(false),
  // Browser Caption Engine feature flag
  captionEngine: text("caption_engine").notNull().default("standard"), // "standard" | "browser_experimental"
  templateId: text("template_id"),                                     // null when captionEngine = "standard"
  templateOverrides: text("template_overrides"),                       // JSON: Partial<CaptionTemplate> — per-template user tweaks
  // Caption preset rotation (mirrors avatar rotation pattern)
  selectedPresetIds: text("selected_preset_ids").array().notNull().default([]),
  captionRotationStrategy: text("caption_rotation_strategy").notNull().default("sequential"),
  lastUsedPresetId: text("last_used_preset_id"),
  presetUsageCount: json("preset_usage_count").$type<Record<string, number>>().notNull().default({}),
  cardTemplate: json("card_template").$type<SavedCardTemplate | null>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCaptionConfigSchema = createInsertSchema(captionConfigTable).omit({ id: true });
export type InsertCaptionConfig = z.infer<typeof insertCaptionConfigSchema>;
export type CaptionConfigRow = typeof captionConfigTable.$inferSelect;
