import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const courseProgress = pgTable("course_progress", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lessonId:    text("lesson_id").notNull(),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
