import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { videosTable } from "./videos";

/**
 * Generic WaveSpeed async inference job.
 * Tracks any model invocation — talking-head video, speech synthesis,
 * image edit, or voice clone — so the scheduler can poll and recover.
 *
 * model values (current):
 *   wavespeed-ai/infinitetalk-fast        — talking-head video
 *   minimax/speech-2.6-turbo              — text-to-speech
 *   minimax/voice-clone                   — voice cloning
 *   bytedance/seedream-v5.0-pro/edit      — image editing
 *
 * status lifecycle:  queued → processing → completed | failed
 *
 * input_payload / output_payload: JSON strings — exact shape varies by model.
 */
export const wavespeedJobsTable = pgTable("wavespeed_jobs", {
  id:                 serial("id").primaryKey(),
  userId:             integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Full model identifier as passed to the WaveSpeed API. */
  model:              text("model").notNull(),
  /** queued | processing | completed | failed */
  status:             text("status").notNull().default("queued"),
  /** Async request id returned by WaveSpeed at submission. */
  wavespeedRequestId: text("wavespeed_request_id"),
  /** JSON — inputs sent to WaveSpeed (audio_url, image_url, text, etc.). */
  inputPayload:       text("input_payload"),
  /** Primary output asset URL (video, audio, or image). */
  outputUrl:          text("output_url"),
  /** JSON — full outputs object returned by WaveSpeed. */
  outputPayload:      text("output_payload"),
  errorMessage:       text("error_message"),
  /** Optional link back to the video this job produced or contributed to. */
  relatedVideoId:     integer("related_video_id").references(() => videosTable.id, { onDelete: "set null" }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WavespeedJob    = typeof wavespeedJobsTable.$inferSelect;
export type NewWavespeedJob = typeof wavespeedJobsTable.$inferInsert;
