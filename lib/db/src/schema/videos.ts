import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
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
  scheduledPublishAt: timestamp("scheduled_publish_at"),
  captionedVideoUrl: text("captioned_video_url"),
  captionStatus: text("caption_status").default("disabled"), // disabled | processing | done | failed
  // Production safety fields
  pollAttempts: integer("poll_attempts").default(0).notNull(),
  generatingStartedAt: timestamp("generating_started_at"),
  igContainerId: text("ig_container_id"),
  /** Immutable snapshot of VideoEffects at the moment the job was created */
  videoEffects: jsonb("video_effects"),
  /** HeyGen SRT subtitle URL — only available at completion time; persisted so captions can be re-applied with real word timings */
  heygenSubtitleUrl: text("heygen_subtitle_url"),
  /** AI-generated Reel cover image (gpt-image-1, brand colors + hook). Saved at publish time, reused on retry. */
  thumbnailCoverUrl: text("thumbnail_cover_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type VideoRow = typeof videosTable.$inferSelect;
