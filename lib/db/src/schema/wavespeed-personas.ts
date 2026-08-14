import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * WaveSpeed AI persona — the top-level identity for a user's AI avatar.
 * Analogous to a HeyGen avatar group but lives entirely in our DB.
 * One persona can have multiple looks and a cloned voice.
 */
export const wavespeedPersonasTable = pgTable("wavespeed_personas", {
  id:                   serial("id").primaryKey(),
  userId:               integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name:                 text("name").notNull(),
  description:          text("description"),
  thumbnailUrl:         text("thumbnail_url"),
  /** GCS object path of the reference photo used to generate looks (e.g. /objects/…) */
  referenceObjectPath:  text("reference_object_path"),
  /** Last WaveSpeed look used to generate a video — drives sequential look rotation.
   *  FK to wavespeed_looks.id exists in the DB; omitted here to avoid a circular import. */
  lastUsedLookId:       integer("last_used_look_id"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WavespeedPersona    = typeof wavespeedPersonasTable.$inferSelect;
export type NewWavespeedPersona = typeof wavespeedPersonasTable.$inferInsert;
