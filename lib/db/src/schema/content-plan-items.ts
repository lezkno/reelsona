import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contentPlanItemsTable = pgTable("content_plan_items", {
  id: serial("id").primaryKey(),
  topic: text("topic").notNull(),
  hook: text("hook"),
  script: text("script"),
  cta: text("cta"),
  avatarId: text("avatar_id"),
  voiceId: text("voice_id"),
  caption: text("caption"),
  hashtags: text("hashtags"),
  scheduledAt: timestamp("scheduled_at"),
  status: text("status").notNull().default("draft"),
  videoId: integer("video_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertContentPlanItemSchema = createInsertSchema(contentPlanItemsTable).omit({ id: true });
export type InsertContentPlanItem = z.infer<typeof insertContentPlanItemSchema>;
export type ContentPlanItemRow = typeof contentPlanItemsTable.$inferSelect;
