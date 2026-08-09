import { pgTable, serial, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id:           serial("id").primaryKey(),
  username:     varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName:     varchar("full_name", { length: 128 }),
  email:        varchar("email", { length: 256 }),
  phone:        varchar("phone", { length: 32 }),
  role:         varchar("role", { length: 32 }).notNull().default("admin"),
  isActive:     boolean("is_active").notNull().default(true),
  notes:        text("notes"),
  avatarUrl:    text("avatar_url"),
  lastLoginAt:               timestamp("last_login_at"),
  verificationToken:           text("verification_token"),
  verificationTokenExpiresAt:  timestamp("verification_token_expires_at"),
  activationToken:             text("activation_token"),
  activationTokenExpiresAt:    timestamp("activation_token_expires_at"),
  createdAt:                 timestamp("created_at").notNull().defaultNow(),
  updatedAt:                 timestamp("updated_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
