import { Router } from "express";
import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, hashPassword } from "../lib/password";
import { sendEmail, passwordChangedEmail, verificationEmail, getAppUrl } from "../lib/email";
import { getUserAccess } from "../lib/access";

const router = Router();

/**
 * POST /api/auth/login
 * Body: { username: string; password: string }
 */
router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password } = (req.body ?? {}) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Se requieren usuario y contraseña" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Usuario o contraseña incorrectos" });
      return;
    }

    if (!user.isActive) {
      // Distinguish between "pending email verification" and "admin-disabled"
      if (user.verificationToken) {
        res.status(403).json({ error: "Debes confirmar tu correo electrónico antes de iniciar sesión. Revisa tu bandeja de entrada." });
      } else {
        res.status(403).json({ error: "Usuario desactivado. Contacta al administrador." });
      }
      return;
    }

    // Update last login timestamp
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    req.session.authenticated = true;
    req.session.user = { username: user.username, role: user.role, userId: user.id };
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/auth/logout", (req: Request, res: Response): void => {
  req.session.destroy(() => {});
  res.clearCookie("contentpilot.sid");
  res.json({ ok: true });
});

/**
 * GET /api/auth/me
 * Returns session info enriched with full profile from DB.
 */
router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ authenticated: false });
    return;
  }
  const sessionUser = req.session.user ?? { username: "admin", role: "admin", userId: 1 };
  try {
    const [row] = await db.select().from(users).where(eq(users.id, sessionUser.userId)).limit(1);
    res.json({
      authenticated: true,
      user: {
        ...sessionUser,
        fullName: row?.fullName ?? null,
        email: row?.email ?? null,
        phone: row?.phone ?? null,
        avatarUrl: row?.avatarUrl ?? null,
      },
    });
  } catch {
    res.json({ authenticated: true, user: sessionUser });
  }
});

/**
 * PATCH /api/auth/profile
 * Self-service profile update (name, email, phone).
 */
router.patch("/auth/profile", async (req: Request, res: Response): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const { fullName, email, phone, avatarUrl } = (req.body ?? {}) as {
    fullName?: string; email?: string; phone?: string; avatarUrl?: string;
  };
  const userId = req.session.user?.userId;
  if (!userId) { res.status(400).json({ error: "Sesión inválida" }); return; }

  try {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (fullName !== undefined) patch.fullName = fullName || null;
    if (email !== undefined) patch.email = email || null;
    if (phone !== undefined) patch.phone = phone || null;
    if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl || null;
    await db.update(users).set(patch).where(eq(users.id, userId));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al actualizar perfil" });
  }
});

/**
 * POST /api/auth/change-password
 * Self-service password change.
 */
router.post("/auth/change-password", async (req: Request, res: Response): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const { currentPassword, newPassword } = (req.body ?? {}) as {
    currentPassword?: string; newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Se requieren ambas contraseñas" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    return;
  }
  const userId = req.session.user?.userId;
  if (!userId) { res.status(400).json({ error: "Sesión inválida" }); return; }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      res.status(401).json({ error: "Contraseña actual incorrecta" });
      return;
    }
    await db.update(users)
      .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, userId));

    // Fire-and-forget: notify by email (don't block the response)
    if (user.email) {
      const tpl = passwordChangedEmail(user.fullName ?? user.username)
      sendEmail({ to: user.email, ...tpl }).catch(() => {})
    }

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error al cambiar contraseña" });
  }
});

/**
 * GET /api/auth/activate/check?token=
 * Public. Returns { email, fullName } for a valid, unexpired activation token.
 * Used by the /activate page to pre-fill user info before the password form.
 */
