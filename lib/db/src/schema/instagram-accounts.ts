import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const instagramAccountsTable = pgTable("instagram_accounts", {
  id: serial("id").primaryKey(),
  igUserId: text("ig_user_id").notNull().unique(),
  username: text("username").notNull(),
  name: text("name"),
  profilePictureUrl: text("profile_picture_url"),
  followersCount: integer("followers_count").notNull().default(0),
  mediaCount: integer("media_count").notNull().default(0),
  accessToken: text("access_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at"),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertInstagramAccountSchema = createInsertSchema(instagramAccountsTable).omit({ id: true });
export type InsertInstagramAccount = z.infer<typeof insertInstagramAccountSchema>;
export type InstagramAccountRow = typeof instagramAccountsTable.$inferSelect;
