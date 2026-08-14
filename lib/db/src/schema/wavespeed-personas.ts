import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * WaveSpeed AI persona — the top-level identity for a user's AI avatar.
 * Analogous to a HeyGen avatar group but lives entirely in our DB.
 * One persona can have multiple looks and a cloned voice.
 */
export const wavespeedPersonasTable = pgTable("wavespeed_personas", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  description:  text("description"),
  thumbnailUrl: text("thumbnail_url"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WavespeedPersona    = typeof wavespeedPersonasTable.$inferSelect;
export type NewWavespeedPersona = typeof wavespeedPersonasTable.$inferInsert;
