import { pgTable, serial, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 32 }).notNull().default("admin"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
