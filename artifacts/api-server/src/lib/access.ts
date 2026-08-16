/**
 * Access / entitlement helpers.
 *
 * Rules:
 *  - role='admin'              → always has full access (no entitlement row needed)
 *  - course_access=true        → can access /course regardless of tool status
 *  - tool_access_status active|trialing AND ends_at null|future → tool access granted
 *  - tool_access_status expired|disabled OR ends_at past        → tool access denied
 */

import { db } from "@workspace/db";
import { userEntitlements } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export type ToolAccessStatus = "active" | "trialing" | "expired" | "disabled";

export interface AccessInfo {
  courseAccess:       boolean;
  toolAccessStatus:   ToolAccessStatus;
  toolAccessStartsAt: Date | null;
  toolAccessEndsAt:   Date | null;
  /** true when status is active/trialing AND end date is null or in the future */
  toolAccessActive:   boolean;
  /** null = no expiry set; 0 = expired; N = days until expiry */
  daysRemaining:      number | null;
  source:             string | null;
}

/** Synthetic full-access object returned for admin users. */
export const ADMIN_ACCESS: AccessInfo = {
  courseAccess:       true,
  toolAccessStatus:   "active",
  toolAccessStartsAt: null,
  toolAccessEndsAt:   null,
  toolAccessActive:   true,
  daysRemaining:      null,
  source:             "admin",
};

/** No entitlement row exists for this user. */
export const NO_ACCESS: AccessInfo = {
  courseAccess:       false,
  toolAccessStatus:   "disabled",
  toolAccessStartsAt: null,
  toolAccessEndsAt:   null,
  toolAccessActive:   false,
  daysRemaining:      null,
  source:             null,
};

export async function getUserAccess(
  userId: number,
  role: string
): Promise<AccessInfo> {
  // Admins always have full access — no DB query needed
  if (role === "admin") return ADMIN_ACCESS;

  const [row] = await db
    .select()
    .from(userEntitlements)
    .where(eq(userEntitlements.userId, userId))
    .limit(1);

  if (!row) return NO_ACCESS;

  const now = new Date();
  const status = row.toolAccessStatus as ToolAccessStatus;
  const toolAccessActive =
    (status === "active" || status === "trialing") &&
    (!row.toolAccessEndsAt || row.toolAccessEndsAt > now);

  let daysRemaining: number | null = null;
  if (row.toolAccessEndsAt) {
    const ms = row.toolAccessEndsAt.getTime() - now.getTime();
    daysRemaining = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  return {
    courseAccess:       row.courseAccess,
    toolAccessStatus:   status,
    toolAccessStartsAt: row.toolAccessStartsAt,
    toolAccessEndsAt:   row.toolAccessEndsAt,
    toolAccessActive,
    daysRemaining,
    source:             row.source ?? null,
  };
}

/**
 * Upsert an entitlement row.
 * Creates it if it doesn't exist, updates it if it does.
 */
export async function upsertEntitlement(params: {
  userId:           number;
  courseAccess:     boolean;
  toolAccessStatus: ToolAccessStatus;
  toolAccessStartsAt?: Date | null;
  toolAccessEndsAt?:   Date | null;
  source?:             string;
  planSlug?:           string | null;
}): Promise<void> {
  await db
    .insert(userEntitlements)
    .values({
      userId:             params.userId,
      courseAccess:       params.courseAccess,
      toolAccessStatus:   params.toolAccessStatus,
      toolAccessStartsAt: params.toolAccessStartsAt ?? null,
      toolAccessEndsAt:   params.toolAccessEndsAt   ?? null,
      source:             params.source ?? "manual",
      planSlug:           params.planSlug ?? null,
      updatedAt:          new Date(),
    })
    .onConflictDoUpdate({
      target: userEntitlements.userId,
      set: {
        courseAccess:       params.courseAccess,
        toolAccessStatus:   params.toolAccessStatus,
        toolAccessStartsAt: params.toolAccessStartsAt ?? null,
        toolAccessEndsAt:   params.toolAccessEndsAt   ?? null,
        source:             params.source ?? "manual",
        planSlug:           params.planSlug ?? null,
        updatedAt:          new Date(),
      },
    });
}
