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
import { users, userEntitlements, videosTable, settingsTable, captionConfigTable, userCreditsTable, stripePriceConfigsTable } from "@workspace/db";
import { subscriptionsTable, instagramAccountsTable, wavespeedPersonasTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { normalizeVideoEffects } from "../lib/video-pipeline-effects";
import { adjustCredits, provisionSubscriptionCredits, VIDEO_CREDIT_COST, PLAN_CREDITS, FOUNDER_MAX_SEATS } from "../lib/credits";
import { sendEmail, activationEmail, passwordResetEmail, getAppUrl } from "../lib/email";
import { hashPassword } from "../lib/password";
import { provisionUser } from "../lib/provision";
import { runCaptionProcessing, resetCaptionProcessingForReapply } from "../lib/scheduler";
import { getStripe, invalidatePriceCache } from "../lib/stripe";
import { invalidateAccessCache } from "../middleware/requireToolAccess";
import { invalidatePlanCache } from "../middleware/requirePlanAccess";
import { upsertEntitlement } from "../lib/access";

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
    planSlug,
  } = (req.body ?? {}) as {
    email?: string;
    fullName?: string;
    toolAccessDays?: number;
    courseAccess?: boolean;
    source?: string;
    planSlug?: string;
  };

  if (!email || !fullName || !toolAccessDays) {
    res.status(400).json({ error: "Se requieren email, fullName y toolAccessDays" });
    return;
  }
  if (toolAccessDays < 1 || toolAccessDays > 3650) {
    res.status(400).json({ error: "toolAccessDays debe estar entre 1 y 3650" });
    return;
  }

  const VALID_PROVISION_PLANS = ["basic", "pro", "founder"] as const;
  if (planSlug && !VALID_PROVISION_PLANS.includes(planSlug as (typeof VALID_PROVISION_PLANS)[number])) {
    res.status(400).json({ error: "planSlug inválido" }); return;
  }

  try {
    const result = await provisionUser({
      email:         email.trim(),
      name:          fullName.trim(),
      toolAccessDays,
      courseAccess,
      source,
    });

    // ── Optional plan assignment ──────────────────────────────────────────────
    let creditsGranted = 0;
    if (planSlug && VALID_PROVISION_PLANS.includes(planSlug as (typeof VALID_PROVISION_PLANS)[number])) {
      const now         = new Date();
      const periodStart = now;
      const periodEnd   = new Date(now);
      if (planSlug === "founder") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }
      const founderFields = planSlug === "founder"
        ? { founderMonthsGranted: 1, founderAnchorAt: now, founderLastGrantAt: now }
        : {};

      const [existingSub] = await db.select().from(subscriptionsTable)
        .where(eq(subscriptionsTable.userId, result.userId)).limit(1);

      if (existingSub) {
        await db.update(subscriptionsTable)
          .set({ planSlug, status: "active", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, pendingPlanSlug: null, stripeScheduleId: null, updatedAt: now, ...founderFields })
          .where(eq(subscriptionsTable.userId, result.userId));
      } else {
        await db.insert(subscriptionsTable).values({
          userId: result.userId, planSlug, status: "active",
          currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false, ...founderFields,
        });
      }

      await upsertEntitlement({
        userId:             result.userId,
        courseAccess:       true,
        toolAccessStatus:   "active",
        toolAccessStartsAt: periodStart,
        toolAccessEndsAt:   periodEnd,
        source:             "admin",
        planSlug,
      });

      creditsGranted = PLAN_CREDITS[planSlug] ?? 0;
      if (creditsGranted > 0) {
        await provisionSubscriptionCredits(
          result.userId,
          creditsGranted,
          `Plan ${planSlug} asignado al dar acceso`,
        );
      }

      invalidateAccessCache(result.userId);
      invalidatePlanCache(result.userId);
      console.log(`[admin/provision] plan=${planSlug} assigned to userId=${result.userId}, credits=${creditsGranted}`);
    }

    res.json({ ok: true, ...result, creditsGranted });
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
        isSuspended:              users.isSuspended,
        activationTokenExpiresAt: users.activationTokenExpiresAt,
        // Credit wallet (LEFT JOIN — null if no wallet exists yet)
        availableCredits:         userCreditsTable.availableCredits,
        reservedCredits:          userCreditsTable.reservedCredits,
        totalConsumed:            userCreditsTable.totalConsumed,
      })
      .from(userEntitlements)
      .innerJoin(users, eq(users.id, userEntitlements.userId))
      .leftJoin(userCreditsTable, eq(userCreditsTable.userId, userEntitlements.userId))
      .orderBy(userEntitlements.createdAt);

    const entitlements = rows.map((r) => ({ ...r }));

    res.json({ entitlements });
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
    res.setHeader("Content-Disposition", `attachment; filename="usuarios-${today}.csv"`);
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
  // An admin retry must not silently turn on costly effects. If no explicit
  // body was supplied, preserve the video's normalized snapshot instead.
  const videoEffects = normalizeVideoEffects(effects ?? video.videoEffects);

  // A reprocess may never reset a healthy renderer's active lease. Without this
  // compare-and-set, the new run could start beside an already-running effects
  // pipeline for the same video.
  const requeued = await resetCaptionProcessingForReapply(videoId, videoEffects);
  if (!requeued) {
    res.status(409).json({ error: "El video ya está procesando captions o efectos. Espera a que termine." });
    return;
  }

  // Fire and forget — logs appear in the server console
  // skipBroll=true: admin reprocess is a reapply — don't regenerate B-roll images
  runCaptionProcessing(video.id, video.videoUrl, video.contentPlanId ?? null, null, video.durationSeconds ?? null, true)
    .catch(err => console.error("[admin/reprocess-video] Error:", err));

  res.json({ ok: true, message: `Reprocesando video ${videoId} con efectos ${JSON.stringify(videoEffects)}` });
});

