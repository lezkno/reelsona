/**
 * Shared provision helper.
 *
 * Called by:
 *   - POST /api/admin/provision   (manual/admin)
 *   - POST /api/webhooks/stripe   (automated, post-payment)
 *
 * Creates or updates a user account, upserts the entitlement, grants credits,
 * and sends the activation email. Does NOT touch purchases — callers manage that table.
 */

import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./password";
import { sendEmail, activationEmail, getAppUrl } from "./email";
import { upsertEntitlement } from "./access";
import { invalidateAccessCache } from "../middleware/requireToolAccess";
import { provisionCredits, CREDITS_PER_DAY } from "./credits";

export interface ProvisionParams {
  email:          string;
  name:           string;
  toolAccessDays: number;
  courseAccess?:  boolean;
  source?:        string;
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
    toolAccessDays,
    courseAccess = true,
    source       = "manual",
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
  const now             = new Date();
  const toolAccessEndsAt = new Date(now.getTime() + toolAccessDays * 24 * 60 * 60 * 1000);

  await upsertEntitlement({
    userId,
    courseAccess,
    toolAccessStatus:   "active",
    toolAccessStartsAt: now,
    toolAccessEndsAt,
    source,
  });

  // Clear the access cache so the user gets access on their next request
  // without waiting for the 90-second TTL to expire.
  invalidateAccessCache(userId);

  // ── Grant credits ─────────────────────────────────────────────────────────
  // Credits accumulate on re-provision so re-purchasing extends the balance.
  const creditsToGrant = toolAccessDays * CREDITS_PER_DAY;
  try {
    await provisionCredits(
      userId,
      creditsToGrant,
      `${source}: ${toolAccessDays} días de acceso`,
    );
  } catch (creditErr: any) {
    console.error(`[provision] Credit grant failed for userId=${userId}:`, creditErr?.message);
    // Non-fatal: user still gets access. Credits can be granted manually if needed.
  }

  // ── Send activation email ─────────────────────────────────────────────────
  const activateUrl = `${getAppUrl()}/activate?token=${activationToken}`;
  let emailSent = false;
  let warning: string | undefined;

  try {
    const tpl = activationEmail(name || username, activateUrl, toolAccessDays);
    await sendEmail({ to: username, ...tpl });
    emailSent = true;
  } catch (emailErr: any) {
    warning = `Usuario provisionado pero el email no pudo enviarse: ${emailErr?.message ?? "error desconocido"}`;
    console.error(`[provision] Email failed for ${username}:`, emailErr?.message);
  }

  return { userId, created, emailSent, ...(warning ? { warning } : {}) };
}
