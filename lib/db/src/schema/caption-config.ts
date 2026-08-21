import { pgTable, serial, text, integer, boolean, real, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

export interface SavedCardTemplate {
  type: "hook" | "stat" | "cta";
  useAi: boolean;
  text?: string;
  headline?: string;
  subtext?: string;
}

export interface CardSlotConfig {
  enabled: boolean;
  useAi: boolean;
  text?: string;
  headline?: string;
  subtext?: string;
  templateId?: string;
  yPosition?: number;
  fontScale?: number;
  timingPercent?: number;
  durationSec?: number;
}

export interface MultiCardConfig {
  version: 2;
  hook: CardSlotConfig;
  stat: CardSlotConfig;
  cta: CardSlotConfig;
}

export const captionConfigTable = pgTable("caption_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id),
  presetId: text("preset_id").notNull().default("viral"),
  position: text("position").notNull().default("bottom"),
  wordsPerLine: integer("words_per_line").notNull().default(3),
  primaryColor: text("primary_color").notNull().default("#FFFFFF"),
  activeWordColor: text("active_word_color").notNull().default("#FFE600"),
  outlineColor: text("outline_color").notNull().default("#000000"),
  backgroundColor: text("background_color"),
  fontFamily: text("font_family").notNull().default("Oswald"),
  fontSize: integer("font_size").notNull().default(88),
  activeWordScale: real("active_word_scale").notNull().default(1.2),
  highlightMode: text("highlight_mode").notNull().default("color"),
  autoScale: boolean("auto_scale").notNull().default(true),
  lineSpacingFactor: real("line_spacing_factor").notNull().default(1.1),
  yPosition: real("y_position").notNull().default(75),
  /** Horizontal center of the caption block (% of the 1080px reference canvas). */
  xPosition: real("x_position").notNull().default(50),
  marginX: real("margin_x").notNull().default(60),
  /** Canonical caption block width, expressed as % of a 1080px reference canvas. */
  maxWidthPercent: real("max_width_percent").notNull().default(88.9),
  /** A selected template may seed the layout until the user changes any layout control. */
  layoutCustomized: boolean("layout_customized").notNull().default(false),
  autoMovement: boolean("auto_movement").notNull().default(false),
  subtleRotation: boolean("subtle_rotation").notNull().default(false),
  captionEngine: text("caption_engine").notNull().default("standard"),
  templateId: text("template_id"),
  templateOverrides: text("template_overrides"),
  selectedPresetIds: text("selected_preset_ids").array().notNull().default([]),
  captionRotationStrategy: text("caption_rotation_strategy").notNull().default("sequential"),
  lastUsedPresetId: text("last_used_preset_id"),
  presetUsageCount: json("preset_usage_count").$type<Record<string, number>>().notNull().default({}),
  cardTemplate: json("card_template").$type<MultiCardConfig | SavedCardTemplate | null>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCaptionConfigSchema = createInsertSchema(captionConfigTable).omit({ id: true });
export type InsertCaptionConfig = z.infer<typeof insertCaptionConfigSchema>;
export type CaptionConfigRow = typeof captionConfigTable.$inferSelect;
