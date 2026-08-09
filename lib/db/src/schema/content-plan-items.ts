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
  /** null = not yet started, 'generating' = AI running, 'done' = saved, 'failed' = error */
  copyStatus: text("copy_status"),
  // ── Viral Editorial Engine fields ────────────────────────────────────────────
  /** 0–100 viral potential score computed after AI generation */
  viralScore: integer("viral_score"),
  /** Format letter A–J from the topic categories rotation */
  editorialAngle: text("editorial_angle"),
  /** JSON array of 3 hook candidate strings considered during script generation */
  hookCandidates: text("hook_candidates"),
  /** Why the winning hook was selected over the alternatives */
  hookSelectionReason: text("hook_selection_reason"),
  /** Why a viewer would share this content */
  shareReason: text("share_reason"),
  /** The specific audience pain/desire this topic targets */
  audiencePain: text("audience_pain"),
  /** low | medium | high — novelty level of the topic */
  noveltyLevel: text("novelty_level"),
  // ─────────────────────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertContentPlanItemSchema = createInsertSchema(contentPlanItemsTable).omit({ id: true });
export type InsertContentPlanItem = z.infer<typeof insertContentPlanItemSchema>;
export type ContentPlanItemRow = typeof contentPlanItemsTable.$inferSelect;
