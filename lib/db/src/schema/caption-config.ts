import { pgTable, serial, text, integer, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const captionConfigTable = pgTable("caption_config", {
  id: serial("id").primaryKey(),
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
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCaptionConfigSchema = createInsertSchema(captionConfigTable).omit({ id: true });
export type InsertCaptionConfig = z.infer<typeof insertCaptionConfigSchema>;
export type CaptionConfigRow = typeof captionConfigTable.$inferSelect;