router.get("/auth/activate/check", async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query as { token?: string };
  if (!token) { res.status(400).json({ error: "Token no proporcionado" }); return; }

  try {
    const [user] = await db
      .select({ id: users.id, email: users.email, username: users.username, fullName: users.fullName, activationTokenExpiresAt: users.activationTokenExpiresAt })
      .from(users)
      .where(eq(users.activationToken, token))
      .limit(1);

    if (!user) { res.status(400).json({ error: "El enlace no es válido o ya fue utilizado." }); return; }
    if (user.activationTokenExpiresAt && user.activationTokenExpiresAt < new Date()) {
      res.status(400).json({ error: "El enlace expiró. Solicita uno nuevo a tu asesor." }); return;
    }

    res.json({ email: user.email ?? user.username, fullName: user.fullName ?? "" });
  } catch (err) {
    console.error("[activate/check]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * POST /api/auth/activate
 * Public. Sets password, activates account, clears tokens, and creates a session.
 * Body: { token: string; password: string }
 */
router.post("/auth/activate", async (req: Request, res: Response): Promise<void> => {
  const { token, password } = (req.body ?? {}) as { token?: string; password?: string };

  if (!token || !password) { res.status(400).json({ error: "Se requieren token y contraseña" }); return; }
  if (password.length < 8)  { res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" }); return; }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.activationToken, token))
      .limit(1);

    if (!user) { res.status(400).json({ error: "El enlace no es válido o ya fue utilizado." }); return; }
    if (user.activationTokenExpiresAt && user.activationTokenExpiresAt < new Date()) {
      res.status(400).json({ error: "El enlace expiró. Solicita uno nuevo a tu asesor." }); return;
    }

    // Activate: set password, activate, clear both activation and verification tokens
    await db.update(users).set({
      passwordHash:                hashPassword(password),
      isActive:                    true,
      activationToken:             null,
      activationTokenExpiresAt:    null,
      verificationToken:           null,   // also counts as email-verified
      verificationTokenExpiresAt:  null,
      lastLoginAt:                 new Date(),
      updatedAt:                   new Date(),
    }).where(eq(users.id, user.id));

    // Create session so user is logged in immediately
    req.session.authenticated = true;
    req.session.user = { username: user.username, role: user.role, userId: user.id };

    res.json({ ok: true });
  } catch (err) {
    console.error("[auth/activate]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * GET /api/auth/entitlement
 * Protected. Returns the current user's access/license info.
 * Admins always get full synthetic access without a DB lookup.
 */
router.get("/auth/entitlement", async (req: Request, res: Response): Promise<void> => {
  if (!req.session?.authenticated) { res.status(401).json({ error: "No autenticado" }); return; }

  const { userId, role } = req.session.user ?? { userId: 1, role: "admin" };
  const isAdmin = role === "admin";

  try {
    const access = await getUserAccess(userId, role);
    res.json({
      isAdmin,
      courseAccess:       access.courseAccess,
      toolAccessStatus:   access.toolAccessStatus,
      toolAccessActive:   access.toolAccessActive,
      toolAccessEndsAt:   access.toolAccessEndsAt?.toISOString() ?? null,
      daysRemaining:      access.daysRemaining,
      source:             access.source,
    });
  } catch (err) {
    console.error("[auth/entitlement]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * POST /api/auth/register
 * Public. Creates a pending (is_active=false) user and sends a verification email.
 */
router.post("/auth/register", async (req: Request, res: Response): Promise<void> => {
  const { fullName, email, password } = (req.body ?? {}) as {
    fullName?: string; email?: string; password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: "Se requieren correo y contraseña" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    return;
  }

  // Use email as username (lowercase, trimmed)
  const username = email.trim().toLowerCase();

  try {
    // Check for existing account with same email/username
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existing) {
      // Return the same message to avoid email enumeration
      res.json({ ok: true });
      return;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    await db.insert(users).values({
      username,
      passwordHash: hashPassword(password),
      fullName: fullName?.trim() || null,
      email: username,
      role: "user",
      isActive: false,
      verificationToken: token,
      verificationTokenExpiresAt: expiresAt,
    });

    const verifyUrl = `${getAppUrl()}/verify-email?token=${token}`;

    const tpl = verificationEmail(fullName?.trim() ?? username, verifyUrl);
    sendEmail({ to: username, ...tpl }).catch((err) => {
      console.error("[register] Email send failed:", err);
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[register]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/**
 * GET /api/auth/verify-email?token=
 * Public. Activates the user account when the token is valid and not expired.
 */
router.get("/auth/verify-email", async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query as { token?: string };

  if (!token) {
    res.status(400).json({ error: "Token no proporcionado" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.verificationToken, token))
      .limit(1);

    if (!user) {
      res.status(400).json({ error: "El enlace no es válido o ya fue utilizado." });
      return;
    }

    if (user.verificationTokenExpiresAt && user.verificationTokenExpiresAt < new Date()) {
      res.status(400).json({ error: "El enlace expiró. Regístrate de nuevo para recibir uno nuevo." });
      return;
    }

    await db
      .update(users)
      .set({
        isActive: true,
        verificationToken: null,
        verificationTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    res.json({ ok: true });
  } catch (err) {
    console.error("[verify-email]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── POST /api/auth/resend-activation ─────────────────────────────────────────
/**
 * Public endpoint — students can request a new activation link without admin help.
 * Always returns 200 to avoid email enumeration. Only sends an email when the user
 * exists AND their account is still pending activation (is_active = false AND has
 * an activation token, meaning they were provisioned but never activated).
 *
 * Body: { email: string }
 */
router.post("/auth/resend-activation", async (req: Request, res: Response): Promise<void> => {
  const { email } = (req.body ?? {}) as { email?: string };
  if (!email) {
    res.status(400).json({ error: "Se requiere email" });
    return;
  }

  const username = email.trim().toLowerCase();

  // Always respond with ok:true to avoid leaking whether the email exists.
  const silentOk = () => res.json({ ok: true });

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    // Only resend for pending-activation accounts (provisioned but not yet activated)
    if (!user || user.isActive || !user.activationToken) {
      silentOk();
      return;
    }

    const activationToken  = randomBytes(32).toString("hex");
    const activationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(users)
      .set({ activationToken, activationTokenExpiresAt: activationExpires, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const activateUrl = `${getAppUrl()}/activate?token=${activationToken}`;

    try {
      const { activationEmail } = await import("../lib/email");
      const tpl = activationEmail(user.fullName ?? username, activateUrl, 30);
      await sendEmail({ to: username, ...tpl });
    } catch (emailErr) {
      console.error("[auth/resend-activation] Email send failed:", emailErr);
    }

    silentOk();
  } catch (err) {
    console.error("[auth/resend-activation]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export default router;
