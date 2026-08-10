import { pgTable, serial, boolean, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

export const automationConfigTable = pgTable("automation_config", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  enabled: boolean("enabled").notNull().default(false),
  postingTimes: text("posting_times").array().notNull().default(["09:00", "18:00"]),
  daysOfWeek: integer("days_of_week").array().notNull().default([1, 2, 3, 4, 5]),
  timezone: text("timezone").notNull().default("America/Buenos_Aires"),
  autoGenerateScript: boolean("auto_generate_script").notNull().default(true),
  autoGenerateVideo: boolean("auto_generate_video").notNull().default(true),
  autoPublish: boolean("auto_publish").notNull().default(true),
  captionsEnabled: boolean("captions_enabled").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastRunStatus: text("last_run_status"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAutomationConfigSchema = createInsertSchema(automationConfigTable).omit({ id: true });
export type InsertAutomationConfig = z.infer<typeof insertAutomationConfigSchema>;
export type AutomationConfigRow = typeof automationConfigTable.$inferSelect;
