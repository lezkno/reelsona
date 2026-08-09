/**
 * Admin-only routes.
 *
 * Mounted BEFORE requireAuth so programmatic callers (future webhooks) can
 * reach them with a Bearer token instead of a session cookie.
 *
 * Access control — EITHER:
 *   (a) valid session with role='admin', OR
 *   (b) Authorization: Bearer <ADMIN_PASSWORD>
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { users, userEntitlements } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendEmail, activationEmail, getAppUrl } from "../lib/email";
import { provisionUser } from "../lib/provision";

const router = Router();

// ── Admin auth helper ─────────────────────────────────────────────────────────

function isAdminRequest(req: Request): boolean {
  const adminPw = process.env.ADMIN_PASSWORD;
  const authHeader = req.headers.authorization ?? "";
  const bearerValid = !!adminPw && authHeader === `Bearer ${adminPw}`;
  const sessionValid =
    req.session?.authenticated === true &&
    req.session?.user?.role === "admin";
  return bearerValid || sessionValid;
}

// ── POST /api/admin/provision ─────────────────────────────────────────────────
/**
 * Creates or updates a student account with course + tool access.
 *
 * Body:
 *   email            string   required
 *   fullName         string   required
 *   toolAccessDays   number   required  (e.g. 30)
 *   courseAccess     boolean  optional  (default true)
 *   source           string   optional  (e.g. 'manual', 'gumroad')
 *
 * Response:
 *   { ok, userId, created, emailSent, warning? }
 */
router.post("/admin/provision", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }

  const {
    email,
    fullName,
    toolAccessDays,
    courseAccess = true,
    source = "manual",
  } = (req.body ?? {}) as {
    email?: string;
    fullName?: string;
    toolAccessDays?: number;
    courseAccess?: boolean;
    source?: string;
  };

  if (!email || !fullName || !toolAccessDays) {
    res.status(400).json({ error: "Se requieren email, fullName y toolAccessDays" });
    return;
  }
  if (toolAccessDays < 1 || toolAccessDays > 3650) {
    res.status(400).json({ error: "toolAccessDays debe estar entre 1 y 3650" });
    return;
  }

  try {
    const result = await provisionUser({
      email:         email.trim(),
      name:          fullName.trim(),
      toolAccessDays,
      courseAccess,
      source,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[admin/provision]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── POST /api/admin/resend-activation ────────────────────────────────────────
/**
 * Refresh the activation token and resend the activation email.
 * Does NOT touch the entitlement dates.
 *
 * Body: { email: string }
 * Response: { ok, emailSent, warning? }
 */
router.post("/admin/resend-activation", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }

  const { email } = (req.body ?? {}) as { email?: string };
  if (!email) {
    res.status(400).json({ error: "Se requiere email" });
    return;
  }

  const username = email.trim().toLowerCase();

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    const activationToken   = randomBytes(32).toString("hex");
    const activationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(users)
      .set({ activationToken, activationTokenExpiresAt: activationExpires, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    // Compute remaining tool access days (for the email copy)
    const [ent] = await db
      .select({ toolAccessEndsAt: userEntitlements.toolAccessEndsAt })
      .from(userEntitlements)
      .where(eq(userEntitlements.userId, user.id))
      .limit(1);
    const msRemaining   = ent?.toolAccessEndsAt ? ent.toolAccessEndsAt.getTime() - Date.now() : 0;
    const daysRemaining = Math.max(1, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));

    const activateUrl = `${getAppUrl()}/activate?token=${activationToken}`;

    let emailSent = false;
    let warning: string | undefined;

    try {
      const tpl = activationEmail(user.fullName ?? username, activateUrl, daysRemaining);
      await sendEmail({ to: username, ...tpl });
      emailSent = true;
    } catch (emailErr: any) {
      warning = `Token renovado pero el email no pudo enviarse: ${emailErr?.message ?? "error desconocido"}`;
      console.error("[admin/resend-activation] Email send failed:", emailErr);
    }

    res.json({ ok: true, emailSent, ...(warning ? { warning } : {}) });
  } catch (err) {
    console.error("[admin/resend-activation]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── GET /api/admin/entitlements ───────────────────────────────────────────────
/** List all entitlements (admin overview). */
router.get("/admin/entitlements", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }

  try {
    const { userEntitlements } = await import("@workspace/db/schema");
    const rows = await db
      .select({
        userId:             userEntitlements.userId,
        courseAccess:       userEntitlements.courseAccess,
        toolAccessStatus:   userEntitlements.toolAccessStatus,
        toolAccessEndsAt:   userEntitlements.toolAccessEndsAt,
        source:             userEntitlements.source,
        createdAt:          userEntitlements.createdAt,
        username:           users.username,
        fullName:           users.fullName,
        isActive:           users.isActive,
      })
      .from(userEntitlements)
      .innerJoin(users, eq(users.id, userEntitlements.userId))
      .orderBy(userEntitlements.createdAt);

    res.json({ entitlements: rows });
  } catch (err) {
    console.error("[admin/entitlements]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
