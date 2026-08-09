import { pgTable, serial, integer, boolean, varchar, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userEntitlements = pgTable("user_entitlements", {
  id:                   serial("id").primaryKey(),
  userId:               integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  courseAccess:         boolean("course_access").notNull().default(false),
  toolAccessStatus:     varchar("tool_access_status", { length: 16 }).notNull().default("disabled"),
  toolAccessStartsAt:   timestamp("tool_access_starts_at"),
  toolAccessEndsAt:     timestamp("tool_access_ends_at"),
  source:               varchar("source", { length: 64 }),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
});

export type UserEntitlement    = typeof userEntitlements.$inferSelect;
export type NewUserEntitlement = typeof userEntitlements.$inferInsert;
