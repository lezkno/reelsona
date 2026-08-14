import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { wavespeedPersonasTable } from "./wavespeed-personas";

/**
 * WaveSpeed look — a reference image / style variant tied to a persona.
 * Used as the `image_url` input for wavespeed-ai/infinitetalk-fast and
 * bytedance/seedream-v5.0-pro/edit generations.
 *
 * config: optional JSON blob for extra model-specific parameters
 *         (e.g. background removal flag, crop hints, aspect ratio).
 */
export const wavespeedLooksTable = pgTable("wavespeed_looks", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId: integer("persona_id").references(() => wavespeedPersonasTable.id, { onDelete: "set null" }),
  name:      text("name").notNull(),
  imageUrl:  text("image_url"),
  /** JSON blob — extra model params. Parsed by callers; no schema enforced here. */
  config:    text("config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WavespeedLook    = typeof wavespeedLooksTable.$inferSelect;
export type NewWavespeedLook = typeof wavespeedLooksTable.$inferInsert;
