import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/**
 * Instagram accounts the user watches as niche references/competitors.
 * source: 'manual' (user entered) | 'ai_suggested' | 'apify' (future)
 */
export const nicheRadarAccountsTable = pgTable("niche_radar_accounts", {
  id:             serial("id").primaryKey(),
  igUsername:     text("ig_username").notNull(),
  profileUrl:     text("profile_url"),
  bio:            text("bio"),
  followers:      integer("followers"),
  /** User relevance rating 1-10 */
  relevanceScore: integer("relevance_score").default(5),
  /** Whether to use this account as context for content generation */
  useAsReference: boolean("use_as_reference").notNull().default(true),
  /** 'manual' | 'ai_suggested' | 'apify' */
  source:         text("source").notNull().default("manual"),
  lastSyncedAt:   timestamp("last_synced_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export type NicheRadarAccount       = typeof nicheRadarAccountsTable.$inferSelect;
export type InsertNicheRadarAccount = typeof nicheRadarAccountsTable.$inferInsert;
export const insertNicheRadarAccountSchema = createInsertSchema(nicheRadarAccountsTable);
export const selectNicheRadarAccountSchema = createSelectSchema(nicheRadarAccountsTable);
