import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  contentPlanId: integer("content_plan_id"),
  heygenVideoId: text("heygen_video_id"),
  topic: text("topic"),
  avatarId: text("avatar_id"),
  status: text("status").notNull().default("pending"),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  igMediaId: text("ig_media_id"),
  igPermalink: text("ig_permalink"),
  errorMessage: text("error_message"),
  durationSeconds: integer("duration_seconds"),
  publishedAt: timestamp("published_at"),
  captionedVideoUrl: text("captioned_video_url"),
  captionStatus: text("caption_status").default("disabled"), // disabled | processing | done | failed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type VideoRow = typeof videosTable.$inferSelect;
