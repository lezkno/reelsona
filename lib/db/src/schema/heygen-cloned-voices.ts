import { pgTable, serial, integer, text, timestamp, real } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Tracks HeyGen cloned voices created by each user.
 * The app uses a shared platform HeyGen API key, so ownership must be enforced
 * here — without this table any user could delete another user's cloned voice.
 */
export const heygenClonedVoicesTable = pgTable("heygen_cloned_voices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** The voice_id returned by HeyGen after cloning */
  voiceId: text("voice_id").notNull().unique(),
  /** Display name shown in the UI */
  displayName: text("display_name").notNull(),
  /** pending | ready | failed */
  status: text("status").notNull().default("pending"),
  /** Voice speed multiplier sent to HeyGen at generation time. null = HeyGen default (1.0). Range: 0.5–1.5 */
  speed: real("speed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type HeygenClonedVoiceRow = typeof heygenClonedVoicesTable.$inferSelect;
