import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Per-user, per-look metadata for Avatar V quality features.
 *
 * Populated when the user toggles looks in the avatar picker (PUT /heygen/avatar-config).
 * Used by generateVideo() to:
 *   1. Find the master/reference look in the same group for reference_look_id
 *   2. Feature-detect supported engines without extra HeyGen API calls
 */
export const avatarLookMetadataTable = pgTable("avatar_look_metadata", {
  id:                   serial("id").primaryKey(),
  userId:               integer("user_id").notNull().references(() => users.id),
  /** HeyGen look ID — photo_avatar looks carry the "tp:" prefix. */
  lookId:               text("look_id").notNull(),
  /** HeyGen avatar_group ID that owns this look. Null for standalone/public avatars. */
  groupId:              text("group_id"),
  /** "digital_twin" | "photo_avatar" | "studio_avatar" */
  avatarType:           text("avatar_type"),
  /** HeyGen supported_api_engines array, e.g. ["avatar_v","avatar_iv","avatar_iii"]. */
  supportedApiEngines:  text("supported_api_engines").array().notNull().default([]),
  /**
   * true = this look is the reference/master for its group.
   * Auto-assigned to the first Digital Twin look added per group.
   * Used as reference_look_id when generating with sibling looks via Avatar V.
   */
  isMasterLook:         boolean("is_master_look").notNull().default(false),
  /** "vertical" | "horizontal" — preferred shooting orientation. */
  preferredOrientation: text("preferred_orientation"),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
  updatedAt:            timestamp("updated_at").notNull().defaultNow(),
});

export type AvatarLookMetadataRow = typeof avatarLookMetadataTable.$inferSelect;
