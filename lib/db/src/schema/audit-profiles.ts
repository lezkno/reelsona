import { pgTable, serial, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/**
 * Persistent strategic profile — single row, upserted as the user completes
 * each Audit step (Cuenta → Radar → Mercado → Estrategia).
 */
export const auditProfilesTable = pgTable("audit_profiles", {
  id:              serial("id").primaryKey(),
  /** AccountData JSON — filled by the "Cuenta" step */
  accountData:     jsonb("account_data"),
  /** MarketInsights JSON — filled by the "Mercado" step */
  marketInsights:  jsonb("market_insights"),
  /** ContentStrategy JSON — filled by the "Estrategia" step */
  contentStrategy: jsonb("content_strategy"),
  /** Which steps the user has completed: ['account','radar','market','strategy'] */
  stepsCompleted:  text("steps_completed").array().notNull().default([]),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

export type AuditProfile       = typeof auditProfilesTable.$inferSelect;
export type InsertAuditProfile = typeof auditProfilesTable.$inferInsert;
export const insertAuditProfileSchema = createInsertSchema(auditProfilesTable);
export const selectAuditProfileSchema = createSelectSchema(auditProfilesTable);
