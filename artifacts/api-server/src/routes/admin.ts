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
import { users, userEntitlements, videosTable, settingsTable, captionConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail, activationEmail, getAppUrl } from "../lib/email";
import { provisionUser } from "../lib/provision";
import { runCaptionProcessing } from "../lib/scheduler";

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
        userId:                   userEntitlements.userId,
        courseAccess:             userEntitlements.courseAccess,
        toolAccessStatus:         userEntitlements.toolAccessStatus,
        toolAccessEndsAt:         userEntitlements.toolAccessEndsAt,
        source:                   userEntitlements.source,
        createdAt:                userEntitlements.createdAt,
        username:                 users.username,
        fullName:                 users.fullName,
        isActive:                 users.isActive,
        activationTokenExpiresAt: users.activationTokenExpiresAt,
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

// ── GET /api/admin/entitlements/export.csv ────────────────────────────────────
/** Download student entitlement list as CSV. */
router.get("/admin/entitlements/export.csv", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }

  try {
    const { userEntitlements } = await import("@workspace/db/schema");
    const rows = await db
      .select({
        userId:           userEntitlements.userId,
        courseAccess:     userEntitlements.courseAccess,
        toolAccessStatus: userEntitlements.toolAccessStatus,
        toolAccessEndsAt: userEntitlements.toolAccessEndsAt,
        source:           userEntitlements.source,
        createdAt:        userEntitlements.createdAt,
        username:         users.username,
        fullName:         users.fullName,
        isActive:         users.isActive,
      })
      .from(userEntitlements)
      .innerJoin(users, eq(users.id, userEntitlements.userId))
      .orderBy(userEntitlements.createdAt);

    const fmt = (d: Date | string | null) =>
      d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;

    const header = "ID,Nombre,Email,Curso,Herramienta,Vencimiento,Días restantes,Fuente,Alta,Activo\n";
    const csvRows = rows.map((r) => {
      const ends = r.toolAccessEndsAt ? new Date(r.toolAccessEndsAt) : null;
      const daysLeft = ends ? Math.ceil((ends.getTime() - Date.now()) / 86_400_000) : null;
      return [
        String(r.userId),
        esc(r.fullName ?? ""),
        esc(r.username),
        r.courseAccess ? "Sí" : "No",
        esc(r.toolAccessStatus),
        fmt(r.toolAccessEndsAt),
        daysLeft !== null ? String(daysLeft) : "",
        esc(r.source ?? ""),
        fmt(r.createdAt),
        r.isActive ? "Sí" : "No",
      ].join(",");
    }).join("\n");

    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="alumnos-${today}.csv"`);
    res.send("\uFEFF" + header + csvRows); // BOM for Excel compatibility
  } catch (err) {
    console.error("[admin/entitlements/export.csv]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── PATCH /api/admin/entitlements/:userId/access-days ─────────────────────────
/** Update tool access days for an existing student. */
router.patch("/admin/entitlements/:userId/access-days", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }

  const userId = parseInt(req.params.userId as string, 10);
  const { toolAccessDays } = req.body as { toolAccessDays?: unknown };

  if (!Number.isFinite(userId) || userId < 1) {
    res.status(400).json({ error: "userId inválido" }); return;
  }
  if (typeof toolAccessDays !== "number" || toolAccessDays < 1 || toolAccessDays > 3650) {
    res.status(400).json({ error: "toolAccessDays debe ser un número entre 1 y 3650" }); return;
  }

  try {
    const { userEntitlements: ue } = await import("@workspace/db/schema");

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

    const [ent] = await db.select().from(ue).where(eq(ue.userId, userId)).limit(1);

    await provisionUser({
      email:          user.username,
      name:           user.fullName ?? user.username,
      toolAccessDays,
      courseAccess:   ent?.courseAccess ?? true,
      source:         ent?.source ?? "manual",
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[admin/entitlements/:userId/access-days]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── POST /api/admin/reprocess-video ──────────────────────────────────────────
/**
 * Re-run the full effects pipeline (zoom, b-roll, captions) on any video by ID.
 * Body: { videoId: number, effects?: { zoom, ai_broll, text_cards } }
 */
router.post("/admin/reprocess-video", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { videoId, effects } = req.body ?? {};
  if (!videoId || typeof videoId !== "number") {
    res.status(400).json({ error: "videoId (number) requerido" }); return;
  }

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId)).limit(1);
  if (!video) { res.status(404).json({ error: "Video no encontrado" }); return; }
  if (!video.videoUrl) { res.status(400).json({ error: "El video no tiene URL fuente" }); return; }

  // Check caption config exists for this user
  const [captionCfg] = await db.select().from(captionConfigTable)
    .where(eq(captionConfigTable.userId, video.userId)).limit(1);
  if (!captionCfg) { res.status(400).json({ error: "No hay Caption Config para este usuario" }); return; }

  // Determine which effects to apply
  const videoEffects = effects ?? {
    zoom: true,
    ai_broll: true,
    text_cards: false,
  };

  // Reset caption state so runCaptionProcessing picks it up fresh
  await db.update(videosTable)
    .set({ captionStatus: null, captionedVideoUrl: null, videoEffects, updatedAt: new Date() })
    .where(eq(videosTable.id, videoId));

  // Fire and forget — logs appear in the server console
  runCaptionProcessing(video.id, video.videoUrl, video.contentPlanId ?? null, null, video.durationSeconds ?? null)
    .catch(err => console.error("[admin/reprocess-video] Error:", err));

  res.json({ ok: true, message: `Reprocesando video ${videoId} con efectos ${JSON.stringify(videoEffects)}` });
});

export default router;
