import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const instagramAuditCacheTable = pgTable("instagram_audit_cache", {
  id: serial("id").primaryKey(),
  /** AI-recommended topics from last audit */
  recommendedTopics: text("recommended_topics").array().notNull().default([]),
  /** AI insights paragraph */
  contentInsights: text("content_insights"),
  /** JSON array of up to 5 full-length top-performing captions */
  topCaptionsJson: text("top_captions_json").notNull().default("[]"),
  /** Average engagement rate (%) across last 20 posts */
  avgEngagement: real("avg_engagement").notNull().default(0),
  /** AI-suggested best posting times */
  bestPostingTimes: text("best_posting_times").array().notNull().default([]),
  /** When this cache entry was fetched from the IG API */
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInstagramAuditCacheSchema = createInsertSchema(instagramAuditCacheTable).omit({ id: true });
export type InsertInstagramAuditCache = z.infer<typeof insertInstagramAuditCacheSchema>;
export type InstagramAuditCacheRow = typeof instagramAuditCacheTable.$inferSelect;
