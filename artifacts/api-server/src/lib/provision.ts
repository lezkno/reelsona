/**
 * Shared provision helper.
 *
 * Called by:
 *   - POST /api/admin/provision   (manual/admin)
 *   - POST /api/webhooks/stripe   (automated, post-payment)
 *   - Subscription lifecycle (webhook.ts)
 *
 * Creates or updates a user account, upserts the entitlement, optionally grants
 * credits, and sends the activation email if the user is new.
 * Does NOT touch purchases — callers manage that table.
 */

import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { users, userEntitlements } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./password";
import { sendEmail, activationEmail, getAppUrl } from "./email";
import { upsertEntitlement } from "./access";
import { invalidateAccessCache } from "../middleware/requireToolAccess";
import { invalidatePlanCache } from "../middleware/requirePlanAccess";
import { provisionCredits } from "./credits";

export interface ProvisionParams {
  email:          string;
  name:           string;
  /** Legacy: number of days of tool access to grant (used by admin/manual). */
  toolAccessDays?: number;
  /** Explicit end date — takes precedence over toolAccessDays if provided. */
  toolAccessEndsAt?: Date | null;
  courseAccess?:  boolean;
  source?:        string;
  /** If provided, sets the planSlug on the entitlement row. */
  planSlug?:      string | null;
  /** Credits to grant at provision time. 0 = skip credit grant. */
  creditsToGrant?: number;
  /**
   * When true, skip the entitlement upsert.
   * Used by Founder provisioning which sets the entitlement inside an advisory-locked
   * transaction AFTER the seat cap is confirmed, so no entitlement persists if the cap
   * check fails.
   */
  skipEntitlement?: boolean;
}

export interface ProvisionResult {
  userId:     number;
  created:    boolean;
  emailSent:  boolean;
  warning?:   string;
}

export async function provisionUser(params: ProvisionParams): Promise<ProvisionResult> {
  const {
    email,
    name,
    toolAccessDays   = 365,
    toolAccessEndsAt: explicitEndsAt,
    courseAccess     = true,
    source           = "manual",
    planSlug         = null,
    creditsToGrant   = 0,
  } = params;

  const username = email.trim().toLowerCase();

  // ── Find or create user ───────────────────────────────────────────────────
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  const activationToken   = randomBytes(32).toString("hex");
  const activationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  let userId:  number;
  let created: boolean;

  if (!existingUser) {
    const [inserted] = await db
      .insert(users)
      .values({
        username,
        passwordHash:             hashPassword(randomBytes(16).toString("hex")),
        fullName:                 name || username,
        email:                    username,
        role:                     "user",
        isActive:                 false,
        activationToken,
        activationTokenExpiresAt: activationExpires,
      })
      .returning({ id: users.id });
    userId  = inserted.id;
    created = true;
  } else {
    userId  = existingUser.id;
    created = false;
    // Refresh activation token so the user can (re-)set their password
    await db
      .update(users)
      .set({
        fullName:                 name || existingUser.fullName || username,
        activationToken,
        activationTokenExpiresAt: activationExpires,
        updatedAt:                new Date(),
      })
      .where(eq(users.id, userId));
  }

  // ── Upsert entitlement ────────────────────────────────────────────────────
  // Skip when skipEntitlement=true — Founder provisioning does this inside
  // an advisory-locked transaction AFTER seat cap verification, so no access
  // is granted if the seat check fails.
  const now = new Date();
  let toolAccessEndsAtFinal: Date | null = null;

  if (!params.skipEntitlement) {
    if (explicitEndsAt !== undefined) {
      toolAccessEndsAtFinal = explicitEndsAt;
    } else {
      const [existingEnt] = await db
        .select({ toolAccessEndsAt: userEntitlements.toolAccessEndsAt })
        .from(userEntitlements)
        .where(eq(userEntitlements.userId, userId))
        .limit(1);

      const base = existingEnt?.toolAccessEndsAt && existingEnt.toolAccessEndsAt > now
        ? existingEnt.toolAccessEndsAt
        : now;
      toolAccessEndsAtFinal = new Date(base.getTime() + toolAccessDays * 24 * 60 * 60 * 1000);
    }

    await upsertEntitlement({
      userId,
      courseAccess,
      toolAccessStatus:   "active",
      toolAccessStartsAt: now,
      toolAccessEndsAt:   toolAccessEndsAtFinal,
      source,
      planSlug: planSlug ?? undefined,
    });

    // Clear both access and plan caches so the user gets correct access on next request
    invalidateAccessCache(userId);
    invalidatePlanCache(userId);
  }

  // ── Grant credits (optional) ───────────────────────────────────────────────
  if (creditsToGrant > 0) {
    try {
      await provisionCredits(
        userId,
        creditsToGrant,
        `${source}: provision ${creditsToGrant} créditos`,
      );
    } catch (creditErr: any) {
      console.error(`[provision] Credit grant failed for userId=${userId}:`, creditErr?.message);
      // Non-fatal: user still gets access. Credits can be granted manually.
    }
  }

  // ── Send activation email (new users only) ────────────────────────────────
  let emailSent = false;
  let warning: string | undefined;

  if (created) {
    const activateUrl = `${getAppUrl()}/activate?token=${activationToken}`;
    try {
      const displayDays = toolAccessDays;
      const tpl = activationEmail(name || username, activateUrl, displayDays);
      await sendEmail({ to: username, ...tpl });
      emailSent = true;
    } catch (emailErr: any) {
      warning = `Usuario provisionado pero el email no pudo enviarse: ${emailErr?.message ?? "error desconocido"}`;
      console.error(`[provision] Email failed for ${username}:`, emailErr?.message);
    }
  } else {
    emailSent = false; // Re-provisions don't re-send activation
  }

  return { userId, created, emailSent, ...(warning ? { warning } : {}) };
}