// ── GET /api/admin/credits ────────────────────────────────────────────────────
/** All user wallet states — for the admin credits panel. */
router.get("/admin/credits", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" }); return;
  }

  try {
    const rows = await db
      .select({
        userId:           userCreditsTable.userId,
        availableCredits: userCreditsTable.availableCredits,
        reservedCredits:  userCreditsTable.reservedCredits,
        totalConsumed:    userCreditsTable.totalConsumed,
        updatedAt:        userCreditsTable.updatedAt,
        username:         users.username,
        fullName:         users.fullName,
      })
      .from(userCreditsTable)
      .innerJoin(users, eq(users.id, userCreditsTable.userId))
      .orderBy(userCreditsTable.availableCredits);  // lowest first — easiest to spot who's running out

    const wallets = rows.map((r) => ({ ...r }));

    res.json({ wallets });
  } catch (err) {
    console.error("[admin/credits]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── POST /api/admin/credits/:userId/adjust ────────────────────────────────────
/** Manually add (positive) or deduct (negative) credits for a user. */
router.post("/admin/credits/:userId/adjust", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" }); return;
  }

  const userId = parseInt(req.params.userId as string, 10);
  const { amount, reason } = req.body as { amount?: unknown; reason?: unknown };

  if (!Number.isFinite(userId) || userId < 1) {
    res.status(400).json({ error: "userId inválido" }); return;
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
    res.status(400).json({ error: "amount debe ser un número distinto de 0" }); return;
  }
  if (Math.abs(amount) > 10_000) {
    res.status(400).json({ error: "amount no puede superar ±10 000 créditos" }); return;
  }

  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

    const label = (typeof reason === "string" && reason.trim())
      ? reason.trim()
      : `Ajuste manual por admin (${amount > 0 ? "+" : ""}${amount})`;

    await adjustCredits(userId, amount, label);

    res.json({ ok: true });
  } catch (err: any) {
    // Validation error: deduction would drive balance below zero
    if (err?.message?.startsWith("No se puede descontar")) {
      res.status(422).json({ error: err.message });
      return;
    }
    console.error("[admin/credits/:userId/adjust]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── POST /api/admin/stripe/setup ──────────────────────────────────────────────
/**
 * Idempotent Stripe product + price setup.
 *
 * Creates all plan and topup products/prices in Stripe and upserts the
 * stripe_price_configs table so checkout sessions can look up real price IDs.
 *
 * Plans created:
 *   basic    — $29/mo, 400 credits
 *   pro      — $97/mo, 1500 credits
 *   founder  — $697/year (one-time year), 1500 credits (first month grant via cron)
 *
 * Topups created:
 *   topup-300  — $19, 300 credits
 *   topup-600  — $35, 600 credits
 *   topup-1200 — $59, 1200 credits
 *
 * Call this once after deployment whenever Stripe config changes.
 * Safe to re-run — existing Stripe IDs are reused if already stored.
 *
 * Auth: Bearer ADMIN_PASSWORD or admin session.
 */
router.post("/admin/stripe/setup", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }

  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (err: any) {
    res.status(503).json({ error: "Stripe no está configurado: " + err.message });
    return;
  }

  interface PlanDef {
    planSlug:     string;
    name:         string;
    description:  string;
    amountCents:  number;
    currency:     string;
    interval:     string | null;   // 'month' | 'year' | null (one-time)
    creditAmount: number;
    isRecurring:  boolean;
  }

  const plans: PlanDef[] = [
    { planSlug: "basic",      name: "Reelsona Basic",         description: "400 créditos/mes — 1 avatar",                          amountCents: 2900,  currency: "usd", interval: "month", creditAmount: 400,  isRecurring: true  },
    { planSlug: "pro",        name: "Reelsona Pro",           description: "1500 créditos/mes — 3 avatares",                       amountCents: 9700,  currency: "usd", interval: "month", creditAmount: 1500, isRecurring: true  },
    { planSlug: "founder",    name: "Reelsona Founder",       description: `Acceso fundador anual (max ${FOUNDER_MAX_SEATS} plazas)`, amountCents: 69700, currency: "usd", interval: "year",  creditAmount: 1500, isRecurring: true  },
    { planSlug: "topup-300",  name: "Créditos +300",          description: "300 créditos de uso",                                  amountCents: 1900,  currency: "usd", interval: null,    creditAmount: 300,  isRecurring: false },
    { planSlug: "topup-600",  name: "Créditos +600",          description: "600 créditos de uso",                                  amountCents: 3500,  currency: "usd", interval: null,    creditAmount: 600,  isRecurring: false },
    { planSlug: "topup-1200", name: "Créditos +1200",         description: "1200 créditos de uso",                                 amountCents: 5900,  currency: "usd", interval: null,    creditAmount: 1200, isRecurring: false },
  ];

  const results: Array<{ planSlug: string; stripePriceId: string; stripeProductId: string; created: boolean }> = [];
  const errors:  Array<{ planSlug: string; error: string }> = [];

  for (const plan of plans) {
    try {
      // Check if we already have this slug in DB (idempotency)
      const [existing] = await db
        .select()
        .from(stripePriceConfigsTable)
        .where(eq(stripePriceConfigsTable.planSlug, plan.planSlug))
        .limit(1);

      if (existing) {
        results.push({ planSlug: plan.planSlug, stripePriceId: existing.stripePriceId, stripeProductId: existing.stripeProductId, created: false });
        continue;
      }

      // Create Stripe product
      const product = await stripe.products.create({
        name:        plan.name,
        description: plan.description,
        metadata:    { plan_slug: plan.planSlug, credit_amount: String(plan.creditAmount) },
      });

      // Create Stripe price
      let price: Awaited<ReturnType<typeof stripe.prices.create>>;
      if (plan.isRecurring && plan.interval) {
        price = await stripe.prices.create({
          product:    product.id,
          unit_amount: plan.amountCents,
          currency:   plan.currency,
          recurring:  { interval: plan.interval as "month" | "year" },
          metadata:   { plan_slug: plan.planSlug, credit_amount: String(plan.creditAmount) },
        });
      } else {
        price = await stripe.prices.create({
          product:    product.id,
          unit_amount: plan.amountCents,
          currency:   plan.currency,
          metadata:   { plan_slug: plan.planSlug, credit_amount: String(plan.creditAmount) },
        });
      }

      // Upsert into our DB
      await db
        .insert(stripePriceConfigsTable)
        .values({
          planSlug:        plan.planSlug,
          stripePriceId:   price.id,
          stripeProductId: product.id,
          amountCents:     plan.amountCents,
          currency:        plan.currency,
          interval:        plan.interval ?? undefined,
          creditAmount:    plan.creditAmount,
          isRecurring:     plan.isRecurring,
        })
        .onConflictDoUpdate({
          target: stripePriceConfigsTable.planSlug,
          set: {
            stripePriceId:   price.id,
            stripeProductId: product.id,
            amountCents:     plan.amountCents,
            interval:        plan.interval ?? undefined,
            creditAmount:    plan.creditAmount,
            isRecurring:     plan.isRecurring,
            updatedAt:       new Date(),
          },
        });

      results.push({ planSlug: plan.planSlug, stripePriceId: price.id, stripeProductId: product.id, created: true });
      console.log(`[admin/stripe/setup] Created ${plan.planSlug}: product=${product.id} price=${price.id}`);
    } catch (err: any) {
      console.error(`[admin/stripe/setup] Failed for ${plan.planSlug}:`, err.message);
      errors.push({ planSlug: plan.planSlug, error: err.message });
    }
  }

  // Invalidate price config cache so new values are picked up immediately
  invalidatePriceCache();

  const allOk = errors.length === 0;
  res.status(allOk ? 200 : 207).json({
    ok:      allOk,
    results,
    errors:  errors.length > 0 ? errors : undefined,
    summary: `${results.length} planes configurados, ${errors.length} errores`,
  });
});

// ── GET /api/admin/stripe/prices ──────────────────────────────────────────────
/** Returns the current stripe_price_configs table contents. */
router.get("/admin/stripe/prices", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) {
    res.status(403).json({ error: "Acceso denegado" });
    return;
  }
  try {
    const rows = await db.select().from(stripePriceConfigsTable);
    res.json({ ok: true, prices: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/:userId/set-plan ────────────────────────────────────
/**
 * Assign (or remove) a subscription plan for any user without payment.
 * The system acts exactly as if the user bought the plan:
 *   - Subscription row is upserted with status=active, fresh period dates.
 *   - Monthly plan credits are provisioned via provisionSubscriptionCredits
 *     (replaces the subscription pool — does NOT accumulate).
 *   - For Founder: founderMonthsGranted/founderAnchorAt are initialised so
 *     the monthly cron takes over from the next cycle onwards.
 *   - planSlug "none" cancels the subscription without touching credits.
 */
router.post("/admin/users/:userId/set-plan", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) { res.status(403).json({ error: "Acceso denegado" }); return; }

  const userId = parseInt(req.params.userId as string, 10);
  if (!Number.isFinite(userId) || userId < 1) {
    res.status(400).json({ error: "userId inválido" }); return;
  }

  const { planSlug } = req.body as { planSlug?: string };
  const VALID_PLANS = ["basic", "pro", "founder", "none"] as const;
  if (!VALID_PLANS.includes(planSlug as (typeof VALID_PLANS)[number])) {
    res.status(400).json({ error: "planSlug inválido. Usa: basic, pro, founder o none." }); return;
  }

  const [user] = await db.select({ id: users.id, username: users.username })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

  try {
    const now = new Date();
    const [existingSub] = await db.select().from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId)).limit(1);

    // ── Removing the plan ────────────────────────────────────────────────────
    if (planSlug === "none") {
      if (existingSub) {
        await db.update(subscriptionsTable)
          .set({ status: "canceled", cancelAtPeriodEnd: false, pendingPlanSlug: null, stripeScheduleId: null, updatedAt: now })
          .where(eq(subscriptionsTable.userId, userId));
      }
      // Expire entitlement so requireToolAccess blocks immediately
      await upsertEntitlement({
        userId,
        courseAccess:     false,
        toolAccessStatus: "expired",
        toolAccessEndsAt: now,
        source:           "admin",
        planSlug:         null,
      });
      invalidateAccessCache(userId);
      invalidatePlanCache(userId);
      console.log(`[admin/set-plan] user=${userId} (${user.username}) → none (canceled)`);
      res.json({ ok: true, planSlug: "none", creditsGranted: 0 });
      return;
    }

    // ── Assigning a plan ────────────────────────────────────────────────────
    const periodStart = now;
    const periodEnd   = new Date(now);
    if (planSlug === "founder") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);   // annual
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);          // monthly
    }

    const baseFields = {
      planSlug:          planSlug as string,
      status:            "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd:   periodEnd,
      cancelAtPeriodEnd:  false,
      pendingPlanSlug:    null,
      stripeScheduleId:   null,
      updatedAt:          now,
    } as const;

    const founderFields = planSlug === "founder" ? {
      // Set founderMonthsGranted=1 so the scheduler picks up from month 2.
      // founderAnchorAt anchors all future monthly grant dates.
      founderMonthsGranted: 1,
      founderAnchorAt:      now,
      founderLastGrantAt:   now,
    } : {};

    if (existingSub) {
      await db.update(subscriptionsTable)
        .set({ ...baseFields, ...founderFields })
        .where(eq(subscriptionsTable.userId, userId));
    } else {
      await db.insert(subscriptionsTable).values({
        userId,
        ...baseFields,
        ...founderFields,
      });
    }

    // Upsert entitlement so requireToolAccess grants access immediately
    await upsertEntitlement({
      userId,
      courseAccess:       true,
      toolAccessStatus:   "active",
      toolAccessStartsAt: periodStart,
      toolAccessEndsAt:   periodEnd,
      source:             "admin",
      planSlug:           planSlug as string,
    });

    // Grant credits exactly as if the plan was purchased
    const credits = PLAN_CREDITS[planSlug!] ?? 0;
    if (credits > 0) {
      await provisionSubscriptionCredits(
        userId,
        credits,
        `Plan ${planSlug} asignado manualmente por admin`,
      );
    }

    invalidateAccessCache(userId);
    invalidatePlanCache(userId);

    console.log(`[admin/set-plan] user=${userId} (${user.username}) → ${planSlug}, credits=${credits}`);
    res.json({ ok: true, planSlug, creditsGranted: credits });

  } catch (err: unknown) {
    console.error("[admin/set-plan]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── POST /api/admin/users/:userId/toggle-suspend ──────────────────────────────
/**
 * Toggles the suspended state of a user account.
 * Suspended users cannot log in and any active session is blocked within 30 s.
 * Admins cannot suspend their own account.
 */
router.post("/admin/users/:userId/toggle-suspend", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) { res.status(403).json({ error: "Acceso denegado" }); return; }

  const userId = parseInt(req.params.userId as string, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "userId inválido" }); return; }

  if (req.session?.user?.userId === userId) {
    res.status(400).json({ error: "No puedes suspender tu propia cuenta" });
    return;
  }

  try {
    const [user] = await db
      .select({ isSuspended: users.isSuspended })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

    const newSuspended = !user.isSuspended;
    await db
      .update(users)
      .set({
        isSuspended: newSuspended,
        suspendedAt: newSuspended ? new Date() : null,
        updatedAt:   new Date(),
      })
      .where(eq(users.id, userId));

    const { invalidateSuspensionCache } = await import("../middleware/auth");
    invalidateSuspensionCache(userId);

    console.log(`[admin/toggle-suspend] userId=${userId} isSuspended=${newSuspended}`);
    res.json({ ok: true, isSuspended: newSuspended });
  } catch (err) {
    console.error("[admin/toggle-suspend]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── POST /api/admin/users/:userId/set-password ────────────────────────────────
/**
 * Admin sets a new password for any user directly, without requiring the old one.
 */
router.post("/admin/users/:userId/set-password", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) { res.status(403).json({ error: "Acceso denegado" }); return; }

  const userId = parseInt(req.params.userId as string, 10);
  if (!Number.isFinite(userId) || userId < 1) { res.status(400).json({ error: "userId inválido" }); return; }

  const { password } = req.body as { password?: string };
  if (!password || password.length < 8) {
    res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" }); return;
  }

  try {
    const result = await db
      .update(users)
      .set({ passwordHash: hashPassword(password), updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (result.length === 0) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

    console.log(`[admin/set-password] userId=${userId}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin/set-password]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── POST /api/admin/users/:userId/send-reset-email ────────────────────────────
/**
 * Generates a password-reset token and emails the user a link to choose their
 * own new password. Token expires in 1 hour.
 */
router.post("/admin/users/:userId/send-reset-email", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) { res.status(403).json({ error: "Acceso denegado" }); return; }

  const userId = parseInt(req.params.userId as string, 10);
  if (!Number.isFinite(userId) || userId < 1) { res.status(400).json({ error: "userId inválido" }); return; }

  try {
    const [user] = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName, username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) { res.status(404).json({ error: "Usuario no encontrado" }); return; }
    if (!user.email) { res.status(400).json({ error: "Este usuario no tiene email registrado" }); return; }

    const token = randomBytes(32).toString("hex");
    await db
      .update(users)
      .set({
        passwordResetToken:           token,
        passwordResetTokenExpiresAt:  new Date(Date.now() + 60 * 60 * 1000),
        updatedAt:                    new Date(),
      })
      .where(eq(users.id, userId));

    const resetUrl = `${getAppUrl()}/reset-password?token=${token}`;
    sendEmail({
      to: user.email,
      ...passwordResetEmail(user.fullName ?? user.username, resetUrl),
    }).catch((err) => console.error("[admin/send-reset-email] email failed:", err));

    console.log(`[admin/send-reset-email] userId=${userId} email=${user.email}`);
    res.json({ ok: true, email: user.email });
  } catch (err) {
    console.error("[admin/send-reset-email]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── GET /api/admin/users/:userId/detail ───────────────────────────────────────
/**
 * Full user profile for the admin panel: account, subscription, credits,
 * entitlement, production stats, and Instagram connection status.
 * Sensitive fields (Stripe IDs, tokens, password) are never exposed.
 */
router.get("/admin/users/:userId/detail", async (req: Request, res: Response): Promise<void> => {
  if (!isAdminRequest(req)) { res.status(403).json({ error: "Acceso denegado" }); return; }

  const userId = parseInt(req.params.userId as string, 10);
  if (!Number.isFinite(userId) || userId < 1) {
    res.status(400).json({ error: "userId inválido" }); return;
  }

  try {
    const [
      accountRow,
      subRow,
      creditsRow,
      entRow,
      igRow,
      videoStats,
      avatarCntResult,
      lookCntResult,
    ] = await Promise.all([
      // Account (no passwordHash / tokens)
      db.select({
        id:               users.id,
        username:         users.username,
        fullName:         users.fullName,
        email:            users.email,
        phone:            users.phone,
        role:             users.role,
        isActive:         users.isActive,
        notes:            users.notes,
        createdAt:        users.createdAt,
        lastLoginAt:      users.lastLoginAt,
        // Activation pending = token exists (non-null) in DB
        activationPending: sql<boolean>`(activation_token IS NOT NULL)`,
      }).from(users).where(eq(users.id, userId)).limit(1).then((r) => r[0] ?? null),

      // Subscription
      db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId)).limit(1).then((r) => r[0] ?? null),

      // Credits wallet
      db.select().from(userCreditsTable).where(eq(userCreditsTable.userId, userId)).limit(1).then((r) => r[0] ?? null),

      // Tool entitlement
      db.select().from(userEntitlements).where(eq(userEntitlements.userId, userId)).limit(1).then((r) => r[0] ?? null),

      // Instagram account
      db.select({
        username:          instagramAccountsTable.username,
        needsReconnection: instagramAccountsTable.needsReconnection,
      }).from(instagramAccountsTable).where(eq(instagramAccountsTable.userId, userId)).limit(1).then((r) => r[0] ?? null),

      // Video counts by status
      db.execute(sql`
        SELECT
          COUNT(*)                                        AS total,
          COUNT(*) FILTER (WHERE status = 'published')   AS published,
          COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
          COUNT(*) FILTER (WHERE status IN ('scripting','generating','queued')) AS in_progress
        FROM videos
        WHERE user_id = ${userId}
      `).then((r) => r.rows[0] as Record<string, string> | undefined ?? {}),

      // WaveSpeed persona count
      db.execute(sql`SELECT COUNT(*) AS cnt FROM wavespeed_personas WHERE user_id = ${userId}`)
        .then((r) => Number((r.rows[0] as Record<string, string> | undefined)?.cnt ?? 0)),

      // WaveSpeed look count (across all personas owned by user)
      db.execute(sql`
        SELECT COUNT(wl.id) AS cnt
        FROM wavespeed_looks wl
        JOIN wavespeed_personas wp ON wl.persona_id = wp.id
        WHERE wp.user_id = ${userId}
      `).then((r) => Number((r.rows[0] as Record<string, string> | undefined)?.cnt ?? 0)),
    ]);

    if (!accountRow) { res.status(404).json({ error: "Usuario no encontrado" }); return; }

    res.json({
      account: {
        id:                 accountRow.id,
        username:           accountRow.username,
        fullName:           accountRow.fullName,
        email:              accountRow.email,
        phone:              accountRow.phone,
        role:               accountRow.role,
        isActive:           accountRow.isActive,
        notes:              accountRow.notes,
        createdAt:          accountRow.createdAt,
        lastLoginAt:        accountRow.lastLoginAt,
        activationPending:  accountRow.activationPending,
      },
      subscription: subRow ? {
        planSlug:             subRow.planSlug,
        status:               subRow.status,
        currentPeriodStart:   subRow.currentPeriodStart,
        currentPeriodEnd:     subRow.currentPeriodEnd,
        cancelAtPeriodEnd:    subRow.cancelAtPeriodEnd,
        pendingPlanSlug:      subRow.pendingPlanSlug,
        founderMonthsGranted: subRow.founderMonthsGranted,
        founderAnchorAt:      subRow.founderAnchorAt,
        hasStripeCustomer:    !!subRow.stripeCustomerId,
      } : null,
      credits: creditsRow ? {
        availableCredits:    creditsRow.availableCredits,
        subscriptionCredits: creditsRow.subscriptionCredits,
        purchasedCredits:    creditsRow.purchasedCredits,
        reservedCredits:     creditsRow.reservedCredits,
        totalConsumed:       creditsRow.totalConsumed,
      } : null,
      entitlement: entRow ? {
        toolAccessStatus:   entRow.toolAccessStatus,
        toolAccessStartsAt: entRow.toolAccessStartsAt,
        toolAccessEndsAt:   entRow.toolAccessEndsAt,
        courseAccess:       entRow.courseAccess,
        source:             entRow.source,
        planSlug:           entRow.planSlug,
      } : null,
      instagram: igRow
        ? { connected: true,  username: igRow.username, needsReconnection: igRow.needsReconnection }
        : { connected: false, username: null,            needsReconnection: false },
      production: {
        avatarCount:         avatarCntResult,
        lookCount:           lookCntResult,
        videoCount:          Number(videoStats.total       ?? 0),
        publishedVideoCount: Number(videoStats.published   ?? 0),
        failedVideoCount:    Number(videoStats.failed      ?? 0),
        inProgressCount:     Number(videoStats.in_progress ?? 0),
      },
    });
  } catch (err) {
    console.error("[admin/users/:userId/detail]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
