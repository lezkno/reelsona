import { pgTable, serial, text, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const avatarConfigTable = pgTable("avatar_config", {
  id: serial("id").primaryKey(),
  selectedAvatarIds: text("selected_avatar_ids").array().notNull().default([]),
  preferredVoiceId: text("preferred_voice_id"),
  rotationStrategy: text("rotation_strategy").notNull().default("sequential"),
  lastUsedAvatarId: text("last_used_avatar_id"),
  avatarUsageCount: json("avatar_usage_count").$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAvatarConfigSchema = createInsertSchema(avatarConfigTable).omit({ id: true });
export type InsertAvatarConfig = z.infer<typeof insertAvatarConfigSchema>;
export type AvatarConfigRow = typeof avatarConfigTable.$inferSelect;
