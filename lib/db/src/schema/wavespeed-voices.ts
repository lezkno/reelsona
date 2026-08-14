import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { wavespeedPersonasTable } from "./wavespeed-personas";

/**
 * WaveSpeed cloned voice — created via minimax/voice-clone.
 *
 * Lifecycle:
 *   pending   → job submitted to WaveSpeed, polling for completion
 *   ready     → wavespeed_voice_id is available; usable in speech synthesis
 *   failed    → clone failed; error_message contains details
 *
 * wavespeed_request_id: the async job id returned at submission time
 * wavespeed_voice_id:   the resolved voice id once the clone is ready
 */
export const wavespeedVoicesTable = pgTable("wavespeed_voices", {
  id:                 serial("id").primaryKey(),
  userId:             integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  personaId:          integer("persona_id").references(() => wavespeedPersonasTable.id, { onDelete: "set null" }),
  displayName:        text("display_name").notNull(),
  wavespeedRequestId: text("wavespeed_request_id"),
  wavespeedVoiceId:   text("wavespeed_voice_id"),
  /** pending | ready | failed */
  status:             text("status").notNull().default("pending"),
  errorMessage:       text("error_message"),
  /** GCS object name of the source WAV uploaded for cloning — used to regenerate play URLs */
  sourceAudioObjectName: text("source_audio_object_name"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WavespeedVoice    = typeof wavespeedVoicesTable.$inferSelect;
export type NewWavespeedVoice = typeof wavespeedVoicesTable.$inferInsert;
